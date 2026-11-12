CREATE TABLE IF NOT EXISTS video_scripts (id TEXT PRIMARY KEY, data TEXT NOT NULL CHECK(json_valid(data)));
INSERT OR IGNORE INTO schema_migrations VALUES (5, datetime('now'));
