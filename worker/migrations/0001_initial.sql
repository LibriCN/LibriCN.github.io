PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS books (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  authors_json TEXT NOT NULL DEFAULT '[]',
  description TEXT NOT NULL DEFAULT '',
  isbn TEXT NOT NULL DEFAULT '',
  genre TEXT NOT NULL DEFAULT 'Não classificado',
  subject TEXT NOT NULL DEFAULT '',
  publication_year INTEGER,
  cover_url TEXT NOT NULL DEFAULT '',
  search_count INTEGER NOT NULL DEFAULT 0,
  is_deleted INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_books_title ON books(title COLLATE NOCASE);
CREATE INDEX IF NOT EXISTS idx_books_genre ON books(genre);
CREATE INDEX IF NOT EXISTS idx_books_isbn ON books(isbn);
CREATE INDEX IF NOT EXISTS idx_books_active ON books(is_deleted);

CREATE TABLE IF NOT EXISTS libraries (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  address TEXT NOT NULL DEFAULT '',
  opening_hours TEXT NOT NULL DEFAULT '',
  phone TEXT NOT NULL DEFAULT '',
  email TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '',
  latitude REAL,
  longitude REAL,
  is_deleted INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_libraries_name ON libraries(name COLLATE NOCASE);
CREATE INDEX IF NOT EXISTS idx_libraries_active ON libraries(is_deleted);

CREATE TABLE IF NOT EXISTS library_books (
  id TEXT PRIMARY KEY,
  book_id TEXT NOT NULL,
  library_id TEXT NOT NULL,
  quantity INTEGER NOT NULL DEFAULT 0 CHECK(quantity >= 0),
  available_quantity INTEGER NOT NULL DEFAULT 0 CHECK(available_quantity >= 0 AND available_quantity <= quantity),
  status TEXT NOT NULL DEFAULT 'indisponivel' CHECK(status IN ('disponivel', 'emprestado', 'indisponivel')),
  shelf_location TEXT NOT NULL DEFAULT '',
  last_checked_at TEXT NOT NULL,
  UNIQUE(book_id, library_id),
  FOREIGN KEY(book_id) REFERENCES books(id) ON DELETE CASCADE,
  FOREIGN KEY(library_id) REFERENCES libraries(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_library_books_book ON library_books(book_id);
CREATE INDEX IF NOT EXISTS idx_library_books_library ON library_books(library_id);
CREATE INDEX IF NOT EXISTS idx_library_books_status ON library_books(status);

CREATE TABLE IF NOT EXISTS suggestions (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL CHECK(type IN ('Sugerir livro', 'Informar correção')),
  message TEXT NOT NULL,
  suggested_book_title TEXT NOT NULL DEFAULT '',
  suggested_author TEXT NOT NULL DEFAULT '',
  contact TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'pendente' CHECK(status IN ('pendente', 'em_analise', 'resolvida', 'rejeitada')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_suggestions_status ON suggestions(status);
CREATE INDEX IF NOT EXISTS idx_suggestions_created ON suggestions(created_at DESC);

CREATE TABLE IF NOT EXISTS admins (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'admin' CHECK(role IN ('admin', 'editor', 'viewer')),
  created_at TEXT NOT NULL,
  last_login_at TEXT
);
