// Bottom tab bar sizing. react-navigation applies the bar's height as a fixed number, so a hard-coded value
// cannot grow with the system font size: with the label at 2x the icon + label no longer fit and spill
// into the bottom padding - which, on Android, is the 3-button navigation bar's space.
// Instead the height is derived from the font scale, with the label capped (TAB_LABEL_MAX_SCALE) so the bar
// doesn't balloon at accessibility sizes either. The label itself must use the same cap
// (maxFontSizeMultiplier) or the maths and the text disagree.

export const TAB_LABEL_MAX_SCALE = 1.3;
export const TAB_LABEL_FONT_SIZE = 11;

const ICON_BLOCK = 28; // icon (24) + its top margin (2) + gap to the label (2)
const PADDING_TOP = 6;
const PADDING_BOTTOM = 6;
const LINE_HEIGHT_FACTOR = 1.3; // generous: Android adds font padding on top of the nominal line height

export interface TabBarMetrics {
  height: number;
  paddingTop: number;
  paddingBottom: number;
}

export function getTabBarMetrics(fontScale: number, bottomInset: number): TabBarMetrics {
  const scale = Math.min(Math.max(fontScale, 1), TAB_LABEL_MAX_SCALE);
  const labelHeight = Math.ceil(TAB_LABEL_FONT_SIZE * scale * LINE_HEIGHT_FACTOR);
  const contentNeeded = ICON_BLOCK + labelHeight;

  return {
    height: PADDING_TOP + contentNeeded + PADDING_BOTTOM + bottomInset,
    paddingTop: PADDING_TOP,
    // The system navigation inset always stays clear below the content.
    paddingBottom: bottomInset + PADDING_BOTTOM,
  };
}

// Small text controls (links, pills, labels packed beside an icon or another control) are laid out in boxes
// sized for the normal font. Their text may grow with the system font up to this multiple and no further, and
// their containers must also be able to flex or wrap - the cap alone only limits how bad it gets.
export const CONTROL_LABEL_MAX_SCALE = 1.3;
