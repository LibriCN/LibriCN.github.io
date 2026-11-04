import test from 'node:test'
import assert from 'node:assert/strict'

const admin = await import('../src/routes/admin.ts')

test('external search deduplicates concurrent requests and caches the result', async () => {
  const originalFetch = globalThis.fetch
  let calls = 0
  let requestedUrl = ''
  globalThis.fetch = async (url) => {
    calls += 1
    requestedUrl = String(url)
    return new Response(JSON.stringify({ docs: [{ key: '/works/OL123W', title: 'Livro de teste', author_name: ['Autora'], isbn: ['9780000000000'], first_publish_year: 2020, edition_key: ['OL123M'], edition_count: 4, subject: ['fiction'], cover_i: 42 }] }), { status: 200, headers: { 'content-type': 'application/json' } })
  }
  try {
    const [first, second] = await Promise.all([
      admin.openLibrarySearch('dedup-test-1', 10, true),
      admin.openLibrarySearch('dedup-test-1', 10, true),
    ])
    assert.equal(calls, 1)
    assert.match(requestedUrl, /[?&]lang=pt\b/)
    assert.match(requestedUrl, /editions\.key/)
    assert.deepEqual(first, second)
    await admin.openLibrarySearch('dedup-test-1', 10, true)
    assert.equal(calls, 1)
  } finally { globalThis.fetch = originalFetch }
})

test('external result preserves edition identifiers without follow-up requests', () => {
  const result = admin.externalFromDoc({ key: '/works/OL456W', title: 'Livro', author_name: ['Autor'], edition_count: 7, first_publish_year: 1999, subject: ['fiction'], cover_i: 9, editions: { docs: [{ key: '/books/OL456M', title: 'Livro — edição', isbn: ['123'], publish_date: '2001', cover_i: 10 }] } })
  assert.equal(result.editionKey, 'OL456M')
  assert.equal(result.editionCount, 7)
  assert.equal(result.externalId, 'OL456M')
  assert.equal(result.recordType, 'edition')
  assert.equal(result.workId, 'OL456W')
})

test('a failed provider search can recover without a cached false empty result', async () => {
  const originalFetch = globalThis.fetch
  let calls = 0
  globalThis.fetch = async () => {
    calls++
    return calls === 1 ? new Response('', { status: 503 }) : new Response(JSON.stringify({ docs: [{ key: '/works/OL999W', title: 'Resultado recuperado' }] }), { headers: { 'content-type': 'application/json' } })
  }
  try {
    await assert.rejects(admin.openLibrarySearch('recover-after-failure-unique', 10, true), /indisponível/)
    const recovered = await admin.openLibrarySearch('recover-after-failure-unique', 10, true)
    assert.equal(recovered[0].title, 'Resultado recuperado')
    await admin.openLibrarySearch('recover-after-failure-unique', 10, true)
    assert.equal(calls, 2)
  } finally { globalThis.fetch = originalFetch }
})

test('holding normalization clamps availability and keeps shelf metadata', () => {
  assert.deepEqual(admin.validHolding({ quantity: 2, availableQuantity: 9, shelfLocation: ' A-12 ', sectionId: 'sec-1' }), { quantity: 2, availableQuantity: 2, status: 'disponivel', shelfLocation: 'A-12', sectionId: 'sec-1' })
  assert.deepEqual(admin.validHolding({ quantity: 0, availableQuantity: 3, status: 'emprestado' }), { quantity: 0, availableQuantity: 0, status: 'emprestado', shelfLocation: '', sectionId: null })
})

test('fetchJson returns null after timeout instead of hanging', async () => {
  const originalFetch = globalThis.fetch
  globalThis.fetch = (_url, options = {}) => new Promise((resolve, reject) => {
    options.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')), { once: true })
  })
  try {
    const started = Date.now()
    const result = await admin.fetchJson('https://example.invalid/slow', 30)
    assert.equal(result, null)
    assert.ok(Date.now() - started < 500)
  } finally { globalThis.fetch = originalFetch }
})

test('ISBN resolution follows the exact Open Library edition', async () => {
  const originalFetch = globalThis.fetch
  const urls = []
  globalThis.fetch = async (url) => {
    urls.push(String(url))
    if (String(url).includes('/isbn/9780000000000.json')) return new Response(JSON.stringify({ key: '/books/OL999M', title: 'Edição ISBN', isbn_13: ['9780000000000'], authors: [{ key: '/authors/OL111A' }], covers: [22] }), { status: 200 })
    if (String(url).includes('/books/OL999M.json')) return new Response(JSON.stringify({ title: 'Edição ISBN', isbn_13: ['9780000000000'], authors: [{ key: '/authors/OL111A' }], covers: [22] }), { status: 200 })
    if (String(url).includes('/authors/OL111A.json')) return new Response(JSON.stringify({ name: 'Autor exato' }), { status: 200 })
    throw new Error('unexpected request')
  }
  try {
    const result = await admin.resolveBookReference('978-0000000000')
    assert.equal(result?.externalId, 'OL999M')
    assert.equal(result?.editionKey, 'OL999M')
    assert.equal(result?.recordType, 'edition')
    assert.equal(result?.isbn, '9780000000000')
    assert.deepEqual(result?.authors, ['Autor exato'])
    assert.equal(urls.filter(url => url.includes('/books/OL999M.json')).length, 0)
    assert.equal(urls.some(url => url.includes('/works/')), false)
  } finally { globalThis.fetch = originalFetch }
})
