import type { ExternalBookResult } from './api'

const base = 'https://openlibrary.org'
const first = (value: unknown): string => Array.isArray(value) ? String(value[0] || '') : String(value || '')
const year = (value: unknown) => Number(String(value || '').match(/\d{4}/)?.[0]) || null
const olid = (value: unknown) => String(value || '').match(/^\/?(?:books\/|works\/)?(OL\d+[MW])$/i)?.[1]?.toUpperCase() || ''
class OpenLibraryHttpError extends Error {
  status: number
  constructor(status: number) { super(`Open Library respondeu HTTP ${status}.`); this.status = status }
}

async function get(path: string): Promise<Record<string, unknown>> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 10_000)
  try {
    // Public metadata only: never forward the app session to Open Library.
    const response = await fetch(`${base}${path}`, { headers: { Accept: 'application/json' }, signal: controller.signal, credentials: 'omit', referrerPolicy: 'no-referrer' })
    if (!response.ok) throw new OpenLibraryHttpError(response.status)
    const data: unknown = await response.json()
    if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('Resposta inválida da Open Library.')
    return data as Record<string, unknown>
  } finally { clearTimeout(timeout) }
}

function normalize(record: Record<string, unknown>, id: string, authors: string[], edition: boolean): ExternalBookResult {
  const covers = Array.isArray(record.covers) ? record.covers : []
  const coverId = Number(record.cover_i || covers[0])
  return {
    source: 'Open Library', externalSource: 'openlibrary', externalId: id,
    recordType: edition ? 'edition' : 'work', editionKey: edition ? id : undefined,
    title: String(record.title || ''), authors,
    isbn: edition ? first(record.isbn_13) || first(record.isbn_10) || first(record.isbn) : '',
    publicationYear: year(record.publish_date || record.first_publish_year || record.first_publish_date),
    coverUrl: coverId > 0 ? `https://covers.openlibrary.org/b/id/${coverId}-L.jpg` : '',
    genre: 'Não classificado', subject: '', description: '',
  }
}

export async function searchOpenLibrary(query: string): Promise<{ data: ExternalBookResult[] }> {
  try { return await lookup(query) }
  catch (cause) { if (cause instanceof OpenLibraryHttpError && cause.status === 404) return { data: [] }; throw cause }
}

async function lookup(query: string): Promise<{ data: ExternalBookResult[] }> {
  const value = query.trim()
  const isbn = value.replace(/[\s-]/g, '')
  let id = olid(value) || olid(value.replace(/^https?:\/\/openlibrary\.org\//i, '').split(/[?#]/)[0])
  let record: Record<string, unknown> | undefined
  if (/^(?:\d{9}[\dXx]|\d{13})$/.test(isbn)) {
    record = await get(`/isbn/${encodeURIComponent(isbn)}.json`)
    id = olid(record.key)
    if (!id.endsWith('M')) throw new Error('A Open Library não identificou a edição deste ISBN.')
  } else if (id) record = await get(`/${id.endsWith('M') ? 'books' : 'works'}/${id}.json`)
  if (record) {
    const authors = await Promise.all((Array.isArray(record.authors) ? record.authors : []).slice(0, 4).map(async value => {
      const item = value && typeof value === 'object' ? value as { key?: string; author?: { key?: string } } : {}
      const key = item.author?.key || item.key || ''
      if (!/^\/authors\/OL\d+A$/.test(key)) return ''
      try { return String((await get(`${key}.json`)).name || '') } catch { return '' }
    }))
    return { data: [normalize(record, id, authors.filter(Boolean), id.endsWith('M'))] }
  }
  const params = new URLSearchParams({ q: value, lang: 'pt', limit: '10', fields: 'key,title,author_name,first_publish_year,cover_i,editions,editions.key,editions.title,editions.isbn,editions.publish_date,editions.cover_i' })
  const response = await get(`/search.json?${params}`)
  if (!Array.isArray(response.docs)) throw new Error('Resposta de busca inválida da Open Library.')
  return { data: response.docs.flatMap(value => {
    if (!value || typeof value !== 'object') return []
    const doc = value as Record<string, unknown>
    const nested = doc.editions as { docs?: Record<string, unknown>[] } | undefined
    const edition = nested?.docs?.find(item => olid(item.key).endsWith('M'))
    const result = normalize(edition || doc, olid(edition?.key || doc.key), Array.isArray(doc.author_name) ? doc.author_name.map(String).slice(0, 4) : [], Boolean(edition))
    return result.title && result.externalId ? [result] : []
  }) }
}
