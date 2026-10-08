import { forwardRef } from 'react';
import { Text, TextProps } from 'react-native';

import { NUMBER_MAX_FONT_SCALE, resolveTextStyle, TextVariant } from '../theme/textStyle';
import { useThemeColors } from '../theme/ThemeProvider';

export interface AppTextProps extends TextProps {
  /** Optional named style: heading, title, body, caption or number. Without it only the font family changes. */
  variant?: TextVariant;
}

// The one Text component of the app. It is React Native's Text with Talari's fonts: the incoming style is flattened,
// `fontWeight` is turned into the matching per-weight family (Inter for body and numbers, Plus Jakarta Sans for headings)
// and removed, and the number variant gets tabular figures. Every other Text prop passes through untouched.
const AppText = forwardRef<Text, AppTextProps>(function AppText({ variant, style, maxFontSizeMultiplier, ...rest }, ref) {
  const colors = useThemeColors();
  return (
    <Text
      ref={ref}
      {...rest}
      maxFontSizeMultiplier={maxFontSizeMultiplier ?? (variant === 'number' ? NUMBER_MAX_FONT_SCALE : undefined)}
      style={resolveTextStyle(style, variant, colors)}
    />
  );
});

export default AppText;
