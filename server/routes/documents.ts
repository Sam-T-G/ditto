import { Router } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { nanoid } from 'nanoid';
import {
  UPLOADS_DIR,
  listDocuments,
  getDocumentFull,
  insertDocument,
  deleteDocument,
} from '../db.js';

const router = Router();

// Multer stores the file temporarily; we rename it to {id}.pdf ourselves
const upload = multer({
  dest: path.join(UPLOADS_DIR, 'tmp'),
  limits: { fileSize: 200 * 1024 * 1024 }, // 200 MB
  fileFilter: (_req, file, cb) => {
    cb(null, file.mimetype === 'application/pdf');
  },
});

// GET /api/documents — list all documents (no text content)
router.get('/documents', (_req, res) => {
  res.json(listDocuments());
});

// GET /api/documents/:id — full document with tags, relations, annotations
router.get('/documents/:id', (req, res) => {
  const doc = getDocumentFull(req.params.id);
  if (!doc) return res.status(404).json({ error: 'Document not found' });
  res.json(doc);
});

// POST /api/documents — upload PDF + extracted text
router.post('/documents', upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No PDF file provided' });

  const text = req.body.text;
  if (typeof text !== 'string' || !text.trim()) {
    fs.unlinkSync(req.file.path);
    return res.status(400).json({ error: 'Extracted text is required' });
  }

  const id = nanoid();
  const finalPath = path.join(UPLOADS_DIR, `${id}.pdf`);

  try {
    fs.renameSync(req.file.path, finalPath);
  } catch {
    // Cross-device rename fallback (tmp dir on different mount)
    fs.copyFileSync(req.file.path, finalPath);
    fs.unlinkSync(req.file.path);
  }

  const now = Date.now();
  insertDocument({
    id,
    originalName: req.file.originalname,
    filePath: finalPath,
    text,
    createdAt: now,
    updatedAt: now,
  });

  res.status(201).json(getDocumentFull(id));
});

// DELETE /api/documents/:id
router.delete('/documents/:id', (req, res) => {
  const doc = getDocumentFull(req.params.id);
  if (!doc) return res.status(404).json({ error: 'Document not found' });

  // Delete the stored PDF file
  try { fs.unlinkSync(doc.filePath); } catch { /* already gone */ }

  deleteDocument(req.params.id);
  res.status(204).send();
});

export default router;
