export interface TagColor {
  bg: string;
  border: string;
  dot: string;
  text: string;
  highlight: string; // lighter, for text selection background
}

export const TAG_PALETTE: TagColor[] = [
  { bg: '#FEF3C7', border: '#D97706', dot: '#D97706', text: '#92400E', highlight: '#FDE68A' },
  { bg: '#DBEAFE', border: '#2563EB', dot: '#2563EB', text: '#1E40AF', highlight: '#BFDBFE' },
  { bg: '#D1FAE5', border: '#059669', dot: '#059669', text: '#065F46', highlight: '#A7F3D0' },
  { bg: '#EDE9FE', border: '#7C3AED', dot: '#7C3AED', text: '#4C1D95', highlight: '#DDD6FE' },
  { bg: '#FCE7F3', border: '#DB2777', dot: '#DB2777', text: '#831843', highlight: '#FBCFE8' },
  { bg: '#FFEDD5', border: '#EA580C', dot: '#EA580C', text: '#7C2D12', highlight: '#FED7AA' },
  { bg: '#CFFAFE', border: '#0891B2', dot: '#0891B2', text: '#164E63', highlight: '#A5F3FC' },
  { bg: '#ECFCCB', border: '#65A30D', dot: '#65A30D', text: '#3F6212', highlight: '#D9F99D' },
];

export function getTagColor(colorKey: number): TagColor {
  return TAG_PALETTE[colorKey % TAG_PALETTE.length];
}

export function nextColorKey(existingKeys: number[]): number {
  for (let i = 0; i < TAG_PALETTE.length; i++) {
    if (!existingKeys.includes(i)) return i;
  }
  return existingKeys.length % TAG_PALETTE.length;
}
