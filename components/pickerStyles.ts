import { useMemo } from 'react';
import { StyleSheet } from 'react-native';

import { radius, spacing } from '../constants/theme';
import { useThemeColors } from '../theme/ThemeProvider';

// The three pickers (category, currency, generic option) share one look: a field-style trigger and a bottom list. Colours come from
// the theme tokens; the trigger uses the input border so its edge is visible in both themes.
export function usePickerStyles() {
  const colors = useThemeColors();
  return useMemo(
    () =>
      StyleSheet.create({
        trigger: {
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: spacing.sm,
          backgroundColor: colors.bg,
          borderColor: colors.inputBorder,
          borderWidth: 1,
          borderRadius: radius.button,
          paddingHorizontal: spacing.md,
          paddingVertical: spacing.md,
        },
        triggerBody: {
          flex: 1,
        },
        triggerText: {
          flex: 1,
          color: colors.text,
          fontSize: 15,
          fontWeight: '600',
        },
        hint: {
          color: colors.textMuted,
          fontSize: 12,
          marginTop: 2,
        },
        backdrop: {
          flex: 1,
          justifyContent: 'flex-end',
          backgroundColor: colors.scrim,
        },
        sheet: {
          maxHeight: '70%',
          backgroundColor: colors.surface,
          borderColor: colors.border,
          borderTopWidth: 1,
          borderLeftWidth: 1,
          borderRightWidth: 1,
          borderTopLeftRadius: 20,
          borderTopRightRadius: 20,
          paddingHorizontal: spacing.xl,
          paddingVertical: spacing.md,
        },
        option: {
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          paddingVertical: spacing.md,
          borderBottomWidth: StyleSheet.hairlineWidth,
          borderBottomColor: colors.border,
        },
        optionBody: {
          flex: 1,
        },
        optionText: {
          color: colors.text,
          fontSize: 16,
          fontWeight: '600',
        },
        optionTextSelected: {
          color: colors.primaryText,
        },
        empty: {
          color: colors.textMuted,
          fontSize: 14,
          paddingVertical: spacing.md,
        },
        addText: {
          color: colors.primaryText,
          fontSize: 16,
          fontWeight: '700',
        },
      }),
    [colors],
  );
}
