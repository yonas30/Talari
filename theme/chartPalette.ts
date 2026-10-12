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

// "Others" (the aggregate of small categories) is ALWAYS this neutral grey, so no real category may use it: category colours
// come from the palette without the grey.
export const OTHERS_COLOR = '#8B93A3';
export const CATEGORY_PALETTE = CHART_PALETTE.filter((hex) => hex !== OTHERS_COLOR);

export function categoryColor(categoryId: string): string {
  return CATEGORY_PALETTE[hashId(categoryId) % CATEGORY_PALETTE.length];
}

// ---- the Home donut --------------------------------------------------------------------------------------------------
// Light: the warm family - brand orange, two lighter oranges, a deep burnt orange, with navy and brand blue as the contrasting
// accents. (Dark keeps the multi-hue CATEGORY_PALETTE above.) The order is only the probing order below.
export const WARM_PALETTE = [
  '#F47C20', // brand orange
  '#17233C', // navy
  '#FFA85C', // light orange
  '#4D7FBF', // brand blue
  '#FFC48F', // lighter orange / peach
  '#C2410C', // deep burnt orange
] as const;

function channel(value: number): number {
  const c = value / 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

export function relativeLuminance(hex: string): number {
  const v = hex.replace('#', '');
  return 0.2126 * channel(parseInt(v.slice(0, 2), 16)) + 0.7152 * channel(parseInt(v.slice(2, 4), 16)) + 0.0722 * channel(parseInt(v.slice(4, 6), 16));
}

// Neighbouring slices must differ clearly in lightness, not just in hue.
export const MIN_NEIGHBOUR_LUMINANCE_GAP = 0.07;

/**
 * Colours for the visible category slices, in ring order (biggest first). Each category's id picks its PREFERRED colour from the
 * palette (the same id always prefers the same colour). Then, going round the ring: a colour already used by an earlier slice is
 * skipped, and so is one too close in lightness to the slice just before it (including the last slice next to the first), by
 * stepping to the next palette entry. So a category keeps its colour unless it collides with another visible category, in
 * which case the lower-ranked one moves on. "Others" is never in this list: it is always OTHERS_COLOR.
 */
export function assignSliceColors(categoryIds: string[], scheme: 'light' | 'dark'): string[] {
  const palette: readonly string[] = scheme === 'light' ? WARM_PALETTE : CATEGORY_PALETTE;
  const chosen: string[] = [];
  categoryIds.forEach((id, index) => {
    const start = hashId(id) % palette.length;
    const candidates = Array.from({ length: palette.length }, (_, step) => palette[(start + step) % palette.length]);
    const unused = candidates.filter((hex) => !chosen.includes(hex));
    const previous = index > 0 ? chosen[index - 1] : null;
    const first = index === 0 ? null : chosen[0];
    const clear = unused.filter(
      (hex) =>
        (previous === null || Math.abs(relativeLuminance(hex) - relativeLuminance(previous)) >= MIN_NEIGHBOUR_LUMINANCE_GAP) &&
        // the ring closes: with Others after the last category, only the first-vs-last neighbour matters when there is no Others
        (first === null || index < categoryIds.length - 1 || Math.abs(relativeLuminance(hex) - relativeLuminance(first)) >= MIN_NEIGHBOUR_LUMINANCE_GAP),
    );
    chosen.push((clear[0] ?? unused[0] ?? candidates[0]) as string);
  });
  return chosen;
}
