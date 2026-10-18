import { useCallback, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';

import AccountRow from '../components/accounts/AccountRow';
import NewAccountSheet from '../components/accounts/NewAccountSheet';
import AppHeader from '../components/AppHeader';
import AppText from '../components/AppText';
import Button from '../components/Button';
import Card from '../components/Card';
import { useAccountDraft } from '../store/accountDraft';
import { useAccountsState, useFinanceStore, useTotals } from '../store/finance';
import { useUiStore } from '../store/ui';
import { useTheme } from '../theme/ThemeProvider';
import { groupAccounts, parseTypeFilter, reservedLabel, staleRateNote, TYPE_LABELS, unvaluedNote } from '../utils/accounts/groups';
import { getGoalAmounts } from '../utils/accounts/reserve';
import { formatETB, formatNumber, maskAmount } from '../utils/format';

// Accounts, grouped Cash / Wallet / Bank, each with its balance. Reached from "See all" on Home and from the side menu.
export default function AccountsScreen() {
  const { colors } = useTheme();
  const router = useRouter();
  const params = useLocalSearchParams<{ type?: string }>();
  // Opened from a Home tile: only that type is listed, with one tap back to everything. Anything else shows all accounts.
  const typeFilter = parseTypeFilter(params.type);
  const totals = useTotals();
  const state = useAccountsState();
  const accounts = useFinanceStore((store) => store.accounts);
  const isBalanceHidden = useUiStore((store) => store.isBalanceHidden);
  const { reopenSheet, setReopenSheet, resetDraft } = useAccountDraft();
  const [sheetOpen, setSheetOpen] = useState(false);
  const [showArchived, setShowArchived] = useState(false);

  // Back from the Exchange rates screen after choosing a foreign currency with no rate: the sheet reopens with the choices kept.
  useFocusEffect(
    useCallback(() => {
      if (reopenSheet) {
        setReopenSheet(false);
        setSheetOpen(true);
      }
    }, [reopenSheet, setReopenSheet]),
  );

  const allGroups = useMemo(() => groupAccounts(totals.accounts), [totals.accounts]);
  const groups = typeFilter ? allGroups.filter((group) => group.type === typeFilter) : allGroups;
  const goalAmounts = useMemo(() => getGoalAmounts(state.allocations), [state.allocations]);
  const archived = accounts.filter((account) => account.archived);
  const staleNote = staleRateNote(totals);
  const missingRateNote = unvaluedNote(totals);
  const mask = (text: string) => maskAmount(text, isBalanceHidden);

  const closeSheet = () => {
    resetDraft();
    setSheetOpen(false);
  };

  const openAccount = (id: string) => router.push(`/account/${id}`);

  return (
    <View style={[styles.screen, { backgroundColor: colors.bg }]}>
      {/* The eye here is the same switch as the one on Home: the hidden-balances flag is shared, so unhiding here unhides Home too. */}
      <AppHeader title="Accounts" showBalanceToggle />
      <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
        {totals.accounts.length > 0 ? (
          <View>
            <View style={styles.totalRow}>
              <AppText style={[styles.totalLabel, { color: colors.textMuted }]}>
                Total across {totals.accounts.length} {totals.accounts.length === 1 ? 'account' : 'accounts'}
              </AppText>
              <AppText variant="number" style={[styles.totalValue, { color: colors.text }]} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.6}>
                {mask(formatETB(totals.total))}
              </AppText>
            </View>
            {staleNote ? <AppText style={[styles.note, { color: colors.textMuted }]}>{staleNote}</AppText> : null}
            {missingRateNote ? <AppText style={[styles.note, { color: colors.expense }]}>{missingRateNote}</AppText> : null}
          </View>
        ) : null}

        {typeFilter ? (
          <View style={styles.filterRow}>
            <AppText style={[styles.filterText, { color: colors.textMuted }]}>Showing {TYPE_LABELS[typeFilter].toLowerCase()} accounts</AppText>
            <Pressable onPress={() => router.setParams({ type: '' })} hitSlop={10} accessibilityRole="button" accessibilityLabel="Show all accounts">
              <AppText style={[styles.filterLink, { color: colors.primaryText }]}>Show all</AppText>
            </Pressable>
          </View>
        ) : null}

        {groups.map((group) => (
          <Card key={group.type} style={styles.card}>
            <View style={styles.groupHeader}>
              <AppText style={[styles.groupTitle, { color: colors.textMuted }]} accessibilityRole="header">
                {group.label.toUpperCase()}
              </AppText>
              <AppText variant="number" style={[styles.groupTotal, { color: colors.textMuted }]}>
                {mask(formatNumber(group.subtotalETB))}
              </AppText>
            </View>
            {group.accounts.map((summary, index) => (
              <AccountRow
                key={summary.account.id}
                summary={summary}
                hidden={isBalanceHidden}
                isFirst={index === 0}
                reserved={reservedLabel(summary.account.id, summary.reserved, state.goals, goalAmounts, formatNumber)}
                onPress={() => openAccount(summary.account.id)}
              />
            ))}
          </Card>
        ))}

        {typeFilter && groups.length === 0 && totals.accounts.length > 0 ? (
          <AppText style={[styles.emptyText, { color: colors.textMuted }]}>You have no {TYPE_LABELS[typeFilter].toLowerCase()} accounts. Tap Add account to create one.</AppText>
        ) : null}

        {totals.accounts.length === 0 ? (
          <View style={styles.empty}>
            <Ionicons name="wallet-outline" size={28} color={colors.textMuted} />
            <AppText style={[styles.emptyTitle, { color: colors.text }]}>No accounts yet</AppText>
            <AppText style={[styles.emptyText, { color: colors.textMuted }]}>Add the places your money is: cash, a wallet like Telebirr, or a bank.</AppText>
          </View>
        ) : null}

        <Button title="Add account" icon="add" onPress={() => setSheetOpen(true)} accessibilityLabel="Add an account" />

        {archived.length > 0 ? (
          <Card style={styles.card}>
            <Pressable
              onPress={() => setShowArchived((value) => !value)}
              accessibilityRole="button"
              accessibilityState={{ expanded: showArchived }}
              style={styles.groupHeader}
            >
              <AppText style={[styles.groupTitle, { color: colors.textMuted }]}>ARCHIVED ({archived.length})</AppText>
              <Ionicons name={showArchived ? 'chevron-up' : 'chevron-down'} size={18} color={colors.textMuted} />
            </Pressable>
            {showArchived
              ? archived.map((account) => (
                  <Pressable
                    key={account.id}
                    onPress={() => openAccount(account.id)}
                    accessibilityRole="button"
                    accessibilityLabel={`${account.name}, archived`}
                    style={({ pressed }) => [styles.archivedRow, { borderTopColor: colors.border }, pressed && { backgroundColor: colors.surfaceMuted }]}
                  >
                    <AppText style={[styles.archivedName, { color: colors.text }]} numberOfLines={1}>
                      {account.name}
                    </AppText>
                    <Ionicons name="chevron-forward" size={16} color={colors.textMuted} />
                  </Pressable>
                ))
              : null}
          </Card>
        ) : null}
      </ScrollView>

      <NewAccountSheet
        visible={sheetOpen}
        onClose={closeSheet}
        onCreated={() => setSheetOpen(false)}
        onSetRate={() => {
          // The choices stay in the draft store; the sheet reopens when this screen is shown again.
          setReopenSheet(true);
          setSheetOpen(false);
          router.push('/exchange-rates');
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
  },
  container: {
    flexGrow: 1,
    paddingHorizontal: 20,
    paddingBottom: 28,
    gap: 14,
  },
  totalRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    gap: 12,
    paddingHorizontal: 2,
  },
  totalLabel: {
    flexShrink: 1,
    fontSize: 13,
    fontWeight: '500',
  },
  totalValue: {
    flexShrink: 1,
    fontSize: 18,
    fontWeight: '700',
  },
  filterRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    paddingHorizontal: 2,
  },
  filterText: {
    flexShrink: 1,
    fontSize: 13,
  },
  filterLink: {
    fontSize: 14,
    fontWeight: '600',
  },
  note: {
    fontSize: 12,
    lineHeight: 17,
    marginTop: 4,
    paddingHorizontal: 2,
  },
  card: {
    paddingVertical: 10,
    paddingHorizontal: 16,
  },
  groupHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingBottom: 6,
  },
  groupTitle: {
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.7,
  },
  groupTotal: {
    fontSize: 13,
    fontWeight: '600',
  },
  empty: {
    alignItems: 'center',
    gap: 6,
    paddingVertical: 28,
  },
  emptyTitle: {
    fontSize: 16,
    fontWeight: '700',
  },
  emptyText: {
    fontSize: 14,
    textAlign: 'center',
  },
  archivedRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  archivedName: {
    flex: 1,
    fontSize: 15,
    fontWeight: '600',
  },
});
