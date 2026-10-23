/**
 * Stage 2 contract. Stage 1 does not create a search database yet; it produces
 * ProjectDocument records that can be stored without changing their shape.
 */
function projectNumberFromFilename(filename) {
  const stem = filename.replace(/\.pdf$/i, '').trim();
  // EESAN project numbers use a leading code such as G.1000.253.07.191.001.
  // Anything following it identifies a document within that project.
  return stem.match(/^[A-Za-z]\.\d{4}\.\d{3}\.\d{2}\.\d{3}\.\d{3}/)?.[0] || stem;
}
function documentLabelFromFilename(filename) {
  const stem = filename.replace(/\.pdf$/i, '').trim(); const projectNumber = projectNumberFromFilename(filename);
  return stem.slice(projectNumber.length).replace(/^[\s_-]+/, '').trim() || null;
}
function documentTypeFromFilename(filename) {
  const label = (documentLabelFromFilename(filename) || '').toLowerCase();
  if (label.includes('sld')) return 'SLD';
  if (label.includes('plan') && label.includes('map')) return 'Planmap';
  if (label.includes('manhole') && label.includes('card') || label === 'card') return 'MH Card';
  if (label.includes('duct')) return 'Duct';
  if (label.includes('termination')) return 'Termination';
  return 'Project document';
}

function toProjectDocument(graphItem) {
  return {
    sourceDriveItemId: graphItem.id,
    projectNumber: projectNumberFromFilename(graphItem.name),
    documentLabel: documentLabelFromFilename(graphItem.name),
    documentType: documentTypeFromFilename(graphItem.name),
    filename: graphItem.name,
    oneDrivePath: graphItem.path,
    webUrl: graphItem.webUrl,
    size: graphItem.size,
    lastModifiedDateTime: graphItem.lastModifiedDateTime
  };
}

// This schema supports many pages, types, and detected entities per PDF page.
const STAGE_2_SCHEMA = `
CREATE TABLE projects (
  id TEXT PRIMARY KEY,
  project_number TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL
);
CREATE TABLE project_documents (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id),
  source_drive_item_id TEXT NOT NULL UNIQUE,
  filename TEXT NOT NULL,
  one_drive_path TEXT NOT NULL,
  web_url TEXT,
  content_hash TEXT,
  page_count INTEGER,
  last_modified_at TEXT NOT NULL
);
CREATE TABLE document_pages (
  id TEXT PRIMARY KEY,
  document_id TEXT NOT NULL REFERENCES project_documents(id),
  page_number INTEGER NOT NULL,
  extracted_text TEXT,
  text_source TEXT NOT NULL CHECK (text_source IN ('pdf', 'ocr', 'none')),
  text_indexed_at TEXT,
  UNIQUE (document_id, page_number)
);
CREATE TABLE page_classifications (
  page_id TEXT NOT NULL REFERENCES document_pages(id),
  drawing_type TEXT NOT NULL,
  confidence REAL,
  PRIMARY KEY (page_id, drawing_type)
);
CREATE TABLE detected_entities (
  id TEXT PRIMARY KEY,
  page_id TEXT NOT NULL REFERENCES document_pages(id),
  entity_type TEXT NOT NULL CHECK (entity_type IN ('manhole_number', 'cabinet_number', 'other')),
  normalized_value TEXT NOT NULL,
  original_value TEXT NOT NULL,
  confidence REAL,
  text_start INTEGER,
  text_end INTEGER
);
CREATE INDEX detected_entities_lookup ON detected_entities(entity_type, normalized_value);
`;

module.exports = { projectNumberFromFilename, documentLabelFromFilename, documentTypeFromFilename, toProjectDocument, STAGE_2_SCHEMA };

