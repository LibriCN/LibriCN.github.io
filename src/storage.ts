import { initialBooks, initialLibraries, initialLibraryBooks, initialSuggestions } from './data'
import type { Book, Library, LibraryBook, Suggestion } from './types'

const keys = { books: 'livro-perto-books', libraries: 'livro-perto-libraries', libraryBooks: 'livro-perto-library-books', suggestions: 'livro-perto-suggestions' }

function read<T>(key: string, fallback: T): T {
  try { const value = localStorage.getItem(key); if (!value) return fallback; const parsed = JSON.parse(value) as T; if (!Array.isArray(parsed)) return parsed; const oldDemoIds = new Set(['b1', 'b2', 'b3', 'b4', 'b5', 'b6', 'l1', 'l2', 'l3', 'lb1', 'lb2', 'lb3', 'lb4', 'lb5', 'lb6', 'lb7', 'lb8', 'lb9', 's1', 's2']); return parsed.filter(item => !oldDemoIds.has(String((item as { id?: string }).id))) as T } catch { return fallback }
}
function write<T>(key: string, value: T) { localStorage.setItem(key, JSON.stringify(value)) }

export const repository = {
  getBooks: () => read<Book[]>(keys.books, initialBooks),
  getLibraries: () => read<Library[]>(keys.libraries, initialLibraries),
  getLibraryBooks: () => read<LibraryBook[]>(keys.libraryBooks, initialLibraryBooks),
  getSuggestions: () => read<Suggestion[]>(keys.suggestions, initialSuggestions),
  saveBooks: (value: Book[]) => write(keys.books, value),
  saveLibraries: (value: Library[]) => write(keys.libraries, value),
  saveLibraryBooks: (value: LibraryBook[]) => write(keys.libraryBooks, value),
  saveSuggestions: (value: Suggestion[]) => write(keys.suggestions, value),
}
