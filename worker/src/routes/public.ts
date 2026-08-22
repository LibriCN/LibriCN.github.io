import type { Env, DbBook, DbLibrary, DbLibraryBook, DbLibrarySection } from '../types'
import { bookDto, holdingDto, libraryDto } from '../lib/db'
import { body, HttpError, id, json, now, text } from '../lib/http'

function queryParams(url: URL) { return { q: text(url.searchParams.get('query') || url.searchParams.get('q'), 160), genre: text(url.searchParams.get('genre'), 80), author: text(url.searchParams.get('author'), 120), libraryId: text(url.searchParams.get('libraryId'), 80), availability: text(url.searchParams.get('availability'), 30), page: Math.max(1, Number(url.searchParams.get('page') || 1)), limit: Math.min(50, Math.max(1, Number(url.searchParams.get('limit') || 12))) } }

export async function publicRoute(request: Request, env: Env, pathname: string, url: URL): Promise<Response | null> {
  if (pathname === '/api/books' && request.method === 'GET') return listBooks(request, env, url)
  if (pathname.startsWith('/api/books/') && request.method === 'GET') return getBook(request, env, pathname.slice('/api/books/'.length))
  if (pathname === '/api/libraries' && request.method === 'GET') return listLibraries(request, env)
  if (pathname.startsWith('/api/libraries/') && request.method === 'GET') return getLibrary(request, env, pathname.slice('/api/libraries/'.length))
  if (pathname === '/api/suggestions' && request.method === 'POST') return createSuggestion(request, env)
  return null
}

async function listBooks(request: Request, env: Env, url: URL) {
  const filters = queryParams(url); const where = ['b.is_deleted = 0']; const params: (string | number)[] = []
  if (filters.q) { where.push('(LOWER(b.title) LIKE LOWER(?) OR LOWER(b.authors_json) LIKE LOWER(?) OR LOWER(b.genre) LIKE LOWER(?) OR LOWER(b.subject) LIKE LOWER(?) OR b.isbn LIKE ?)'); const term = `%${filters.q}%`; params.push(term, term, term, term, term) }
  if (filters.genre) { where.push('b.genre = ?'); params.push(filters.genre) }
  if (filters.author) { where.push('LOWER(b.authors_json) LIKE LOWER(?)'); params.push(`%${filters.author}%`) }
  if (filters.libraryId) { where.push('EXISTS (SELECT 1 FROM library_books lb_filter WHERE lb_filter.book_id = b.id AND lb_filter.library_id = ?)'); params.push(filters.libraryId) }
  if (filters.availability === 'disponivel') { where.push('EXISTS (SELECT 1 FROM library_books lb_available WHERE lb_available.book_id = b.id AND lb_available.available_quantity > 0)') }
  else if (['emprestado', 'indisponivel'].includes(filters.availability)) { where.push('EXISTS (SELECT 1 FROM library_books lb_status WHERE lb_status.book_id = b.id AND lb_status.status = ?)'); params.push(filters.availability) }
  const condition = where.join(' AND ')
  const totalRow = await env.DB.prepare(`SELECT COUNT(DISTINCT b.id) AS total FROM books b WHERE ${condition}`).bind(...params).first<{ total: number }>()
  const page = filters.page; const limit = filters.limit; const offset = (page - 1) * limit
  const result = await env.DB.prepare(`SELECT b.* FROM books b WHERE ${condition} ORDER BY b.title COLLATE NOCASE LIMIT ? OFFSET ?`).bind(...params, limit, offset).all<DbBook>()
  const books = result.results || []
  const holdings = books.length ? (await env.DB.prepare(`SELECT lb.*, l.name AS library_name, s.name AS section_name FROM library_books lb JOIN libraries l ON l.id = lb.library_id AND l.is_deleted = 0 LEFT JOIN library_sections s ON s.id = lb.section_id AND s.is_active = 1 WHERE lb.book_id IN (${books.map(() => '?').join(',')}) ORDER BY l.name,s.sort_order,s.name`).bind(...books.map(book => book.id)).all<DbLibraryBook & { library_name: string; section_name?: string }>()).results : []
  const grouped = new Map<string, (DbLibraryBook & { library_name: string })[]>(); holdings.forEach(item => grouped.set(item.book_id, [...(grouped.get(item.book_id) || []), item]))
  if (filters.q && books.length) await env.DB.batch(books.map(book => env.DB.prepare('UPDATE books SET search_count = search_count + 1 WHERE id = ?').bind(book.id)))
  return json({ data: books.map(book => ({ ...bookDto(book), libraries: (grouped.get(book.id) || []).map(holdingDto) })), pagination: { page, limit, total: Number(totalRow?.total || 0), totalPages: Math.ceil(Number(totalRow?.total || 0) / limit) }, city: env.CITY_NAME || 'Sua cidade' }, 200, request, env)
}

async function getBook(request: Request, env: Env, idValue: string) {
  const book = await env.DB.prepare('SELECT * FROM books WHERE id = ? AND is_deleted = 0').bind(idValue).first<DbBook>()
  if (!book) return json({ error: 'Livro não encontrado.' }, 404, request, env)
  const holdings = await env.DB.prepare('SELECT lb.*, l.name AS library_name, s.name AS section_name FROM library_books lb JOIN libraries l ON l.id = lb.library_id AND l.is_deleted = 0 LEFT JOIN library_sections s ON s.id = lb.section_id AND s.is_active = 1 WHERE lb.book_id = ? ORDER BY l.name,s.sort_order,s.name').bind(idValue).all<DbLibraryBook & { library_name: string; section_name?: string }>()
  return json({ ...bookDto(book), libraries: (holdings.results || []).map(holdingDto) }, 200, request, env)
}

async function listLibraries(request: Request, env: Env) {
  const result = await env.DB.prepare(`SELECT l.*, COUNT(DISTINCT lb.book_id) AS book_count FROM libraries l LEFT JOIN library_books lb ON lb.library_id = l.id JOIN (SELECT 1) x ON 1 = 1 WHERE l.is_deleted = 0 GROUP BY l.id ORDER BY l.name COLLATE NOCASE`).all<DbLibrary & { book_count: number }>()
  const sectionRows = await env.DB.prepare('SELECT * FROM library_sections WHERE is_active=1 ORDER BY sort_order,name COLLATE NOCASE').all<DbLibrarySection>(); const grouped = new Map<string, DbLibrarySection[]>(); (sectionRows.results || []).forEach(row => grouped.set(row.library_id, [...(grouped.get(row.library_id) || []), row]))
  return json({ data: (result.results || []).map(row => ({ ...libraryDto(row, grouped.get(row.id) || []), bookCount: Number(row.book_count || 0) })), city: env.CITY_NAME || 'Sua cidade' }, 200, request, env)
}

async function getLibrary(request: Request, env: Env, libraryId: string) {
  const library = await env.DB.prepare('SELECT * FROM libraries WHERE id = ? AND is_deleted = 0').bind(libraryId).first<DbLibrary>()
  if (!library) return json({ error: 'Biblioteca não encontrada.' }, 404, request, env)
  const books = await env.DB.prepare('SELECT b.*, lb.id AS holding_id, lb.section_id, lb.quantity, lb.available_quantity, lb.status, lb.shelf_location, lb.last_checked_at, l.name AS library_name, s.name AS section_name FROM library_books lb JOIN books b ON b.id = lb.book_id AND b.is_deleted = 0 JOIN libraries l ON l.id = lb.library_id LEFT JOIN library_sections s ON s.id = lb.section_id AND s.is_active = 1 WHERE lb.library_id = ? ORDER BY s.sort_order,s.name,b.title COLLATE NOCASE').bind(libraryId).all<DbBook & DbLibraryBook & { holding_id: string; library_name: string; section_name?: string }>()
  const sections = await env.DB.prepare('SELECT * FROM library_sections WHERE library_id=? AND is_active=1 ORDER BY sort_order,name COLLATE NOCASE').bind(libraryId).all<DbLibrarySection>()
  return json({ ...libraryDto(library, sections.results || []), books: (books.results || []).map(row => ({ ...bookDto(row), holding: holdingDto({ ...row, id: row.holding_id }) })) }, 200, request, env)
}

interface SuggestionPayload { type?: string; message?: string; suggestedBookTitle?: string; suggestedAuthor?: string; contact?: string }
async function createSuggestion(request: Request, env: Env) {
  const input = await body<SuggestionPayload>(request); const type = text(input.type, 40); const message = text(input.message, 2000)
  if (!['Sugerir livro', 'Informar correção'].includes(type)) throw new HttpError('Escolha um tipo de contribuição válido.')
  if (message.length < 5) throw new HttpError('Escreva uma mensagem um pouco mais completa.')
  const timestamp = now(); const suggestionId = id('sug')
  await env.DB.prepare('INSERT INTO suggestions (id, type, message, suggested_book_title, suggested_author, contact, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)').bind(suggestionId, type, message, text(input.suggestedBookTitle, 180), text(input.suggestedAuthor, 180), text(input.contact, 180), 'pendente', timestamp, timestamp).run()
  return json({ id: suggestionId, message: 'Contribuição recebida com sucesso.' }, 201, request, env)
}
