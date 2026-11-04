import { createContext, useContext } from 'react'
import type { Dispatch, SetStateAction } from 'react'
import type { AdminUser, Book, Library, LibraryBook, Suggestion } from './types'

type ContextValue = {
  books: Book[]; setBooks: Dispatch<SetStateAction<Book[]>>
  libraries: Library[]; setLibraries: Dispatch<SetStateAction<Library[]>>
  libraryBooks: LibraryBook[]; setLibraryBooks: Dispatch<SetStateAction<LibraryBook[]>>
  suggestions: Suggestion[]; setSuggestions: Dispatch<SetStateAction<Suggestion[]>>
  admin: boolean; setAdmin: (value: boolean) => void
  adminUser: AdminUser | null; setAdminUser: (value: AdminUser | null) => void
  dataSource: 'api' | 'local'
}

export const AppContext = createContext<ContextValue | null>(null)
export function useApp() { const context = useContext(AppContext); if (!context) throw new Error('AppContext ausente'); return context }
