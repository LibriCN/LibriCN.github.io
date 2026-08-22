export interface Env {
  DB: D1Database
  CORS_ORIGIN?: string
  CITY_NAME?: string
  JWT_SECRET?: string
  JWT_TTL_DAYS?: string
  GOOGLE_BOOKS_API_KEY?: string
  CLOUDINARY_CLOUD_NAME?: string
  CLOUDINARY_UPLOAD_PRESET?: string
}

export type Role = 'admin' | 'manager' | 'categorizer' | 'viewer'
export type BookStatus = 'disponivel' | 'emprestado' | 'indisponivel'
export type SuggestionStatus = 'pendente' | 'em_analise' | 'resolvida' | 'rejeitada'

export interface DbBook {
  id: string; title: string; authors_json: string; description: string; isbn: string; genre: string; subject: string; publication_year: number | null; cover_url: string; external_source: string; external_id: string; search_count: number; created_at: string; updated_at: string
}
export interface DbLibrary {
  id: string; name: string; address: string; opening_hours: string; phone: string; email: string; description: string; image_url: string; library_type: 'escolar' | 'publica_comunitaria'; latitude: number | null; longitude: number | null; created_at: string; updated_at: string
}
export interface DbLibraryBook {
  id: string; book_id: string; library_id: string; section_id: string | null; quantity: number; available_quantity: number; status: BookStatus; shelf_location: string; last_checked_at: string
}

export interface DbLibrarySection { id: string; library_id: string; name: string; description: string; sort_order: number; is_active: number; created_at: string; updated_at: string }
export interface LibrarySectionDto { id: string; libraryId: string; name: string; description: string; sortOrder: number }

export interface BookDto {
  id: string; title: string; authors: string[]; description: string; isbn: string; genre: string; subject: string; publicationYear: number | null; coverUrl: string; externalSource?: string; externalId?: string; searchCount?: number; createdAt: string; updatedAt: string
}
export interface LibraryDto {
  id: string; name: string; address: string; openingHours: string; phone: string; email: string; description: string; imageUrl: string; libraryType: 'escolar' | 'publica_comunitaria'; latitude: number | null; longitude: number | null; sections?: LibrarySectionDto[]
}
export interface HoldingDto {
  id: string; libraryId: string; libraryName?: string; sectionId?: string; sectionName?: string; quantity: number; availableQuantity: number; status: BookStatus; shelfLocation: string; lastCheckedAt: string
}

export interface AuthUser { id: number; username: string; role: Role; allLibraries: boolean; libraryIds: string[] }
