import express from 'express';
import cors from 'cors';
import path from 'path';
import { UPLOADS_DIR } from './db.js';
import documentRoutes from './routes/documents.js';
import tagRoutes from './routes/tags.js';
import relationRoutes from './routes/relations.js';
import annotationRoutes from './routes/annotations.js';

const app = express();
const PORT = process.env.SERVER_PORT ? parseInt(process.env.SERVER_PORT) : 3001;

// ── Middleware ─────────────────────────────────────────────────────────────────

// Allow Vite dev server (port 3000) to call this server
app.use(cors({ origin: 'http://localhost:3000', credentials: true }));

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: false }));

// Serve stored PDFs (future "view original" feature)
app.use('/uploads', express.static(UPLOADS_DIR));

// ── Routes ────────────────────────────────────────────────────────────────────

app.get('/api/health', (_req, res) => res.json({ ok: true }));

app.use('/api', documentRoutes);
app.use('/api', tagRoutes);
app.use('/api', relationRoutes);
app.use('/api', annotationRoutes);

// ── Production: serve Vite build ──────────────────────────────────────────────

if (process.env.NODE_ENV === 'production') {
  const distDir = path.resolve(process.cwd(), 'dist');
  app.use(express.static(distDir));
  app.get('*', (_req, res) => res.sendFile(path.join(distDir, 'index.html')));
}

// ── Error handler ─────────────────────────────────────────────────────────────

app.use((err: any, _req: any, res: any, _next: any) => {
  console.error('[server error]', err);
  res.status(err.status ?? 500).json({ error: err.message ?? 'Internal server error' });
});

app.listen(PORT, () => {
  console.log(`\n  ◆  Textura server  →  http://localhost:${PORT}`);
  console.log(`     Data directory  →  data/\n`);
});
