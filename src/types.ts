export interface Tag {
  id: string;
  label: string;
  colorKey: number;
}

export interface TagRelation {
  id: string;
  sourceId: string;
  targetId: string;
  label: string;
}

export interface Annotation {
  id: string;
  text: string;
  note: string;
  startOffset: number;
  endOffset: number;
  createdAt: number;
  tagIds: string[];
}

export interface DocumentData {
  id: string;
  text: string;
  originalName: string;
}

export interface SelectionPayload {
  text: string;
  startOffset: number;
  endOffset: number;
  tagIds: string[];
  newTagLabel?: string;
}
