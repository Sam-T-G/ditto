import { Router } from 'express';
import { nanoid } from 'nanoid';
import {
  insertAnnotation,
  updateAnnotationNote,
  updateAnnotationTags,
  toggleAnnotationTag,
  deleteAnnotation,
  getAnnotationDocId,
} from '../db.js';

const router = Router();

// POST /api/documents/:docId/annotations
router.post('/documents/:docId/annotations', (req, res) => {
  const { text, note = '', startOffset, endOffset, tagIds = [] } = req.body;
  if (!text) return res.status(400).json({ error: 'text is required' });
  if (typeof startOffset !== 'number' || typeof endOffset !== 'number') {
    return res.status(400).json({ error: 'startOffset and endOffset are required numbers' });
  }

  const now = Date.now();
  const annotation = insertAnnotation(
    {
      id: nanoid(),
      documentId: req.params.docId,
      text,
      note,
      startOffset,
      endOffset,
      createdAt: now,
      updatedAt: now,
    },
    Array.isArray(tagIds) ? tagIds : [],
  );

  res.status(201).json(annotation);
});

// PATCH /api/annotations/:id — update note and/or tagIds
router.patch('/annotations/:id', (req, res) => {
  const docId = getAnnotationDocId(req.params.id);
  if (!docId) return res.status(404).json({ error: 'Annotation not found' });

  const { note, tagIds } = req.body;

  if (typeof note === 'string') {
    updateAnnotationNote(req.params.id, note);
  }

  if (Array.isArray(tagIds)) {
    updateAnnotationTags(req.params.id, tagIds);
  }

  res.status(204).send();
});

// PATCH /api/annotations/:id/toggle-tag — toggle a single tag on/off
router.patch('/annotations/:id/toggle-tag', (req, res) => {
  const docId = getAnnotationDocId(req.params.id);
  if (!docId) return res.status(404).json({ error: 'Annotation not found' });

  const { tagId } = req.body;
  if (!tagId) return res.status(400).json({ error: 'tagId is required' });

  const added = toggleAnnotationTag(req.params.id, tagId);
  res.json({ added });
});

// DELETE /api/annotations/:id
router.delete('/annotations/:id', (req, res) => {
  if (!getAnnotationDocId(req.params.id)) return res.status(404).json({ error: 'Annotation not found' });
  deleteAnnotation(req.params.id);
  res.status(204).send();
});

export default router;
