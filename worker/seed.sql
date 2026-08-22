-- Bootstrap local: o catálogo público começa vazio para receber dados reais.
-- Troque esta credencial antes de disponibilizar o Worker em produção.
INSERT OR IGNORE INTO admins (username, password_hash, role, created_at)
VALUES ('admin@livroperto.org', 'pbkdf2$100000$bGl2cm8tcGVydG8tZGVtbw==$Q5A+Wo1+RNvZL1hj1UpvT5BAJT5BhIMGQ9dzwfcEcbI=', 'admin', datetime('now'));
