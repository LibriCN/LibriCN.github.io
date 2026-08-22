CREATE TABLE library_sections (
  id TEXT PRIMARY KEY,
  library_id TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  sort_order INTEGER NOT NULL DEFAULT 0,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(library_id, name),
  FOREIGN KEY(library_id) REFERENCES libraries(id) ON DELETE CASCADE
);

ALTER TABLE library_books ADD COLUMN section_id TEXT REFERENCES library_sections(id) ON DELETE SET NULL;

CREATE INDEX idx_library_sections_library ON library_sections(library_id, sort_order, name COLLATE NOCASE);
CREATE INDEX idx_library_books_section ON library_books(section_id);
