import { Pressable, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { useTheme } from '../../theme/ThemeProvider';
import { accountHeroDots } from '../../theme/tokens';
import { balanceToggleLabel } from '../../utils/balanceVisibility';
import { AccountType } from '../../types/accounts';
import { AccountGroup, tileAccessibilityLabel } from '../../utils/accounts/groups';
import { formatETB, formatNumber, maskAmount } from '../../utils/format';
import { goalsLineText, shouldShowGoalsLine } from '../../utils/homeModel';
import AppText from '../AppText';
import Card from '../Card';

interface HeroCardProps {
  total: number;
  // Cash / Wallet / Bank, only the types that have accounts, each with its ETB subtotal.
  groups: Pick<AccountGroup, 'type' | 'label' | 'subtotalETB'>[];
  /** Money reserved for goals (already part of the total). */
  reservedAmount: number;
  /** "Rate last updated X days ago": shown when a foreign rate is more than 7 days old. */
  rateNote: string | null;
  /** Accounts left out of the total because they have no exchange rate. */
  unvaluedNote: string | null;
  hidden: boolean;
  onToggleHidden: () => void;
  /** A tap on a tile opens the Accounts screen on that type. */
  onOpenType: (type: AccountType) => void;
}

// The navy Total Balance card: the total, then a tile per account type (Cash / Wallet / Bank) with its subtotal; tapping a tile opens the
// Accounts screen on that type, so this card is also the way into the accounts. Goals are not a tile; when
// money is reserved for them a small line says how much of the total that is. Hidden balances mask every amount, that line included.
// The two notes (an old exchange rate, an account that cannot be valued) are not amounts, so they stay visible.
export default function HeroCard({ total, groups, reservedAmount, rateNote, unvaluedNote, hidden, onToggleHidden, onOpenType }: HeroCardProps) {
  const { colors } = useTheme();
  const mask = (value: number) => maskAmount(formatETB(value), hidden);

  return (
    <Card variant="hero" style={styles.card}>
      <View style={styles.header}>
        <AppText style={[styles.label, { color: colors.heroTextMuted }]}>Total balance</AppText>
        <Pressable
          onPress={onToggleHidden}
          hitSlop={10}
          accessibilityRole="button"
          accessibilityLabel={balanceToggleLabel(hidden)}
          style={({ pressed }) => (pressed ? { opacity: 0.6 } : null)}
        >
          <Ionicons name={hidden ? 'eye-off-outline' : 'eye-outline'} size={20} color={colors.heroText} />
        </Pressable>
      </View>

      <AppText
        variant="number"
        style={[styles.total, { color: colors.heroText }]}
        numberOfLines={1}
        adjustsFontSizeToFit
        // 0.5, not 0.7: a seven-figure total needs about 0.65 of its size in a narrow card, and at the 1.3x font cap a 0.7 floor would clip it.
        minimumFontScale={0.5}
      >
        {mask(total)}
      </AppText>

      {rateNote ? (
        <AppText style={[styles.note, { color: colors.heroTextMuted }]} numberOfLines={2}>
          {rateNote}
        </AppText>
      ) : null}

      {groups.length > 0 ? (
        <>
          <View style={[styles.divider, { backgroundColor: colors.heroDivider }]} />
          <View style={styles.tiles}>
            {groups.map((group) => (
              <Pressable
                key={group.type}
                onPress={() => onOpenType(group.type)}
                accessibilityRole="button"
                accessibilityLabel={tileAccessibilityLabel(group, hidden, formatETB)}
                style={({ pressed }) => [styles.tile, { backgroundColor: colors.heroDivider }, pressed && styles.tilePressed]}
              >
                <View style={styles.tileLabelRow}>
                  <View style={[styles.dot, { backgroundColor: accountHeroDots[group.type] }]} />
                  <AppText style={[styles.tileLabel, { color: colors.heroTextMuted }]} numberOfLines={1}>
                    {group.label}
                  </AppText>
                </View>
                <AppText
                  variant="number"
                  style={[styles.tileValue, { color: colors.heroText }]}
                  numberOfLines={1}
                  adjustsFontSizeToFit
                  minimumFontScale={0.5}
                >
                  {maskAmount(formatNumber(group.subtotalETB, 0), hidden)}
                </AppText>
              </Pressable>
            ))}
          </View>
        </>
      ) : null}

      {shouldShowGoalsLine(reservedAmount, hidden) ? (
        <AppText style={[styles.note, styles.centered, { color: colors.heroTextMuted }]} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.8}>
          {goalsLineText(reservedAmount)}
        </AppText>
      ) : null}

      {unvaluedNote ? (
        <AppText style={[styles.note, styles.centered, { color: colors.heroTextMuted }]} numberOfLines={2}>
          {unvaluedNote}
        </AppText>
      ) : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  card: {
    padding: 16,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  label: {
    fontSize: 14,
    fontWeight: '500',
    flexShrink: 1,
  },
  total: {
    fontSize: 30,
    lineHeight: 38,
    fontWeight: '700',
    marginTop: 2,
  },
  divider: {
    height: 1,
    marginTop: 10,
    marginBottom: 12,
  },
  tiles: {
    flexDirection: 'row',
    gap: 8,
  },
  tile: {
    flex: 1,
    minWidth: 0,
    borderRadius: 14,
    paddingHorizontal: 11,
    paddingVertical: 9,
  },
  tilePressed: {
    opacity: 0.7,
  },
  tileLabelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  dot: {
    width: 7,
    height: 7,
    borderRadius: 4,
  },
  tileLabel: {
    flexShrink: 1,
    fontSize: 12,
    fontWeight: '600',
  },
  tileValue: {
    fontSize: 15,
    lineHeight: 21,
    fontWeight: '700',
    marginTop: 3,
  },
  note: {
    fontSize: 12,
    marginTop: 10,
  },
  centered: {
    textAlign: 'center',
  },
});
