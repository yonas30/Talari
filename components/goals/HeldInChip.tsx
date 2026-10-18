import { StyleSheet, View } from 'react-native';

import { useTheme } from '../../theme/ThemeProvider';
import { accountColors } from '../../theme/tokens';
import { MoneyAccount } from '../../types/accounts';
import AppText from '../AppText';

// "Held in [• CBE]" on a goal: the account that holds the goal's reserved money, as a pill in that account type's colours (the same tokens
// as everywhere else accounts are drawn). A deleted account reads "Deleted account".
export default function HeldInChip({ account }: { account: MoneyAccount | undefined }) {
  const { colors } = useTheme();
  const tokens = accountColors(colors, account?.type ?? 'bank');

  return (
    <View style={styles.row} accessible accessibilityLabel={`Held in ${account?.name ?? 'a deleted account'}`}>
      <AppText style={[styles.label, { color: colors.textMuted }]}>Held in</AppText>
      <View style={[styles.pill, { backgroundColor: tokens.disc, borderColor: tokens.glyph }]}>
        <View style={[styles.dot, { backgroundColor: tokens.dot }]} />
        <AppText style={[styles.name, { color: colors.text }]} numberOfLines={1} maxFontSizeMultiplier={1.3}>
          {account?.name ?? 'Deleted account'}
        </AppText>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  label: {
    fontSize: 13,
  },
  pill: {
    flexShrink: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    minHeight: 30,
    paddingHorizontal: 10,
    borderRadius: 999,
    borderWidth: 1,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  name: {
    flexShrink: 1,
    fontSize: 13,
    fontWeight: '700',
  },
});
