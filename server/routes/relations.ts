import { Router } from 'express';
import { nanoid } from 'nanoid';
import {
  insertRelation,
  updateRelationLabel,
  deleteRelation,
  getRelationDocId,
} from '../db.js';

const router = Router();

// POST /api/documents/:docId/relations
router.post('/documents/:docId/relations', (req, res) => {
  const { sourceId, targetId } = req.body;
  if (!sourceId || !targetId) {
    return res.status(400).json({ error: 'sourceId and targetId are required' });
  }
  if (sourceId === targetId) {
    return res.status(400).json({ error: 'Cannot relate a tag to itself' });
  }

  const relation = insertRelation({
    id: nanoid(),
    documentId: req.params.docId,
    sourceId,
    targetId,
    label: '',
    createdAt: Date.now(),
  });

  if (!relation) return res.status(409).json({ error: 'Relation already exists' });
  res.status(201).json(relation);
});

// PATCH /api/relations/:id
router.patch('/relations/:id', (req, res) => {
  const { label } = req.body;
  if (typeof label !== 'string') return res.status(400).json({ error: 'label must be a string' });
  if (!getRelationDocId(req.params.id)) return res.status(404).json({ error: 'Relation not found' });

  updateRelationLabel(req.params.id, label);
  res.status(204).send();
});

// DELETE /api/relations/:id
router.delete('/relations/:id', (req, res) => {
  if (!getRelationDocId(req.params.id)) return res.status(404).json({ error: 'Relation not found' });
  deleteRelation(req.params.id);
  res.status(204).send();
});

export default router;
