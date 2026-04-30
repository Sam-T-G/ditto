import type { Tag, TagRelation, Annotation } from '../types';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface DocumentSummary {
  id: string;
  originalName: string;
  createdAt: number;
  updatedAt: number;
  tagCount: number;
  annotationCount: number;
}

export interface DocumentFull {
  id: string;
  originalName: string;
  text: string;
  createdAt: number;
  updatedAt: number;
  tags: Tag[];
  tagRelations: TagRelation[];
  annotations: Annotation[];
}

// ── Core fetch wrapper ────────────────────────────────────────────────────────

async function request<T>(method: string, path: string, body?: unknown | FormData): Promise<T> {
  const isForm = body instanceof FormData;
  const res = await fetch(`/api${path}`, {
    method,
    headers: isForm || body === undefined
      ? undefined
      : { 'Content-Type': 'application/json' },
    body: isForm ? body : body !== undefined ? JSON.stringify(body) : undefined,
  });

  if (res.status === 204) return undefined as T;

  const data = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
  if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
  return data as T;
}

const get  = <T>(path: string)                    => request<T>('GET',    path);
const post = <T>(path: string, body: unknown)     => request<T>('POST',   path, body);
const patch = <T>(path: string, body: unknown)    => request<T>('PATCH',  path, body);
const del  = <T>(path: string)                    => request<T>('DELETE', path);

// ── API surface ───────────────────────────────────────────────────────────────

export const api = {
  health: () => get<{ ok: boolean }>('/health'),

  documents: {
    list:   ()                       => get<DocumentSummary[]>('/documents'),
    get:    (id: string)             => get<DocumentFull>(`/documents/${id}`),
    create: (form: FormData)         => post<DocumentFull>('/documents', form),
    delete: (id: string)             => del<void>(`/documents/${id}`),
  },

  tags: {
    create: (docId: string, label: string, colorKey: number) =>
      post<Tag>(`/documents/${docId}/tags`, { label, colorKey }),
    rename: (id: string, label: string) =>
      patch<void>(`/tags/${id}`, { label }),
    delete: (id: string) =>
      del<void>(`/tags/${id}`),
  },

  relations: {
    create: (docId: string, sourceId: string, targetId: string) =>
      post<TagRelation>(`/documents/${docId}/relations`, { sourceId, targetId }),
    updateLabel: (id: string, label: string) =>
      patch<void>(`/relations/${id}`, { label }),
    delete: (id: string) =>
      del<void>(`/relations/${id}`),
  },

  annotations: {
    create: (
      docId: string,
      payload: { text: string; note: string; startOffset: number; endOffset: number; tagIds: string[] },
    ) => post<Annotation>(`/documents/${docId}/annotations`, payload),
    updateNote: (id: string, note: string) =>
      patch<void>(`/annotations/${id}`, { note }),
    updateTags: (id: string, tagIds: string[]) =>
      patch<void>(`/annotations/${id}`, { tagIds }),
    toggleTag: (id: string, tagId: string) =>
      patch<{ added: boolean }>(`/annotations/${id}/toggle-tag`, { tagId }),
    delete: (id: string) =>
      del<void>(`/annotations/${id}`),
  },
};
