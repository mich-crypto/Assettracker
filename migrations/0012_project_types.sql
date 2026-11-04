-- Equipment types per project. project_id NULL = the standard types; a project that has its
-- own copy uses only that copy (see typesOfProject in src/api.js).
ALTER TABLE asset_types ADD COLUMN project_id TEXT;
CREATE INDEX idx_asset_types_project ON asset_types(project_id);
