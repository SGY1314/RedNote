UPDATE publications SET data=json_set(data,'$.target_platform','xhs') WHERE json_extract(data,'$.target_platform') IS NULL OR json_extract(data,'$.target_platform')='';
INSERT OR IGNORE INTO schema_migrations VALUES(3, datetime('now'));
