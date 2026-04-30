import { Router } from 'express';
import { nanoid } from 'nanoid';
import {
  insertTag,
  updateTagLabel,
  deleteTag,
  getTagDocId,
} from '../db.js';

const router = Router();

// POST /api/documents/:docId/tags
router.post('/documents/:docId/tags', (req, res) => {
  const { label, colorKey } = req.body;
  if (!label?.trim()) return res.status(400).json({ error: 'label is required' });

  const tag = insertTag({
    id: nanoid(),
    documentId: req.params.docId,
    label: label.trim(),
    colorKey: typeof colorKey === 'number' ? colorKey : 0,
    createdAt: Date.now(),
  });
  res.status(201).json(tag);
});

// PATCH /api/tags/:id
router.patch('/tags/:id', (req, res) => {
  const { label } = req.body;
  if (!label?.trim()) return res.status(400).json({ error: 'label is required' });
  if (!getTagDocId(req.params.id)) return res.status(404).json({ error: 'Tag not found' });

  updateTagLabel(req.params.id, label.trim());
  res.status(204).send();
});

// DELETE /api/tags/:id
router.delete('/tags/:id', (req, res) => {
  if (!getTagDocId(req.params.id)) return res.status(404).json({ error: 'Tag not found' });
  deleteTag(req.params.id);
  res.status(204).send();
});

export default router;
