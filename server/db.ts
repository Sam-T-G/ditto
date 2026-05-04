import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';

// ── Setup ─────────────────────────────────────────────────────────────────────

const DATA_DIR = path.resolve(process.cwd(), 'data');
export const UPLOADS_DIR = path.join(DATA_DIR, 'uploads');
fs.mkdirSync(UPLOADS_DIR, { recursive: true });

export const db = new Database(path.join(DATA_DIR, 'textura.db'));

// Performance pragmas — applied once at startup
db.pragma('journal_mode = WAL');      // concurrent reads during write
db.pragma('synchronous = NORMAL');    // safe + fast (WAL makes full sync unnecessary)
db.pragma('foreign_keys = ON');       // enforce referential integrity
db.pragma('cache_size = -32000');     // 32 MB page cache
db.pragma('temp_store = MEMORY');     // temp tables/indices in memory

// ── Schema ────────────────────────────────────────────────────────────────────

db.exec(`
  CREATE TABLE IF NOT EXISTS documents (
    id           TEXT    PRIMARY KEY,
    original_name TEXT   NOT NULL,
    file_path    TEXT    NOT NULL,
    text         TEXT    NOT NULL,
    created_at   INTEGER NOT NULL,
    updated_at   INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS tags (
    id           TEXT    PRIMARY KEY,
    document_id  TEXT    NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    label        TEXT    NOT NULL,
    color_key    INTEGER NOT NULL DEFAULT 0,
    created_at   INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS tag_relations (
    id           TEXT    PRIMARY KEY,
    document_id  TEXT    NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    source_id    TEXT    NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
    target_id    TEXT    NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
    label        TEXT    NOT NULL DEFAULT '',
    created_at   INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS annotations (
    id           TEXT    PRIMARY KEY,
    document_id  TEXT    NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    text         TEXT    NOT NULL,
    note         TEXT    NOT NULL DEFAULT '',
    start_offset INTEGER NOT NULL,
    end_offset   INTEGER NOT NULL,
    created_at   INTEGER NOT NULL,
    updated_at   INTEGER NOT NULL
  );

  -- Junction table: many annotations ↔ many tags
  CREATE TABLE IF NOT EXISTS annotation_tags (
    annotation_id TEXT NOT NULL REFERENCES annotations(id) ON DELETE CASCADE,
    tag_id        TEXT NOT NULL REFERENCES tags(id)        ON DELETE CASCADE,
    PRIMARY KEY (annotation_id, tag_id)
  );

  -- Indexes on all foreign-key columns used in WHERE / JOIN
  CREATE INDEX IF NOT EXISTS idx_tags_doc        ON tags(document_id);
  CREATE INDEX IF NOT EXISTS idx_relations_doc   ON tag_relations(document_id);
  CREATE INDEX IF NOT EXISTS idx_relations_src   ON tag_relations(source_id);
  CREATE INDEX IF NOT EXISTS idx_relations_tgt   ON tag_relations(target_id);
  CREATE INDEX IF NOT EXISTS idx_annotations_doc ON annotations(document_id);
  CREATE INDEX IF NOT EXISTS idx_anntags_ann     ON annotation_tags(annotation_id);
  CREATE INDEX IF NOT EXISTS idx_anntags_tag     ON annotation_tags(tag_id);

  -- Auto-bump documents.updated_at when any child record changes
  CREATE TRIGGER IF NOT EXISTS trig_tag_insert
    AFTER INSERT ON tags
    BEGIN UPDATE documents SET updated_at = (CAST(strftime('%s','now') AS INTEGER) * 1000)
          WHERE id = NEW.document_id; END;

  CREATE TRIGGER IF NOT EXISTS trig_relation_insert
    AFTER INSERT ON tag_relations
    BEGIN UPDATE documents SET updated_at = (CAST(strftime('%s','now') AS INTEGER) * 1000)
          WHERE id = NEW.document_id; END;

  CREATE TRIGGER IF NOT EXISTS trig_annotation_insert
    AFTER INSERT ON annotations
    BEGIN UPDATE documents SET updated_at = (CAST(strftime('%s','now') AS INTEGER) * 1000)
          WHERE id = NEW.document_id; END;

  CREATE TRIGGER IF NOT EXISTS trig_annotation_update
    AFTER UPDATE ON annotations
    BEGIN UPDATE documents SET updated_at = (CAST(strftime('%s','now') AS INTEGER) * 1000)
          WHERE id = NEW.document_id; END;
`);

// ── Prepared statements ───────────────────────────────────────────────────────
// Prepared once at module load; better-sqlite3 caches the compiled query plan.

const stmts = {
  // Documents
  insertDocument: db.prepare(
    `INSERT INTO documents (id, original_name, file_path, text, created_at, updated_at)
     VALUES (@id, @originalName, @filePath, @text, @createdAt, @updatedAt)`
  ),
  listDocuments: db.prepare(`
    SELECT d.id, d.original_name, d.created_at, d.updated_at,
           COUNT(DISTINCT t.id)  AS tag_count,
           COUNT(DISTINCT a.id)  AS annotation_count
    FROM   documents d
    LEFT JOIN tags        t ON t.document_id = d.id
    LEFT JOIN annotations a ON a.document_id = d.id
    GROUP BY d.id
    ORDER BY d.updated_at DESC
  `),
  getDocument: db.prepare(`SELECT * FROM documents WHERE id = ?`),
  deleteDocument: db.prepare(`DELETE FROM documents WHERE id = ?`),

  // Tags
  getTagsByDoc: db.prepare(
    `SELECT id, label, color_key FROM tags WHERE document_id = ? ORDER BY created_at`
  ),
  insertTag: db.prepare(
    `INSERT INTO tags (id, document_id, label, color_key, created_at)
     VALUES (@id, @documentId, @label, @colorKey, @createdAt)`
  ),
  updateTagLabel: db.prepare(`UPDATE tags SET label = ? WHERE id = ?`),
  deleteTag: db.prepare(`DELETE FROM tags WHERE id = ?`),
  getTagDocId: db.prepare(`SELECT document_id FROM tags WHERE id = ?`),

  // Tag relations
  getRelationsByDoc: db.prepare(
    `SELECT id, source_id, target_id, label FROM tag_relations WHERE document_id = ? ORDER BY created_at`
  ),
  insertRelation: db.prepare(
    `INSERT INTO tag_relations (id, document_id, source_id, target_id, label, created_at)
     VALUES (@id, @documentId, @sourceId, @targetId, @label, @createdAt)`
  ),
  updateRelationLabel: db.prepare(`UPDATE tag_relations SET label = ? WHERE id = ?`),
  deleteRelation: db.prepare(`DELETE FROM tag_relations WHERE id = ?`),
  getRelationDocId: db.prepare(`SELECT document_id FROM tag_relations WHERE id = ?`),
  checkDuplicateRelation: db.prepare(`
    SELECT id FROM tag_relations
    WHERE document_id = ? AND (
      (source_id = ? AND target_id = ?) OR
      (source_id = ? AND target_id = ?)
    ) LIMIT 1
  `),

  // Annotations
  getAnnotationsByDoc: db.prepare(`
    SELECT a.id, a.text, a.note, a.start_offset, a.end_offset, a.created_at,
           GROUP_CONCAT(at.tag_id) AS tag_ids
    FROM   annotations a
    LEFT JOIN annotation_tags at ON at.annotation_id = a.id
    WHERE  a.document_id = ?
    GROUP  BY a.id
    ORDER  BY a.created_at
  `),
  insertAnnotation: db.prepare(
    `INSERT INTO annotations (id, document_id, text, note, start_offset, end_offset, created_at, updated_at)
     VALUES (@id, @documentId, @text, @note, @startOffset, @endOffset, @createdAt, @updatedAt)`
  ),
  updateAnnotationNote: db.prepare(
    `UPDATE annotations SET note = ?, updated_at = (CAST(strftime('%s','now') AS INTEGER) * 1000) WHERE id = ?`
  ),
  deleteAnnotation: db.prepare(`DELETE FROM annotations WHERE id = ?`),
  getAnnotationDocId: db.prepare(`SELECT document_id FROM annotations WHERE id = ?`),

  // Annotation tags
  insertAnnotationTag: db.prepare(
    `INSERT OR IGNORE INTO annotation_tags (annotation_id, tag_id) VALUES (?, ?)`
  ),
  deleteAnnotationTag: db.prepare(
    `DELETE FROM annotation_tags WHERE annotation_id = ? AND tag_id = ?`
  ),
  setAnnotationTags: db.prepare(
    `DELETE FROM annotation_tags WHERE annotation_id = ?`
  ),
};

// ── Query helpers ─────────────────────────────────────────────────────────────
// Typed functions that map DB rows → API shapes.

export function listDocuments() {
  return (stmts.listDocuments.all() as any[]).map(row => ({
    id: row.id,
    originalName: row.original_name,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    tagCount: row.tag_count,
    annotationCount: row.annotation_count,
  }));
}

export function getDocumentFull(id: string) {
  const doc = stmts.getDocument.get(id) as any;
  if (!doc) return null;

  const tags = (stmts.getTagsByDoc.all(id) as any[]).map(row => ({
    id: row.id,
    label: row.label,
    colorKey: row.color_key,
  }));

  const tagRelations = (stmts.getRelationsByDoc.all(id) as any[]).map(row => ({
    id: row.id,
    sourceId: row.source_id,
    targetId: row.target_id,
    label: row.label,
  }));

  const annotations = (stmts.getAnnotationsByDoc.all(id) as any[]).map(row => ({
    id: row.id,
    text: row.text,
    note: row.note,
    startOffset: row.start_offset,
    endOffset: row.end_offset,
    createdAt: row.created_at,
    tagIds: row.tag_ids ? row.tag_ids.split(',') : [],
  }));

  return {
    id: doc.id,
    originalName: doc.original_name,
    filePath: doc.file_path,
    text: doc.text,
    createdAt: doc.created_at,
    updatedAt: doc.updated_at,
    tags,
    tagRelations,
    annotations,
  };
}

export function insertDocument(params: {
  id: string; originalName: string; filePath: string;
  text: string; createdAt: number; updatedAt: number;
}) {
  stmts.insertDocument.run(params);
}

export function deleteDocument(id: string) {
  stmts.deleteDocument.run(id);
}

export function insertTag(params: {
  id: string; documentId: string; label: string; colorKey: number; createdAt: number;
}) {
  stmts.insertTag.run(params);
  return { id: params.id, label: params.label, colorKey: params.colorKey };
}

export function updateTagLabel(id: string, label: string) {
  stmts.updateTagLabel.run(label, id);
}

export function deleteTag(id: string) {
  stmts.deleteTag.run(id);
}

export function getTagDocId(id: string): string | null {
  const row = stmts.getTagDocId.get(id) as any;
  return row?.document_id ?? null;
}

export function insertRelation(params: {
  id: string; documentId: string; sourceId: string;
  targetId: string; label: string; createdAt: number;
}) {
  const dup = stmts.checkDuplicateRelation.get(
    params.documentId,
    params.sourceId, params.targetId,
    params.targetId, params.sourceId,
  ) as any;
  if (dup) return null;
  stmts.insertRelation.run(params);
  return {
    id: params.id,
    sourceId: params.sourceId,
    targetId: params.targetId,
    label: params.label,
  };
}

export function updateRelationLabel(id: string, label: string) {
  stmts.updateRelationLabel.run(label, id);
}

export function deleteRelation(id: string) {
  stmts.deleteRelation.run(id);
}

export function getRelationDocId(id: string): string | null {
  const row = stmts.getRelationDocId.get(id) as any;
  return row?.document_id ?? null;
}

export function insertAnnotation(params: {
  id: string; documentId: string; text: string; note: string;
  startOffset: number; endOffset: number; createdAt: number; updatedAt: number;
}, tagIds: string[]) {
  // Wrap insert + junction rows in a transaction for atomicity
  const tx = db.transaction(() => {
    stmts.insertAnnotation.run(params);
    for (const tagId of tagIds) {
      stmts.insertAnnotationTag.run(params.id, tagId);
    }
  });
  tx();
  return {
    id: params.id,
    text: params.text,
    note: params.note,
    startOffset: params.startOffset,
    endOffset: params.endOffset,
    createdAt: params.createdAt,
    tagIds,
  };
}

export function updateAnnotationNote(id: string, note: string) {
  stmts.updateAnnotationNote.run(note, id);
}

export function updateAnnotationTags(annotationId: string, tagIds: string[]) {
  const tx = db.transaction(() => {
    stmts.setAnnotationTags.run(annotationId);
    for (const tagId of tagIds) {
      stmts.insertAnnotationTag.run(annotationId, tagId);
    }
  });
  tx();
}

export function toggleAnnotationTag(annotationId: string, tagId: string) {
  const existing = db.prepare(
    `SELECT 1 FROM annotation_tags WHERE annotation_id = ? AND tag_id = ?`
  ).get(annotationId, tagId);
  if (existing) {
    stmts.deleteAnnotationTag.run(annotationId, tagId);
    return false;
  } else {
    stmts.insertAnnotationTag.run(annotationId, tagId);
    return true;
  }
}

export function deleteAnnotation(id: string) {
  stmts.deleteAnnotation.run(id);
}

export function getAnnotationDocId(id: string): string | null {
  const row = stmts.getAnnotationDocId.get(id) as any;
  return row?.document_id ?? null;
}
