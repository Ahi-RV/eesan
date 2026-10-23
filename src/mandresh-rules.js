const path = require('node:path');

const RULES_VERSION = 'MANDRESH-2026.09.30-r1';
const DRAWING_TYPES = ['Manhole', 'Duct', 'Card', 'SLD', 'Planmap'];

function textOf(...values) { return values.filter(Boolean).join('\n'); }
function unique(values) { return [...new Set(values.filter(Boolean))]; }
function digits(value) { return String(value || '').match(/\d{2,}/)?.[0] || ''; }
function firstFolder(document) { return String(document.relativePath || '').split(/[\\/]/)[0] || ''; }
function normalizeType(value) { return DRAWING_TYPES.find((type) => type.toLowerCase() === String(value || '').toLowerCase()) || null; }

function detectManholeNumbers(text) {
  const source = String(text || '');
  const labelled = [...source.matchAll(/\b(?:MH|MANHOLE|M\/H)\s*[:#.-]?\s*(\d{2,})\b/gi)].map((match) => `MH${match[1]}`);
  const standaloneLikely = [...source.matchAll(/\b(?:10|11|31)\d{5}\b/g)].map((match) => `MH${match[0]}`);
  return unique([...labelled, ...standaloneLikely]);
}

function detectFromTo(text) {
  const source = String(text || '');
  const pairs = [];
  for (const match of source.matchAll(/\bFROM\s*(?:MH|MANHOLE|M\/H)?\s*[:#.-]?\s*(\d{2,})\s*(?:TO|[-→>]+)\s*(?:MH|MANHOLE|M\/H)?\s*[:#.-]?\s*(\d{2,})\b/gi)) {
    pairs.push({ from: `MH${match[1]}`, to: `MH${match[2]}` });
  }
  for (const match of source.matchAll(/\b(?:MH|MANHOLE|M\/H)\s*[:#.-]?\s*(\d{2,})\s*(?:TO|[-→>]+)\s*(?:MH|MANHOLE|M\/H)\s*[:#.-]?\s*(\d{2,})\b/gi)) {
    pairs.push({ from: `MH${match[1]}`, to: `MH${match[2]}` });
  }
  return unique(pairs.map((pair) => `${pair.from}->${pair.to}`)).map((value) => {
    const [from, to] = value.split('->');
    return { from, to };
  });
}

function detectCabinetNumbers(text) {
  return unique([...String(text || '').matchAll(/\b(?:CABINET|CAB|CB)\s*[:#.-]?\s*([A-Z0-9][A-Z0-9/-]{1,})\b/gi)].map((match) => match[1].toUpperCase()));
}

function detectRoadNames(text) {
  const suffix = 'ROAD|RD|STREET|ST|AVENUE|AVE|DRIVE|DR|LANE|LN|CRESCENT|CRES|WAY|CLOSE|CL|PLACE|PL|BOULEVARD|BLVD|HIGHWAY|HWY';
  return unique([...String(text || '').matchAll(new RegExp(`\\b([A-Z][A-Z0-9' -]{2,80}\\s(?:${suffix}))\\b`, 'g'))].map((match) => match[1].replace(/\s+/g, ' ').trim()));
}

function detectProjectNumbers(text) {
  return unique([...String(text || '').matchAll(/\b(?:PROJECT|PROJ|WO|W\/O|JOB|DRAWING|DWG)\s*(?:NO\.?|#|:)?\s*([A-Z0-9][A-Z0-9._/-]{2,})\b/gi)].map((match) => match[1].toUpperCase()));
}

function classifyDocument(document, pages = []) {
  const source = textOf(document.relativePath, document.filename, ...pages.map((page) => page.text));
  const folder = firstFolder(document).toLowerCase();
  const name = String(document.filename || '');
  const types = new Set();
  if (detectManholeNumbers(source).length || /\bMANHOLE\b|\bMH\b/i.test(source)) types.add('Manhole');
  if (folder.includes('duct') || /\bDUCT\b/i.test(source)) types.add('Duct');
  if (folder.includes('card') || /\bCARD\b|\bMANHOLE\s+CARD\b/i.test(source)) types.add('Card');
  if (/\bSLD\b|SINGLE\s+LINE/i.test(source) || /(?:^|[^A-Z0-9])SLD(?:[^A-Z0-9]|$)/i.test(name)) types.add('SLD');
  if (/\bPLAN\s*MAP\b|\bPLANMAP\b|\bPLANT\s*MAP\b/i.test(source)) types.add('Planmap');
  return [...types];
}

function entitiesForDocument(document, pages = []) {
  const source = textOf(document.relativePath, document.filename, ...pages.map((page) => page.text));
  return {
    manholes: detectManholeNumbers(source),
    fromTo: detectFromTo(source),
    cabinets: detectCabinetNumbers(source),
    roads: detectRoadNames(source),
    projects: unique([document.projectNumber, ...detectProjectNumbers(source)])
  };
}

function relationshipForDocument(document, pages = []) {
  const types = classifyDocument(document, pages);
  const entities = entitiesForDocument(document, pages);
  return {
    sourceDocumentId: document.sourceDocumentId,
    filename: document.filename,
    relativePath: document.relativePath,
    projectNumber: document.projectNumber,
    hierarchy: {
      manhole: { linkedTo: ['Duct', 'Card'], present: types.includes('Manhole') },
      project: { linkedTo: ['SLD', 'Planmap'], present: Boolean(document.projectNumber || entities.projects.length) }
    },
    types,
    entities
  };
}

function sameFilenameGroups(documents) {
  const groups = new Map();
  for (const document of documents) {
    const key = String(document.filename || '').toLowerCase();
    if (!key) continue;
    const group = groups.get(key) || [];
    group.push(document);
    groups.set(key, group);
  }
  return [...groups.values()].filter((group) => group.length > 1).map((group) => ({
    filename: group[0].filename,
    count: group.length,
    documents: group.map((document) => ({
      sourceDocumentId: document.sourceDocumentId,
      filename: document.filename,
      relativePath: document.relativePath,
      size: document.size,
      lastModifiedDateTime: document.lastModifiedDateTime,
      reviewRecommendation: document === group.slice().sort((a, b) => Number(b.lastModifiedMs || 0) - Number(a.lastModifiedMs || 0))[0] ? 'keep-newest' : 'review-before-removal'
    }))
  }));
}

function duplicateFileGroups(documents) {
  const groups = new Map();
  for (const document of documents) {
    const key = `${document.size || 0}:${path.extname(document.filename || '').toLowerCase()}:${String(document.filename || '').toLowerCase()}`;
    const group = groups.get(key) || [];
    group.push(document);
    groups.set(key, group);
  }
  return [...groups.values()].filter((group) => group.length > 1).map((group) => ({
    fingerprint: `${group[0].filename} · ${group[0].size || 0} bytes`,
    count: group.length,
    documents: group.map((document) => ({
      sourceDocumentId: document.sourceDocumentId,
      filename: document.filename,
      relativePath: document.relativePath,
      size: document.size,
      lastModifiedDateTime: document.lastModifiedDateTime
    }))
  }));
}

module.exports = {
  RULES_VERSION,
  DRAWING_TYPES,
  normalizeType,
  classifyDocument,
  entitiesForDocument,
  relationshipForDocument,
  sameFilenameGroups,
  duplicateFileGroups,
  detectManholeNumbers,
  detectFromTo,
  detectCabinetNumbers,
  detectRoadNames,
  detectProjectNumbers
};
