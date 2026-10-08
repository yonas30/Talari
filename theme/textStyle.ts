import { StyleProp, StyleSheet, TextStyle } from 'react-native';

import { FontFamilyKind, fontFamilyFor } from './fontFamilies';
import { ThemeColors } from './tokens';

export type TextVariant = 'heading' | 'title' | 'body' | 'caption' | 'number';

interface VariantSpec {
  kind: FontFamilyKind;
  style: TextStyle;
  color?: keyof ThemeColors;
}

// Variants only supply DEFAULTS; anything in the caller's own style wins. With no variant at all the helper changes
// nothing but the font family, so existing screens keep their exact sizes and spacing.
const VARIANTS: Record<TextVariant, VariantSpec> = {
  heading: { kind: 'heading', style: { fontSize: 28, fontWeight: '800' }, color: 'text' },
  title: { kind: 'heading', style: { fontSize: 20, fontWeight: '700' }, color: 'text' },
  body: { kind: 'body', style: { fontSize: 15, fontWeight: '400' }, color: 'text' },
  caption: { kind: 'body', style: { fontSize: 13, fontWeight: '400' }, color: 'textMuted' },
  // Money and counts: tabular figures so digits line up and a changing value does not make the layout jitter.
  number: { kind: 'body', style: { fontWeight: '600', fontVariant: ['tabular-nums'] } },
};

/** Font scale cap for the number variant, so a big balance cannot outgrow its card at extreme accessibility sizes. */
export const NUMBER_MAX_FONT_SCALE = 1.3;

export function resolveTextStyle(
  style: StyleProp<TextStyle>,
  variant: TextVariant | undefined,
  colors: ThemeColors,
): TextStyle {
  const spec = variant ? VARIANTS[variant] : undefined;
  const flat = StyleSheet.flatten([
    spec ? { ...spec.style, ...(spec.color ? { color: colors[spec.color] } : null) } : null,
    style,
  ]) as TextStyle;

  const { fontWeight, fontFamily, ...rest } = flat;
  // fontWeight is always dropped: a custom family combined with fontWeight misbehaves on Android. A family the caller set
  // explicitly (the splash tagline's Inter_600SemiBold) is kept; otherwise the per-weight family is picked from it.
  const family = fontFamily && fontFamily !== 'System' ? fontFamily : fontFamilyFor(spec?.kind ?? 'body', fontWeight);
  return { ...rest, fontFamily: family };
}
