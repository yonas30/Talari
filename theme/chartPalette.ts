// Categorical palette for charts and category dots (defined now, used from Phase 3/4). Seven distinct colours, none of
// them red or green (those mean expense and income elsewhere in the app). Every category gets one colour from its id, so
// it looks the same on every screen and every launch.
export const CHART_PALETTE = [
  '#F47C20', // orange
  '#4D7FBF', // blue
  '#3FB5C9', // cyan
  '#8B93A3', // grey
  '#D4A72C', // gold
  '#8E6BBF', // violet
  '#B08968', // tan
] as const;

// FNV-1a: tiny, stable across platforms, no dependency. (Not cryptographic - it only has to spread ids evenly.)
function hashId(id: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < id.length; i += 1) {
    hash ^= id.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

export function categoryColor(categoryId: string): string {
  return CHART_PALETTE[hashId(categoryId) % CHART_PALETTE.length];
}
