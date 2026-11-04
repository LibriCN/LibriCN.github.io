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

test('Big Book uses the API key header and normalizes nested books', async () => {
  const originalFetch = globalThis.fetch
  let seenHeaders
  globalThis.fetch = async (url, options = {}) => {
    assert.match(String(url), /api\.bigbookapi\.com\/search-books/)
    assert.match(String(url), /[?&]query=big-book-nested\b/)
    assert.match(String(url), /group-results=false/)
    seenHeaders = options.headers
    return new Response(JSON.stringify({ books: [[{ id: 'bb-1', title: 'Livro Big', image: 'https://img.test/book.jpg', authors: [{ name: 'Autora Big' }], publish_year: 2024, isbn13: '9780000000001' }]] }), { status: 200 })
  }
  try {
    const result = await admin.bigBookSearch('big-book-nested', 'secret-key', 10)
    assert.equal(seenHeaders.get('x-api-key'), 'secret-key')
    assert.equal(result[0].externalSource, 'bigbook')
    assert.equal(result[0].externalId, 'bigbook:bb-1')
    assert.deepEqual(result[0].authors, ['Autora Big'])
    assert.equal(result[0].publicationYear, 2024)
  } finally { globalThis.fetch = originalFetch }
})

test('external route falls back to Big Book after Open Library failure and supports provider selection', async () => {
  const originalFetch = globalThis.fetch
  const calls = []
  globalThis.fetch = async (url) => {
    calls.push(String(url))
    if (String(url).includes('bigbookapi.com')) return new Response(JSON.stringify({ books: [{ id: 'bb-fallback', title: 'Resultado Big Book', authors: [{ name: 'Autor' }], isbn13: '9780000000002' }] }), { status: 200 })
    return new Response('', { status: 503 })
  }
  try {
    const request = new Request('https://example.test/api/admin/external-books?query=fallback-unique&provider=auto')
    const actor = { id: 1, username: 'admin@example.test', role: 'admin', allLibraries: true, libraryIds: [] }
    const response = await admin.adminRoute(request, { BIG_BOOK_API_KEY: 'fallback-key' }, '/external-books', new URL(request.url), actor)
    assert.equal(response.status, 200)
    assert.equal((await response.json()).data[0].externalSource, 'bigbook')
    assert.ok(calls.some(url => url.includes('openlibrary.org/search.json')))
    assert.ok(calls.some(url => url.includes('bigbookapi.com/search-books')))
  } finally { globalThis.fetch = originalFetch }
})

test('empty provider result stays 200, while provider failure is 503', async () => {
  const originalFetch = globalThis.fetch
  const actor = { id: 1, username: 'admin@example.test', role: 'admin', allLibraries: true, libraryIds: [] }
  try {
    globalThis.fetch = async () => new Response(JSON.stringify({ docs: [] }), { status: 200 })
    const emptyRequest = new Request('https://example.test/api/admin/external-books?query=empty-unique&provider=openlibrary')
    const emptyResponse = await admin.adminRoute(emptyRequest, {}, '/external-books', new URL(emptyRequest.url), actor)
    assert.equal(emptyResponse.status, 200)
    assert.deepEqual((await emptyResponse.json()).data, [])

    globalThis.fetch = async () => new Response('', { status: 503 })
    const failedRequest = new Request('https://example.test/api/admin/external-books?query=failed-unique&provider=openlibrary')
    const failedResponse = await admin.adminRoute(failedRequest, {}, '/external-books', new URL(failedRequest.url), actor).catch(error => error)
    assert.equal(failedResponse.status, 503)
  } finally { globalThis.fetch = originalFetch }
})

test('search retries Open Library with lightweight fields and keeps provider failures distinct', async () => {
  const originalFetch = globalThis.fetch
  const actor = { id: 1, username: 'admin@example.test', role: 'admin', allLibraries: true, libraryIds: [] }
  try {
    const requests = []
    globalThis.fetch = async url => {
      const value = String(url); requests.push(value)
      if (value.includes('editions')) return new Response('', { status: 503 })
      return new Response(JSON.stringify({ docs: [{ key: '/works/OL777W', title: 'Fallback leve', author_name: ['Autor'] }] }), { status: 200 })
    }
    const request = new Request('https://example.test/api/admin/external-books?query=light-fallback-unique')
    const response = await admin.adminRoute(request, {}, '/external-books', new URL(request.url), actor)
    assert.equal(response.status, 200)
    assert.equal((await response.json()).data[0].title, 'Fallback leve')
    assert.equal(requests.length, 2)
    assert.match(requests[1], /fields=key,title,author_name,first_publish_year,cover_i/)

    globalThis.fetch = async () => new Response('', { status: 503 })
    const googleRequest = new Request('https://example.test/api/admin/external-books?query=ol-only-failure-unique&provider=openlibrary')
    const failure = await admin.adminRoute(googleRequest, { GOOGLE_BOOKS_API_KEY: 'google-key' }, '/external-books', new URL(googleRequest.url), actor).catch(error => error)
    assert.equal(failure.status, 503)
  } finally { globalThis.fetch = originalFetch }
})

test('a valid empty Big Book response is not reported as a 503', async () => {
  const originalFetch = globalThis.fetch
  const actor = { id: 1, username: 'admin@example.test', role: 'admin', allLibraries: true, libraryIds: [] }
  globalThis.fetch = async url => String(url).includes('bigbookapi.com') ? new Response(JSON.stringify({ books: [] }), { status: 200 }) : new Response('', { status: 503 })
  try {
    const request = new Request('https://example.test/api/admin/external-books?query=bigbook-empty-unique&provider=auto')
    const response = await admin.adminRoute(request, { BIG_BOOK_API_KEY: 'key' }, '/external-books', new URL(request.url), actor)
    assert.equal(response.status, 200)
    assert.deepEqual((await response.json()).data, [])
  } finally { globalThis.fetch = originalFetch }
})
