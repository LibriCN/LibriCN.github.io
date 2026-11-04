import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'
import { stripTypeScriptTypes } from 'node:module'

async function client(fetch) {
  const storage = Object.create(null)
  Object.defineProperties(storage, {
    getItem: { value: key => storage[key] ?? null },
    setItem: { value: (key, value) => { storage[key] = String(value) } },
    removeItem: { value: key => { delete storage[key] } },
  })
  const context = vm.createContext({ fetch, localStorage: storage, Headers, Response, URL, URLSearchParams, Blob, AbortController, setTimeout, clearTimeout })
  const config = new vm.SyntheticModule(['appConfig'], function () { this.setExport('appConfig', { apiUrl: 'https://api.test' }) }, { context })
  const modules = new Map([['config', config]])
  async function load(name) {
    if (modules.has(name)) return modules.get(name)
    const code = await readFile(new URL(`../src/${name}.ts`, import.meta.url), 'utf8')
    const js = stripTypeScriptTypes(code, { mode: 'transform' })
    const module = new vm.SourceTextModule(js, { context, identifier: name })
    modules.set(name, module)
    await module.link(specifier => load(specifier.replace('./', '')))
    return module
  }
  const api = await load('api'); await api.evaluate()
  return api.namespace
}
const json = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } })
const result = { source: 'Open Library', externalSource: 'openlibrary', externalId: 'OL123M', title: 'Livro escolhido', authors: ['Autora'], isbn: '9780000000000', publicationYear: 2024, genre: 'Ficção', subject: 'Ficção', description: '', coverUrl: '' }

test('provider choice is sent to the Worker and isolates the search cache', async () => {
  const requests = []
  const api = await client(async url => { requests.push(url); return json({ data: [result] }) })
  await api.externalBooks('Livro', 'openlibrary')
  await api.externalBooks('Livro', 'bigbook')
  await api.externalBooks('Livro', 'openlibrary')
  assert.equal(requests.length, 2)
  assert.equal(new URL(requests[0]).searchParams.get('provider'), 'openlibrary')
  assert.equal(new URL(requests[1]).searchParams.get('provider'), 'bigbook')
})

test('repeated and concurrent external searches reuse one request', async () => {
  let calls = 0; let release
  const pending = new Promise(resolve => { release = resolve })
  const api = await client(async () => { calls++; await pending; return json({ data: [result] }) })
  const first = api.externalBooks('  Livro  escolhido ')
  const second = api.externalBooks('livro escolhido')
  release(); const values = await Promise.all([first, second])
  await api.externalBooks('LIVRO ESCOLHIDO')
  assert.equal(calls, 1)
  assert.equal(values[0].data[0].externalId, 'OL123M')
  assert.equal(values[1].data[0].title, 'Livro escolhido')
})

test('failed searches can be retried instead of reusing a failed promise', async () => {
  let workerCalls = 0; let directCalls = 0
  const api = await client(async url => {
    if (String(url).startsWith('https://openlibrary.org/')) { directCalls++; return json({ error: 'Open Library indisponível' }, 503) }
    workerCalls++
    return workerCalls === 1 ? json({ error: 'Serviço temporariamente indisponível' }, 503) : json({ data: [result] })
  })
  await assert.rejects(api.externalBooks('Livro'), /servidor nem pelo navegador/i)
  assert.equal((await api.externalBooks('Livro')).data.length, 1)
  assert.equal(workerCalls, 2)
  assert.equal(directCalls, 1)
})

test('Worker 503 falls back to Open Library, normalizes results, and caches the success', async () => {
  let workerCalls = 0; let directCalls = 0
  const api = await client(async url => {
    if (String(url).startsWith('https://openlibrary.org/')) {
      directCalls++
      return json({ docs: [{ key: '/works/OL12345W', title: 'Fnaf', author_name: ['Scott Cawthon'], first_publish_year: 2015, cover_i: 77 }] })
    }
    workerCalls++
    return json({ error: 'upstream indisponível' }, 503)
  })
  const first = await api.externalBooks('Fnaf', 'openlibrary')
  const second = await api.externalBooks('fnaf', 'openlibrary')
  assert.deepEqual(first, second)
  assert.equal(workerCalls, 1)
  assert.equal(directCalls, 1)
  assert.equal(first.data[0].externalId, 'OL12345W')
  assert.equal(first.data[0].recordType, 'work')
  assert.equal(first.data[0].isbn, '')
  assert.equal(first.data[0].genre, 'Não classificado')
})

test('direct Open Library fallback never forwards the app Authorization header', async () => {
  let directRequest
  const apiWithCapture = await client(async (url, options = {}) => {
    if (String(url).startsWith('https://openlibrary.org/')) { directRequest = { url: String(url), options }; return json({ docs: [{ key: '/works/OL12346W', title: 'Seguro', author_name: [] }] }) }
    if (String(url).endsWith('/api/auth/login')) return json({ token: 'secret-login-token', user: { id: 1, username: 'admin' } })
    return json({ error: 'upstream indisponível' }, 503)
  })
  await apiWithCapture.login('admin', 'senha')
  await apiWithCapture.externalBooks('Seguro', 'openlibrary')
  assert.match(directRequest.url, /^https:\/\/openlibrary\.org\//)
  assert.equal(new Headers(directRequest.options.headers).has('Authorization'), false)
  assert.equal(directRequest.options.credentials, 'omit')
})

for (const status of [400, 401, 403]) {
  test(`Worker ${status} does not fall back to direct Open Library`, async () => {
    let directCalls = 0
    const api = await client(async url => {
      if (String(url).startsWith('https://openlibrary.org/')) { directCalls++; return json({ docs: [] }) }
      return json({ error: 'falha definitiva' }, status)
    })
    await assert.rejects(api.externalBooks('Livro', 'openlibrary'))
    assert.equal(directCalls, 0)
  })
}

test('Big Book provider does not fall back to Open Library', async () => {
  let directCalls = 0
  const api = await client(async url => {
    if (String(url).startsWith('https://openlibrary.org/')) { directCalls++; return json({ docs: [] }) }
    return json({ error: 'Big Book indisponível' }, 503)
  })
  await assert.rejects(api.externalBooks('Livro', 'bigbook'))
  assert.equal(directCalls, 0)
})

test('both Worker and direct Open Library failures expose an honest error', async () => {
  const api = await client(async url => String(url).startsWith('https://openlibrary.org/')
    ? json({ error: 'Open Library indisponível' }, 503)
    : json({ error: 'Worker indisponível' }, 503))
  await assert.rejects(api.externalBooks('Livro', 'openlibrary'), /servidor nem pelo navegador/i)
})

test('a valid Open Library 404 is treated as an empty result and cached briefly', async () => {
  let directCalls = 0
  const api = await client(async url => {
    if (String(url).startsWith('https://openlibrary.org/')) { directCalls++; return json({ error: 'not found' }, 404) }
    return json({ error: 'Worker indisponível' }, 503)
  })
  const first = await api.externalBooks('Livro inexistente', 'openlibrary')
  const second = await api.externalBooks('Livro inexistente', 'openlibrary')
  assert.equal(first.data.length, 0)
  assert.equal(second.data.length, 0)
  assert.equal(directCalls, 1)
})

test('Open Library search prefers edition ISBN metadata while preserving work ISBN empty', async () => {
  const api = await client(async url => {
    assert.match(String(url), /^https:\/\/openlibrary\.org\/search\.json\?/)
    return json({ docs: [{ key: '/works/OL12347W', title: 'Diário de um banana', author_name: ['Jeff Kinney'], first_publish_year: 2007, editions: { docs: [{ key: '/books/OL12348M', title: 'Diário de um banana', isbn: ['9780000000001'], publish_date: '2021', cover_i: 88 }] } }] })
  })
  const response = await api.externalBooks('Diario de um banana', 'openlibrary')
  assert.equal(response.data[0].externalId, 'OL12348M')
  assert.equal(response.data[0].recordType, 'edition')
  assert.equal(response.data[0].editionKey, 'OL12348M')
  assert.equal(response.data[0].isbn, '9780000000001')
  assert.equal(response.data[0].publicationYear, 2021)
})

test('direct ISBN lookup uses fixed Open Library endpoints and resolves author metadata without token leakage', async () => {
  const requests = []
  const api = await client(async (url, options = {}) => {
    requests.push({ url: String(url), options })
    if (String(url).endsWith('/api/auth/login')) return json({ token: 'secret-login-token', user: { id: 1, username: 'admin' } })
    if (String(url).startsWith('https://openlibrary.org/isbn/')) return json({ key: '/books/OL12349M', title: 'Edição ISBN', isbn_13: ['9780000000002'], publish_date: '2022', covers: [99], authors: [{ key: '/authors/OL12350A' }] })
    if (String(url) === 'https://openlibrary.org/authors/OL12350A.json') return json({ name: 'Autora ISBN' })
    return json({ error: 'upstream indisponível' }, 503)
  })
  await api.login('admin', 'senha')
  const response = await api.externalBooks('978-0000000002', 'openlibrary')
  assert.equal(response.data[0].externalId, 'OL12349M')
  assert.equal(response.data[0].recordType, 'edition')
  assert.equal(response.data[0].isbn, '9780000000002')
  assert.equal(Array.from(response.data[0].authors).join('|'), 'Autora ISBN')
  const direct = requests.filter(item => item.url.startsWith('https://openlibrary.org/'))
  assert.equal(direct.length, 2)
  assert.ok(direct.every(item => item.url.startsWith('https://openlibrary.org/')))
  assert.ok(direct.every(item => !new Headers(item.options.headers).has('Authorization')))
})

test('import submits selected metadata and holding together without another search', async () => {
  const calls = []
  const holding = { libraryId: 'lib-1', quantity: 2, availableQuantity: 1, status: 'disponivel', shelfLocation: 'B-24' }
  const api = await client(async (url, options) => {
    calls.push({ url, body: JSON.parse(options.body) })
    return json({ ...result, id: 'book-1', createdAt: '2026-11-04', updatedAt: '2026-11-04', holding: { ...holding, id: 'holding-1' } }, 201)
  })
  const saved = await api.importBookSelection(result, holding)
  assert.equal(calls.length, 1)
  assert.equal(calls[0].url, 'https://api.test/api/admin/books/import')
  assert.equal(calls[0].body.selection.externalId, 'OL123M')
  assert.equal(calls[0].body.holding.shelfLocation, 'B-24')
  assert.equal(saved.holding.id, 'holding-1')
  assert.equal(saved.coverUrl, '', 'missing covers must not show another book cover')
})

test('saving a selection invalidates catalog data while preserving external search cache', async () => {
  let searches = 0; let catalogs = 0
  const api = await client(async url => {
    if (url.includes('external-books')) { searches++; return json({ data: [result] }) }
    if (url.includes('/import')) return json({ ...result, id: 'book-1' })
    catalogs++; return json({ data: [] })
  })
  await api.externalBooks('Livro'); await api.listBooks()
  await api.importBookSelection(result)
  await api.externalBooks('Livro'); await api.listBooks()
  assert.equal(searches, 1)
  assert.equal(catalogs, 2)
})
