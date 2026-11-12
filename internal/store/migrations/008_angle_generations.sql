CREATE TABLE IF NOT EXISTS angle_generations (id TEXT PRIMARY KEY, data TEXT NOT NULL);
INSERT OR IGNORE INTO schema_migrations VALUES (8, datetime('now'));
