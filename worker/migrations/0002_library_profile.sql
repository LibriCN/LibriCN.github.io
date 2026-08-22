ALTER TABLE libraries ADD COLUMN image_url TEXT NOT NULL DEFAULT '';
ALTER TABLE libraries ADD COLUMN library_type TEXT NOT NULL DEFAULT 'publica_comunitaria' CHECK(library_type IN ('escolar', 'publica_comunitaria'));

CREATE INDEX IF NOT EXISTS idx_libraries_type ON libraries(library_type);
