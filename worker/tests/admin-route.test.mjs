import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { DatabaseSync } from 'node:sqlite'

const admin = await import('../src/routes/admin.ts')

class D1Statement {
  constructor(database, sql) { this.database = database; this.sql = sql; this.parameters = []; this.failOnRun = false }
  bind(...parameters) { this.parameters = parameters; return this }
  run() {
    if (this.failOnRun) throw new Error('synthetic holding insert failure')
    this.database.prepare(this.sql).run(...this.parameters)
    return { success: true, meta: {} }
  }
  first() { return this.database.prepare(this.sql).get(...this.parameters) ?? null }
  all() { return { results: this.database.prepare(this.sql).all(...this.parameters) } }
}

class D1Memory {
  constructor(database, { failHoldingBatch = false } = {}) { this.database = database; this.failHoldingBatch = failHoldingBatch }
  prepare(sql) { const statement = new D1Statement(this.database, sql); return statement }
  async batch(statements) {
    this.database.exec('BEGIN')
    try {
      for (const statement of statements) {
        if (this.failHoldingBatch && /INSERT INTO library_books/i.test(statement.sql)) statement.failOnRun = true
        statement.run()
      }
      this.database.exec('COMMIT')
      return statements.map(() => ({ success: true, meta: {} }))
    } catch (error) {
      this.database.exec('ROLLBACK')
      throw error
    }
  }
}

async function createEnv(options) {
  const database = new DatabaseSync(':memory:')
  const migrations = await Promise.all((await (await import('node:fs/promises')).readdir(new URL('../migrations/', import.meta.url)))
    .filter(name => name.endsWith('.sql')).sort().map(name => readFile(new URL(`../migrations/${name}`, import.meta.url), 'utf8')))
  for (const migration of migrations) database.exec(migration)
  const d1 = new D1Memory(database, options)
  const env = { DB: d1 }
  await database.prepare("INSERT INTO libraries (id,name,address,opening_hours,library_type,created_at,updated_at) VALUES (?,?,?,?,?,?,?)").run('lib-a', 'Biblioteca A', '', '', 'publica_comunitaria', '2026-01-01', '2026-01-01')
  await database.prepare("INSERT INTO libraries (id,name,address,opening_hours,library_type,created_at,updated_at) VALUES (?,?,?,?,?,?,?)").run('lib-b', 'Biblioteca B', '', '', 'publica_comunitaria', '2026-01-01', '2026-01-01')
  await database.prepare("INSERT INTO library_sections (id,library_id,name,description,sort_order,created_at,updated_at) VALUES (?,?,?,?,?,?,?)").run('section-a', 'lib-a', 'Ficção', '', 0, '2026-01-01', '2026-01-01')
  return { env, database }
}

function actor(libraryIds = ['lib-a']) { return { id: 1, username: 'collector@example.org', role: 'categorizer', allLibraries: false, libraryIds } }
function selection(overrides = {}) { return { title: 'Livro Escolhido', authors: ['Autora'], isbn: '9780000000000', publicationYear: 2024, genre: 'Ficção', subject: 'Literatura', description: '', coverUrl: '', externalSource: 'openlibrary', externalId: 'OL123M', ...overrides } }
function holding(overrides = {}) { return { libraryId: 'lib-a', sectionId: 'section-a', quantity: 2, availableQuantity: 2, status: 'disponivel', shelfLocation: 'A-12', ...overrides } }
async function callImport(env, body, currentActor = actor()) {
  const request = new Request('https://local.test/api/admin/books/import', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
  return admin.adminRoute(request, env, '/books/import', new URL(request.url), currentActor)
}
async function responseJson(response) { return response ? response.json() : null }

test('imports a selected edition and holding in one response', async () => {
  const { env, database } = await createEnv()
  const response = await callImport(env, { selection: selection(), holding: holding() })
  assert.equal(response.status, 201)
  const result = await responseJson(response)
  assert.equal(result.title, 'Livro Escolhido')
  assert.equal(result.externalId, 'OL123M')
  assert.equal(result.holding.libraryId, 'lib-a')
  assert.equal(result.holding.sectionId, 'section-a')
  assert.equal(database.prepare('SELECT COUNT(*) AS count FROM books').get().count, 1)
  assert.equal(database.prepare('SELECT COUNT(*) AS count FROM library_books').get().count, 1)
})

test('retrying the same selection updates the existing holding instead of duplicating it', async () => {
  const { env, database } = await createEnv()
  const first = await callImport(env, { selection: selection(), holding: holding() })
  const firstResult = await responseJson(first)
  const second = await callImport(env, { selection: selection(), holding: holding({ quantity: 3, availableQuantity: 1, shelfLocation: 'B-04' }) })
  const secondResult = await responseJson(second)
  assert.equal(second.status, 200)
  assert.equal(secondResult.id, firstResult.id)
  assert.equal(secondResult.holding.id, firstResult.holding.id)
  assert.equal(secondResult.holding.quantity, 3)
  assert.equal(secondResult.holding.shelfLocation, 'B-04')
  assert.equal(database.prepare('SELECT COUNT(*) AS count FROM books').get().count, 1)
  assert.equal(database.prepare('SELECT COUNT(*) AS count FROM library_books').get().count, 1)
})

test('selection import never calls external fetch', async () => {
  const originalFetch = globalThis.fetch
  let calls = 0
  globalThis.fetch = async () => { calls += 1; throw new Error('external fetch should not run') }
  try {
    const { env } = await createEnv()
    const response = await callImport(env, { selection: selection() })
    assert.equal(response.status, 201)
    assert.equal(calls, 0)
  } finally { globalThis.fetch = originalFetch }
})

test('library outside actor scope is rejected before creating a book', async () => {
  const { env, database } = await createEnv()
  await assert.rejects(callImport(env, { selection: selection({ externalId: 'OL999M' }), holding: holding({ libraryId: 'lib-b' }) }), /Seu usuário não tem acesso a esta biblioteca/)
  assert.equal(database.prepare('SELECT COUNT(*) AS count FROM books').get().count, 0)
  assert.equal(database.prepare('SELECT COUNT(*) AS count FROM library_books').get().count, 0)
})

test('invalid section is rejected before creating a book', async () => {
  const { env, database } = await createEnv()
  await assert.rejects(callImport(env, { selection: selection({ externalId: 'OL998M' }), holding: holding({ sectionId: 'section-b' }) }), /A seção escolhida não pertence a esta biblioteca/)
  assert.equal(database.prepare('SELECT COUNT(*) AS count FROM books').get().count, 0)
})

test('D1 batch rollback leaves no book when holding insertion fails', async () => {
  const { env, database } = await createEnv({ failHoldingBatch: true })
  await assert.rejects(callImport(env, { selection: selection({ externalId: 'OL997M' }), holding: holding() }), /synthetic holding insert failure/)
  assert.equal(database.prepare('SELECT COUNT(*) AS count FROM books').get().count, 0)
  assert.equal(database.prepare('SELECT COUNT(*) AS count FROM library_books').get().count, 0)
})

test('external ISBN search route resolves exact edition without work refetch', async () => {
  const originalFetch = globalThis.fetch
  const urls = []
  globalThis.fetch = async (url) => {
    urls.push(String(url))
    if (String(url).includes('/isbn/9780000000000.json')) return new Response(JSON.stringify({ key: '/books/OL999M', title: 'Edição exata', isbn_13: ['9780000000000'], authors: [{ key: '/authors/OL111A' }], covers: [22] }), { status: 200 })
    if (String(url).includes('/authors/OL111A.json')) return new Response(JSON.stringify({ name: 'Autor ISBN' }), { status: 200 })
    if (String(url).includes('/books/OL999M.json')) return new Response(JSON.stringify({ title: 'Edição exata', isbn_13: ['9780000000000'], authors: [{ key: '/authors/OL111A' }], covers: [22] }), { status: 200 })
    throw new Error(`unexpected external URL: ${url}`)
  }
  try {
    const { env } = await createEnv()
    const request = new Request('https://local.test/api/admin/external-books?query=978-0000000000')
    const response = await admin.adminRoute(request, env, '/external-books', new URL(request.url), actor())
    assert.equal(response.status, 200)
    const result = (await response.json()).data[0]
    assert.equal(result.externalId, 'OL999M')
    assert.deepEqual(result.authors, ['Autor ISBN'])
    assert.equal(urls.some(url => url.includes('/works/')), false)
    assert.equal(urls.some(url => url.includes('/search.json')), false)
  } finally { globalThis.fetch = originalFetch }
})
