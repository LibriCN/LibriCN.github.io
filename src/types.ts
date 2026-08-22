export type AvailabilityStatus = 'disponivel' | 'emprestado' | 'indisponivel'
export type AdminRole = 'admin' | 'manager' | 'categorizer' | 'viewer'
export type SuggestionStatus = 'pendente' | 'em_analise' | 'resolvida'
export type SuggestionType = 'Sugerir livro' | 'Informar correção'

export interface Book {
  id: string
  title: string
  authors: string[]
  description: string
  isbn: string
  genre: string
  subject: string
  publicationYear: number
  coverUrl: string
  externalSource?: string
  externalId?: string
  createdAt: string
  updatedAt: string
}

export interface Library {
  id: string
  name: string
  address: string
  openingHours: string
  phone: string
  email: string
  description: string
  imageUrl: string
  libraryType: 'escolar' | 'publica_comunitaria'
  latitude: number
  longitude: number
  sections: LibrarySection[]
}

export interface LibrarySection { id: string; libraryId: string; name: string; description: string; sortOrder: number }

export interface LibraryBook {
  id: string
  bookId: string
  libraryId: string
  quantity: number
  availableQuantity: number
  status: AvailabilityStatus
  shelfLocation: string
  sectionId?: string
  sectionName?: string
  lastCheckedAt: string
}

export interface AdminUser { id: number; username: string; role: AdminRole; isActive: boolean; allLibraries: boolean; libraryIds: string[]; createdAt: string; lastLoginAt: string | null }

export interface Suggestion {
  id: string
  type: SuggestionType
  message: string
  suggestedBookTitle: string
  suggestedAuthor: string
  contact: string
  status: SuggestionStatus
  createdAt: string
}
