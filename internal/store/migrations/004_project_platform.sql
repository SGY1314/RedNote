-- Keep source projects with their original platform. Manual legacy projects
-- follow an unambiguous publication destination, otherwise default to XHS.
UPDATE projects SET data=json_set(data,'$.platform',COALESCE(
 (SELECT json_extract(notes.data,'$.platform') FROM notes WHERE notes.id=json_extract(projects.data,'$.note_id')),
 (SELECT CASE WHEN COUNT(DISTINCT json_extract(publications.data,'$.target_platform'))=1 THEN MIN(json_extract(publications.data,'$.target_platform')) END FROM publications WHERE json_extract(publications.data,'$.project_id')=projects.id),
 'xhs')) WHERE COALESCE(json_extract(data,'$.platform'),'')='';
INSERT OR IGNORE INTO schema_migrations VALUES(4, datetime('now'));
