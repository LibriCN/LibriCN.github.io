import type { AdminRole, AdminUser, Book, Library, LibraryBook, LibrarySection, Suggestion, SuggestionStatus } from './types'
import { appConfig } from './config'
import { invalidateCache, readCache, writeCache } from './cache'

const TOKEN_KEY = 'livro-perto-token'
const USER_KEY = 'livro-perto-user'
export const apiConfigured = Boolean(appConfig.apiUrl)

export class ApiError extends Error { constructor(message: string, public status = 0) { super(message) } }

function token() { try { return localStorage.getItem(TOKEN_KEY) || '' } catch { return '' } }
function setSession(value: { token: string; user: unknown } | null) { try { if (value) { localStorage.setItem(TOKEN_KEY, value.token); localStorage.setItem(USER_KEY, JSON.stringify(value.user)) } else { localStorage.removeItem(TOKEN_KEY); localStorage.removeItem(USER_KEY) } } catch { /* armazenamento pode estar indisponível */ } }
export function hasSession() { return Boolean(token()) }
export function currentUser(): AdminUser | null { try { const value = localStorage.getItem(USER_KEY); return value ? JSON.parse(value) as AdminUser : null } catch { return null } }

async function request<T>(path: string, options: RequestInit = {}) {
  if (!appConfig.apiUrl) throw new ApiError('API não configurada.', 0)
  const headers = new Headers(options.headers); headers.set('Accept', 'application/json'); if (options.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json'); if (token()) headers.set('Authorization', `Bearer ${token()}`)
  let response: Response
  try { response = await fetch(`${appConfig.apiUrl}${path}`, { ...options, headers }) } catch { throw new ApiError('Não foi possível conectar ao serviço do Livro Perto.', 0) }
  const contentType = response.headers.get('Content-Type') || ''; const data = contentType.includes('json') ? await response.json().catch(() => null) : await response.text()
  if (response.status === 401) { setSession(null); throw new ApiError('Sua sessão expirou. Entre novamente.', 401) }
  if (!response.ok) throw new ApiError(typeof data === 'object' && data && 'error' in data ? String(data.error) : 'A API não conseguiu concluir a solicitação.', response.status)
  return data as T
}

type ApiBook = Omit<Book, 'authors' | 'publicationYear' | 'coverUrl' | 'createdAt' | 'updatedAt'> & { authors: string[]; publicationYear: number | null; coverUrl: string; createdAt: string; updatedAt: string; libraries?: Array<{ id: string; libraryId: string; libraryName?: string; sectionId?: string; sectionName?: string; quantity: number; availableQuantity: number; status: LibraryBook['status']; shelfLocation: string; lastCheckedAt: string }> }
type ApiLibrary = Omit<Library, 'openingHours' | 'sections'> & { openingHours: string; sections?: LibrarySection[]; bookCount?: number }
export type ExternalBookResult = { source: string; externalSource?: string; externalId?: string; title: string; authors: string[]; isbn: string; publicationYear: number | null; genre: string; subject: string; description: string; coverUrl: string }

function toBook(book: ApiBook): Book { return { ...book, publicationYear: book.publicationYear || 0, coverUrl: book.coverUrl || 'https://covers.openlibrary.org/b/id/8228691-L.jpg' } }
function toLibrary(library: ApiLibrary): Library { return { ...library, sections: library.sections || [] } }
function holdingsFromBooks(books: ApiBook[]): LibraryBook[] { return books.flatMap(book => (book.libraries || []).map(holding => ({ id: holding.id, bookId: book.id, libraryId: holding.libraryId, quantity: holding.quantity, availableQuantity: holding.availableQuantity, status: holding.status, shelfLocation: holding.shelfLocation, sectionId: holding.sectionId, sectionName: holding.sectionName, lastCheckedAt: holding.lastCheckedAt }))) }
export async function loadPublicData() { const cacheKey = 'catalog:all'; const cached = readCache<ReturnType<typeof normalizePublicData>>(cacheKey); if (cached) return cached; const [bookResponse, libraryResponse] = await Promise.all([request<{ data: ApiBook[] }>('/api/books?limit=50'), request<{ data: ApiLibrary[] }>('/api/libraries')]); const data = normalizePublicData(bookResponse.data || [], libraryResponse.data || []); return writeCache(cacheKey, data, 30_000) }
function normalizePublicData(apiBooks: ApiBook[], apiLibraries: ApiLibrary[]) { return { books: apiBooks.map(toBook), libraries: apiLibraries.map(toLibrary), libraryBooks: holdingsFromBooks(apiBooks) } }
export async function listBooks(query = '') { const cacheKey = `catalog:search:${query.trim().toLowerCase()}`; const cached = readCache<{ books: Book[]; libraryBooks: LibraryBook[]; pagination: unknown }>(cacheKey); if (cached) return cached; const response = await request<{ data: ApiBook[]; pagination: unknown }>(`/api/books?limit=50${query ? `&q=${encodeURIComponent(query)}` : ''}`); return writeCache(cacheKey, { books: response.data.map(toBook), libraryBooks: holdingsFromBooks(response.data), pagination: response.pagination }, 15_000) }
export async function submitSuggestion(payload: { type: string; message: string; suggestedBookTitle?: string; suggestedAuthor?: string; title?: string; author?: string; contact: string }) { return request<{ id: string }>('/api/suggestions', { method: 'POST', body: JSON.stringify({ ...payload, suggestedBookTitle: payload.suggestedBookTitle || payload.title || '', suggestedAuthor: payload.suggestedAuthor || payload.author || '' }) }) }
export async function login(username: string, password: string) { const session = await request<{ token: string; expiresAt: number; user: AdminUser }>('/api/auth/login', { method: 'POST', body: JSON.stringify({ username, password }) }); setSession(session); return session }
export async function logout() { if (apiConfigured) await request('/api/auth/logout', { method: 'POST' }).catch(() => undefined); setSession(null) }
export async function adminListBooks(search = '') { return request<{ data: ApiBook[] }>('/api/admin/books?limit=100' + (search ? `&q=${encodeURIComponent(search)}` : '')) }
export async function createBook(book: Book) { const response = await request<ApiBook>('/api/admin/books', { method: 'POST', body: JSON.stringify(bookPayload(book)) }); invalidateCache('catalog:'); return toBook(response) }
export async function importBookReference(reference: string) { const response = await request<ApiBook>('/api/admin/books/import', { method: 'POST', body: JSON.stringify({ reference }) }); invalidateCache('catalog:'); return toBook(response) }
export async function importBookSelection(selection: ExternalBookResult) { const response = await request<ApiBook>('/api/admin/books/import', { method: 'POST', body: JSON.stringify({ selection: { ...selection, externalSource: selection.externalSource || 'openlibrary', externalId: selection.externalId || selection.isbn || selection.title } }) }); invalidateCache('catalog:'); return toBook(response) }
export async function updateBook(book: Book) { const response = await request<ApiBook>(`/api/admin/books/${book.id}`, { method: 'PUT', body: JSON.stringify(bookPayload(book)) }); invalidateCache('catalog:'); return toBook(response) }
export async function deleteBook(id: string) { const response = await request(`/api/admin/books/${id}`, { method: 'DELETE' }); invalidateCache('catalog:'); return response }
export async function createHolding(bookId: string, holding: LibraryBook) { const response = await request(`/api/admin/books/${bookId}/libraries`, { method: 'POST', body: JSON.stringify(holdingPayload(holding)) }); invalidateCache('catalog:'); return response }
export async function updateHolding(holding: LibraryBook) { const response = await request(`/api/admin/library-books/${holding.id}`, { method: 'PUT', body: JSON.stringify(holdingPayload(holding)) }); invalidateCache('catalog:'); return response }
export async function deleteHolding(id: string) { const response = await request(`/api/admin/library-books/${id}`, { method: 'DELETE' }); invalidateCache('catalog:'); return response }
export async function listAdminLibraries() { return request<{ data: ApiLibrary[] }>('/api/admin/libraries') }
export async function createLibrary(library: Library) { const response = await request<ApiLibrary>('/api/admin/libraries', { method: 'POST', body: JSON.stringify(libraryPayload(library)) }); invalidateCache('catalog:'); return toLibrary(response) }
export async function updateLibrary(library: Library) { const response = await request<ApiLibrary>(`/api/admin/libraries/${library.id}`, { method: 'PUT', body: JSON.stringify(libraryPayload(library)) }); invalidateCache('catalog:'); return toLibrary(response) }
export async function deleteLibrary(id: string) { const response = await request(`/api/admin/libraries/${id}`, { method: 'DELETE' }); invalidateCache('catalog:'); return response }
export async function listSuggestions(status = '') { const response = await request<{ data: Array<Record<string, unknown>> }>(`/api/admin/suggestions${status ? `?status=${encodeURIComponent(status)}` : ''}`); return (response.data || []).map(toSuggestion) }
export async function updateSuggestion(id: string, status: SuggestionStatus) { return request(`/api/admin/suggestions/${id}`, { method: 'PUT', body: JSON.stringify({ status }) }) }
export async function externalBooks(query: string) { return request<{ data: ExternalBookResult[] }>(`/api/admin/external-books?query=${encodeURIComponent(query)}`) }
export async function downloadCsv() { if (!appConfig.apiUrl) throw new ApiError('API não configurada.'); const headers = new Headers({ Authorization: `Bearer ${token()}` }); const response = await fetch(`${appConfig.apiUrl}/api/admin/export/csv`, { headers }); if (!response.ok) throw new ApiError('Não foi possível exportar o acervo.', response.status); return response.blob() }
export async function cloudinaryConfig() { return request<{ enabled: boolean; provider: 'cloudinary'; cloudName: string; uploadPreset: string }>('/api/admin/media/config') }
export async function uploadToCloudinary(file: File, config: { cloudName: string; uploadPreset: string }) { const form = new FormData(); form.append('file', file); form.append('upload_preset', config.uploadPreset); let response: Response; try { response = await fetch(`https://api.cloudinary.com/v1_1/${encodeURIComponent(config.cloudName)}/auto/upload`, { method: 'POST', body: form }) } catch { throw new ApiError('Não foi possível enviar a imagem.') } const data = await response.json().catch(() => null) as { secure_url?: string } | null; if (!response.ok || !data?.secure_url) throw new ApiError('O Cloudinary não aceitou a imagem.', response.status); return data.secure_url }
function bookPayload(book: Book) { return { title: book.title, authors: book.authors, description: book.description, isbn: book.isbn, genre: book.genre, subject: book.subject, publicationYear: book.publicationYear, coverUrl: book.coverUrl, externalSource: book.externalSource, externalId: book.externalId } }
function holdingPayload(holding: LibraryBook) { return { libraryId: holding.libraryId, sectionId: holding.sectionId || null, quantity: holding.quantity, availableQuantity: holding.availableQuantity, status: holding.status, shelfLocation: holding.shelfLocation } }
function libraryPayload(library: Library) { return { name: library.name, address: library.address, openingHours: library.openingHours, phone: library.phone, email: library.email, description: library.description, imageUrl: library.imageUrl, libraryType: library.libraryType, latitude: library.latitude, longitude: library.longitude } }
function toSuggestion(value: Record<string, unknown>): Suggestion { return { id: String(value.id), type: String(value.type) as Suggestion['type'], message: String(value.message || ''), suggestedBookTitle: String(value.suggested_book_title || ''), suggestedAuthor: String(value.suggested_author || ''), contact: String(value.contact || ''), status: String(value.status || 'pendente') as SuggestionStatus, createdAt: String(value.created_at || '') } }

export async function listSections(libraryId: string) { const response = await request<{ data: LibrarySection[] }>(`/api/admin/libraries/${libraryId}/sections`); return response.data || [] }
export async function createSection(libraryId: string, section: Omit<LibrarySection, 'id' | 'libraryId'>) { const response = await request<LibrarySection>(`/api/admin/libraries/${libraryId}/sections`, { method: 'POST', body: JSON.stringify({ name: section.name, description: section.description, sortOrder: section.sortOrder }) }); invalidateCache('catalog:'); return response }
export async function updateSection(section: LibrarySection) { const response = await request<LibrarySection>(`/api/admin/sections/${section.id}`, { method: 'PUT', body: JSON.stringify({ name: section.name, description: section.description, sortOrder: section.sortOrder }) }); invalidateCache('catalog:'); return response }
export async function deleteSection(id: string) { const response = await request(`/api/admin/sections/${id}`, { method: 'DELETE' }); invalidateCache('catalog:'); return response }
export async function listUsers() { return request<{ data: AdminUser[] }>('/api/admin/users') }
export async function createUser(payload: { username: string; password: string; role: AdminRole; allLibraries: boolean; libraryIds: string[] }) { return request<AdminUser>('/api/admin/users', { method: 'POST', body: JSON.stringify(payload) }) }
export async function updateUser(id: number, payload: Partial<{ username: string; password: string; role: AdminRole; allLibraries: boolean; libraryIds: string[]; isActive: boolean }>) { return request<AdminUser>(`/api/admin/users/${id}`, { method: 'PUT', body: JSON.stringify(payload) }) }
export async function deactivateUser(id: number) { return request(`/api/admin/users/${id}`, { method: 'DELETE' }) }
