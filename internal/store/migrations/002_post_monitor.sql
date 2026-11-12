CREATE TABLE IF NOT EXISTS own_posts (id TEXT PRIMARY KEY, data TEXT NOT NULL CHECK(json_valid(data)));
CREATE TABLE IF NOT EXISTS post_syncs (id TEXT PRIMARY KEY, data TEXT NOT NULL CHECK(json_valid(data)));
INSERT OR IGNORE INTO schema_migrations VALUES (2, datetime('now'));
