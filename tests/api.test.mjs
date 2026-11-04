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
  const context = vm.createContext({ fetch, localStorage: storage, Headers, Response, URL, Blob })
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
  let calls = 0
  const api = await client(async () => ++calls === 1 ? json({ error: 'Serviço temporariamente indisponível' }, 503) : json({ data: [result] }))
  await assert.rejects(api.externalBooks('Livro'), /temporariamente indisponível/)
  assert.equal((await api.externalBooks('Livro')).data.length, 1)
  assert.equal(calls, 2)
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
