ALTER TABLE books ADD COLUMN external_source TEXT NOT NULL DEFAULT '';
ALTER TABLE books ADD COLUMN external_id TEXT NOT NULL DEFAULT '';

CREATE INDEX IF NOT EXISTS idx_books_external_reference ON books(external_source, external_id);
