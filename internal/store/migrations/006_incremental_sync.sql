CREATE TABLE IF NOT EXISTS sync_changes (seq INTEGER PRIMARY KEY AUTOINCREMENT, entity TEXT NOT NULL, record_id TEXT NOT NULL, UNIQUE(entity, record_id));
INSERT INTO sync_changes(entity,record_id) SELECT 'jobs',id FROM jobs WHERE NOT EXISTS (SELECT 1 FROM schema_migrations WHERE version=6);
CREATE TRIGGER IF NOT EXISTS sync_jobs_insert AFTER INSERT ON jobs BEGIN
DELETE FROM sync_changes WHERE entity='jobs' AND record_id=NEW.id;
INSERT INTO sync_changes(entity,record_id) VALUES('jobs',NEW.id);
END;
CREATE TRIGGER IF NOT EXISTS sync_jobs_update AFTER UPDATE ON jobs BEGIN
DELETE FROM sync_changes WHERE entity='jobs' AND record_id=NEW.id;
INSERT INTO sync_changes(entity,record_id) VALUES('jobs',NEW.id);
END;
CREATE TRIGGER IF NOT EXISTS sync_jobs_delete AFTER DELETE ON jobs BEGIN
DELETE FROM sync_changes WHERE entity='jobs' AND record_id=OLD.id;
INSERT INTO sync_changes(entity,record_id) VALUES('jobs',OLD.id);
END;
INSERT INTO sync_changes(entity,record_id) SELECT 'assets',id FROM assets WHERE NOT EXISTS (SELECT 1 FROM schema_migrations WHERE version=6);
CREATE TRIGGER IF NOT EXISTS sync_assets_insert AFTER INSERT ON assets BEGIN
DELETE FROM sync_changes WHERE entity='assets' AND record_id=NEW.id;
INSERT INTO sync_changes(entity,record_id) VALUES('assets',NEW.id);
END;
CREATE TRIGGER IF NOT EXISTS sync_assets_update AFTER UPDATE ON assets BEGIN
DELETE FROM sync_changes WHERE entity='assets' AND record_id=NEW.id;
INSERT INTO sync_changes(entity,record_id) VALUES('assets',NEW.id);
END;
CREATE TRIGGER IF NOT EXISTS sync_assets_delete AFTER DELETE ON assets BEGIN
DELETE FROM sync_changes WHERE entity='assets' AND record_id=OLD.id;
INSERT INTO sync_changes(entity,record_id) VALUES('assets',OLD.id);
END;
INSERT INTO sync_changes(entity,record_id) SELECT 'projects',id FROM projects WHERE NOT EXISTS (SELECT 1 FROM schema_migrations WHERE version=6);
CREATE TRIGGER IF NOT EXISTS sync_projects_insert AFTER INSERT ON projects BEGIN
DELETE FROM sync_changes WHERE entity='projects' AND record_id=NEW.id;
INSERT INTO sync_changes(entity,record_id) VALUES('projects',NEW.id);
END;
CREATE TRIGGER IF NOT EXISTS sync_projects_update AFTER UPDATE ON projects BEGIN
DELETE FROM sync_changes WHERE entity='projects' AND record_id=NEW.id;
INSERT INTO sync_changes(entity,record_id) VALUES('projects',NEW.id);
END;
CREATE TRIGGER IF NOT EXISTS sync_projects_delete AFTER DELETE ON projects BEGIN
DELETE FROM sync_changes WHERE entity='projects' AND record_id=OLD.id;
INSERT INTO sync_changes(entity,record_id) VALUES('projects',OLD.id);
END;
INSERT INTO sync_changes(entity,record_id) SELECT 'publications',id FROM publications WHERE NOT EXISTS (SELECT 1 FROM schema_migrations WHERE version=6);
CREATE TRIGGER IF NOT EXISTS sync_publications_insert AFTER INSERT ON publications BEGIN
DELETE FROM sync_changes WHERE entity='publications' AND record_id=NEW.id;
INSERT INTO sync_changes(entity,record_id) VALUES('publications',NEW.id);
END;
CREATE TRIGGER IF NOT EXISTS sync_publications_update AFTER UPDATE ON publications BEGIN
DELETE FROM sync_changes WHERE entity='publications' AND record_id=NEW.id;
INSERT INTO sync_changes(entity,record_id) VALUES('publications',NEW.id);
END;
CREATE TRIGGER IF NOT EXISTS sync_publications_delete AFTER DELETE ON publications BEGIN
DELETE FROM sync_changes WHERE entity='publications' AND record_id=OLD.id;
INSERT INTO sync_changes(entity,record_id) VALUES('publications',OLD.id);
END;
INSERT OR IGNORE INTO schema_migrations VALUES (6, datetime('now'));
