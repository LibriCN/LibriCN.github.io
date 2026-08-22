-- Substitui os papéis antigos por perfis operacionais e cria escopos por biblioteca.
PRAGMA foreign_keys = OFF;

CREATE TABLE admins_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'categorizer' CHECK(role IN ('admin', 'manager', 'categorizer', 'viewer')),
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  last_login_at TEXT
);

INSERT INTO admins_new (id, username, password_hash, role, is_active, created_at, last_login_at)
SELECT id, username, password_hash,
  CASE role WHEN 'editor' THEN 'manager' WHEN 'viewer' THEN 'viewer' ELSE 'admin' END,
  1, created_at, last_login_at
FROM admins;

DROP TABLE admins;
ALTER TABLE admins_new RENAME TO admins;

CREATE TABLE admin_library_access (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  admin_id INTEGER NOT NULL,
  library_id TEXT,
  all_libraries INTEGER NOT NULL DEFAULT 0 CHECK(all_libraries IN (0, 1)),
  UNIQUE(admin_id, library_id),
  FOREIGN KEY(admin_id) REFERENCES admins(id) ON DELETE CASCADE,
  FOREIGN KEY(library_id) REFERENCES libraries(id) ON DELETE CASCADE,
  CHECK((all_libraries = 1 AND library_id IS NULL) OR (all_libraries = 0 AND library_id IS NOT NULL))
);

CREATE INDEX idx_admin_library_access_admin ON admin_library_access(admin_id);
CREATE INDEX idx_admin_library_access_library ON admin_library_access(library_id);

-- O usuário de demonstração nunca deve permanecer no banco produtivo.
DELETE FROM admins WHERE username = 'admin@livroperto.org';

PRAGMA foreign_keys = ON;
