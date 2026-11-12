CREATE TABLE IF NOT EXISTS mobile_handoffs (id TEXT PRIMARY KEY, data TEXT NOT NULL CHECK(json_valid(data)));
INSERT OR IGNORE INTO schema_migrations VALUES (9, datetime('now'));
