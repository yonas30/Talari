import { useMemo, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import AccountIcon from '../../components/accounts/AccountIcon';
import FeeRepairCard from '../../components/accounts/FeeRepairCard';
import OpeningCard from '../../components/accounts/OpeningCard';
import OpeningSection from '../../components/accounts/OpeningSection';
import ReconcileBanner from '../../components/accounts/ReconcileBanner';
import AppHeader from '../../components/AppHeader';
import AppText from '../../components/AppText';
import Button from '../../components/Button';
import Card from '../../components/Card';
import FormInput from '../../components/FormInput';
import InlineError from '../../components/InlineError';
import OverlayModal from '../../components/OverlayModal';
import SegmentedControl, { SegmentOption } from '../../components/SegmentedControl';
import SheetModal from '../../components/SheetModal';
import { useAccountsState, useFinanceStore } from '../../store/finance';
import { useSmsStore } from '../../store/sms';
import { useUiStore } from '../../store/ui';
import { useTheme } from '../../theme/ThemeProvider';
import { AccountEntry } from '../../types/accounts';
import { alertLedgerError } from '../../utils/alerts';
import { getAccountBalances } from '../../utils/accounts/balances';
import { AccountsError } from '../../utils/accounts/errors';
import { accountNameProblem, cleanAccountName } from '../../utils/accounts/manage';
import { TYPE_LABELS, signedAmountFor, touchesAccount } from '../../utils/accounts/groups';
import { getGoalAmounts, getReserve } from '../../utils/accounts/reserve';
import { getRateToETB } from '../../utils/currency';
import { openingCards, reconcileSuppressed } from '../../utils/sms/opening';
import { reconcileStatus } from '../../utils/sms/reconcile';
import { defaultCtx } from '../../utils/accounts/context';
import { todayKey } from '../../utils/dates';
import { formatDateKey, formatMoney, formatNumber, maskAmount, transactionTitle } from '../../utils/format';

type AdjustDirection = 'increase' | 'decrease';
const DIRECTION_OPTIONS: SegmentOption<AdjustDirection>[] = [
  { key: 'increase', label: 'Increase' },
  { key: 'decrease', label: 'Decrease' },
];

const TYPE_NAMES: Record<AccountEntry['type'], string> = {
  income: 'Income',
  expense: 'Expense',
  transfer: 'Transfer',
  opening: 'Opening balance',
  adjustment: 'Adjustment',
};

// One account: its balance, what is reserved for goals and what is free to spend, and its recent entries. When imported messages show a
// balance that differs from Talari's, the orange "balance doesn't match your bank" banner (Phase 6C-2) offers an adjustment.
export default function AccountDetailScreen() {
  const { colors } = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { id } = useLocalSearchParams<{ id: string }>();
  const state = useAccountsState();
  const isBalanceHidden = useUiStore((store) => store.isBalanceHidden);
  const archiveAccount = useFinanceStore((store) => store.archiveAccount);
  const deleteAccount = useFinanceStore((store) => store.deleteAccount);
  const addTransaction = useFinanceStore((store) => store.addTransaction);
  const renameAccount = useFinanceStore((store) => store.renameAccount);
  const updateAccountSms = useFinanceStore((store) => store.updateAccountSms);
  const addReconcileAdjustment = useFinanceStore((store) => store.addReconcileAdjustment);
  const suggestions = useSmsStore((store) => store.suggestions);
  const reconcileDismissals = useSmsStore((store) => store.reconcileDismissals);
  const dismissReconcile = useSmsStore((store) => store.dismissReconcile);
  const openingOptions = useSmsStore((store) => store.openingOptions);
  const [typeOpen, setTypeOpen] = useState(false);

  const [menuOpen, setMenuOpen] = useState(false);
  const [adjustOpen, setAdjustOpen] = useState(false);
  const [direction, setDirection] = useState<AdjustDirection>('increase');
  const [adjustAmount, setAdjustAmount] = useState('');
  const [adjustNote, setAdjustNote] = useState('');
  const [adjustError, setAdjustError] = useState<string | null>(null);
  const [smsOpen, setSmsOpen] = useState(false);
  const [smsSender, setSmsSender] = useState('');
  const [smsDigits, setSmsDigits] = useState('');
  const [renameOpen, setRenameOpen] = useState(false);
  const [renameValue, setRenameValue] = useState('');
  const [renameError, setRenameError] = useState<string | null>(null);

  const account = state.accounts.find((item) => item.id === id);
  const goalAmounts = useMemo(() => getGoalAmounts(state.allocations), [state.allocations]);

  if (!account) {
    return (
      <View style={[styles.screen, { backgroundColor: colors.bg }]}>
        <AppHeader title="Account" />
        <AppText variant="title" style={styles.notFound}>
          Account not found
        </AppText>
      </View>
    );
  }

  const balance = getAccountBalances(state.entries, state.accounts)[account.id] ?? 0;
  const reserve = getReserve(state, account.id);
  const isEtb = account.currency === 'ETB';
  const rate = isEtb ? 1 : getRateToETB(account.currency, state.rates);
  const mask = (text: string) => maskAmount(text, isBalanceHidden);
  // Imported messages say what the bank has: if that differs from Talari's balance as of the newest message's day, offer an adjustment.
  // The quiet opening card (an account with no opening that has messages, or messages older than its opening). While it shows for an account with
  // no opening the banner steps aside: the opening is the explanation, and an adjustment must not stand in for it.
  const openingCard = isEtb ? (openingCards(state, suggestions, { ...openingOptions(mask), ctx: defaultCtx }).get(account.id) ?? null) : null;
  const reconcile =
    isEtb && !(openingCard !== null && reconcileSuppressed(state, account.id, new Map([[account.id, openingCard]])))
      ? reconcileStatus(state, suggestions, account.id, reconcileDismissals[account.id] ?? null)
      : null;
  const recent = state.entries.filter((entry) => touchesAccount(entry, account.id)).slice(0, 12);
  const heldGoals = state.goals.filter((goal) => goal.heldInAccountId === account.id && (goalAmounts[goal.id] ?? 0) > 0);

  // A name another account already has (archived ones included) is refused, live as the owner types, with a free one to try. Keeping the
  // account's own name, or only changing its case or spacing, is never a collision.
  const renameProblem = accountNameProblem(state.accounts, renameValue, account.id);
  const renameEmpty = cleanAccountName(renameValue) === '';

  const closeRename = () => {
    setRenameOpen(false);
    setRenameError(null);
  };

  const onSaveName = async () => {
    try {
      await renameAccount(account.id, renameValue);
      closeRename();
    } catch (error) {
      if (error instanceof AccountsError) {
        setRenameError(error.message);
      } else {
        throw error;
      }
    }
  };

  const closeAdjust = () => {
    setAdjustOpen(false);
    setAdjustAmount('');
    setAdjustNote('');
    setAdjustError(null);
  };

  const onSaveAdjustment = async () => {
    const value = Number(adjustAmount);
    if (!Number.isFinite(value) || value <= 0) {
      setAdjustError('Enter the difference as an amount greater than zero.');
      return;
    }
    try {
      await addTransaction({
        type: 'adjustment',
        accountId: account.id,
        amount: direction === 'increase' ? value : -value,
        date: todayKey(),
        note: adjustNote.trim() || null,
      });
      closeAdjust();
    } catch (error) {
      if (error instanceof AccountsError) {
        setAdjustError(error.message);
      } else {
        throw error;
      }
    }
  };

  const onArchive = () => {
    Alert.alert('Archive account', `Hide ${account.name}? Its history stays. An account can only be archived when it is empty.`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Archive',
        onPress: () => {
          archiveAccount(account.id)
            .then(() => router.back())
            .catch(alertLedgerError);
        },
      },
    ]);
  };

  const onDelete = () => {
    Alert.alert('Delete account', `Delete ${account.name}? This cannot be undone. An account with transactions cannot be deleted; archive it instead.`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () => {
          deleteAccount(account.id)
            .then(() => router.back())
            .catch(alertLedgerError);
        },
      },
    ]);
  };

  const openEntry = (entry: AccountEntry) => router.push(`/edit-transaction/${entry.linkedTransferId ?? entry.id}`);

  return (
    <View style={[styles.screen, { backgroundColor: colors.bg }]}>
      <AppHeader title={account.name} />
      <ScrollView contentContainerStyle={styles.container}>
        <FeeRepairCard accountId={account.id} />
        {openingCard !== null ? <OpeningCard proposal={openingCard} accountName={account.name} onType={() => setTypeOpen(true)} inset /> : null}
        {reconcile !== null ? (
          <ReconcileBanner status={reconcile} mask={mask} onAdjust={(options) => addReconcileAdjustment(reconcile, options)} onDismiss={() => dismissReconcile(account.id, reconcile.rawHash)} />
        ) : null}
        <Card style={styles.balanceCard}>
          <View style={styles.typeRow}>
            <AccountIcon type={account.type} size={32} />
            <AppText style={[styles.typeText, { color: colors.textMuted }]} numberOfLines={1}>
              {TYPE_LABELS[account.type]} · {account.currency}
              {account.archived ? ' · Archived' : ''}
            </AppText>
            <Pressable onPress={() => setMenuOpen(true)} hitSlop={10} accessibilityRole="button" accessibilityLabel={`${account.name} options`}>
              <Ionicons name="ellipsis-horizontal" size={22} color={colors.textMuted} />
            </Pressable>
          </View>
          <AppText variant="number" style={[styles.balance, { color: colors.text }]} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.5}>
            {mask(formatMoney(balance, account.currency))}
          </AppText>
          {!isEtb ? (
            <AppText style={[styles.helper, { color: colors.textMuted }]}>
              {rate === null ? 'No exchange rate set, so this is not in your total.' : mask(`About ETB ${formatNumber(balance * rate)} at today's rate`)}
            </AppText>
          ) : (
            <View style={styles.tiles}>
              <View style={[styles.tile, { backgroundColor: colors.surfaceMuted }]}>
                <AppText style={[styles.tileLabel, { color: colors.textMuted }]}>Reserved for goals</AppText>
                <AppText variant="number" style={[styles.tileValue, { color: colors.text }]} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.6}>
                  {mask(formatNumber(reserve.reserved))}
                </AppText>
              </View>
              <View style={[styles.tile, { backgroundColor: colors.surfaceMuted }]}>
                <AppText style={[styles.tileLabel, { color: colors.textMuted }]}>Free to spend</AppText>
                <AppText variant="number" style={[styles.tileValue, { color: colors.text }]} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.6}>
                  {mask(formatNumber(reserve.freeToSpend))}
                </AppText>
              </View>
            </View>
          )}
        </Card>

        {isEtb && !account.archived ? <OpeningSection accountId={account.id} typeOpen={typeOpen} onTypeOpenChange={setTypeOpen} /> : null}

        {heldGoals.length > 0 ? (
          <Card style={styles.card}>
            <AppText variant="title" style={styles.cardTitle} accessibilityRole="header">
              Goals held here
            </AppText>
            {heldGoals.map((goal) => (
              <View key={goal.id} style={styles.goalRow}>
                <Ionicons name="flag-outline" size={16} color={colors.goalsGlyph} />
                <AppText style={[styles.goalName, { color: colors.text }]} numberOfLines={1}>
                  {goal.name}
                </AppText>
                <AppText variant="number" style={[styles.goalAmount, { color: colors.textMuted }]}>
                  {mask(formatNumber(goalAmounts[goal.id] ?? 0))}
                </AppText>
              </View>
            ))}
            <AppText style={[styles.helper, { color: colors.textMuted }]}>
              This money is still in {account.name}; it is only set aside. Spending it shrinks the goals.
            </AppText>
          </Card>
        ) : null}

        <Card style={styles.card}>
          <AppText variant="title" style={styles.cardTitle} accessibilityRole="header">
            Recent in {account.name}
          </AppText>
          {recent.length === 0 ? (
            <AppText style={[styles.helper, { color: colors.textMuted }]}>Nothing recorded in this account yet.</AppText>
          ) : (
            recent.map((entry, index) => {
              const signed = signedAmountFor(entry, account) ?? 0;
              const amountColor = entry.type === 'income' ? colors.income : entry.type === 'expense' ? colors.expense : colors.text;
              return (
                <Pressable
                  key={entry.id}
                  onPress={() => openEntry(entry)}
                  accessibilityRole="button"
                  accessibilityLabel={`${transactionTitle(entry, state.accounts)}, ${formatDateKey(entry.date)}. Opens the transaction.`}
                  style={({ pressed }) => [
                    styles.entryRow,
                    index > 0 && { borderTopColor: colors.border, borderTopWidth: StyleSheet.hairlineWidth },
                    pressed && { backgroundColor: colors.surfaceMuted },
                  ]}
                >
                  <View style={styles.entryText}>
                    <AppText style={[styles.entryTitle, { color: colors.text }]} numberOfLines={1}>
                      {transactionTitle(entry, state.accounts)}
                    </AppText>
                    <AppText style={[styles.entryMeta, { color: colors.textMuted }]} numberOfLines={1}>
                      {formatDateKey(entry.date)} · {entry.linkedTransferId ? 'Transfer fee' : TYPE_NAMES[entry.type]}
                    </AppText>
                  </View>
                  <AppText variant="number" style={[styles.entryAmount, { color: amountColor }]} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.6}>
                    {mask(`${signed < 0 ? '−' : '+'}${formatMoney(Math.abs(signed), account.currency)}`)}
                  </AppText>
                </Pressable>
              );
            })
          )}
        </Card>
      </ScrollView>

      {/* Options */}
      <OverlayModal visible={menuOpen} animationType="fade" onRequestClose={() => setMenuOpen(false)}>
        <Pressable style={[styles.menuBackdrop, { backgroundColor: colors.scrim }]} onPress={() => setMenuOpen(false)}>
          <View style={[styles.menuSheet, { paddingBottom: 20 + insets.bottom, backgroundColor: colors.surface, borderColor: colors.border }]}>
            <MenuOption
              icon="text-outline"
              label="Rename account"
              onPress={() => {
                setMenuOpen(false);
                setRenameValue(account.name);
                setRenameError(null);
                setRenameOpen(true);
              }}
            />
            <MenuOption
              icon="chatbubble-ellipses-outline"
              label="SMS details"
              onPress={() => {
                setMenuOpen(false);
                setSmsSender(account.smsSender ?? '');
                setSmsDigits(account.lastDigits ?? '');
                setSmsOpen(true);
              }}
            />
            {!account.archived ? (
              <>
                <MenuOption
                  icon="create-outline"
                  label="Adjust balance"
                  onPress={() => {
                    setMenuOpen(false);
                    setAdjustOpen(true);
                  }}
                />
                <MenuOption
                  icon="archive-outline"
                  label="Archive account"
                  onPress={() => {
                    setMenuOpen(false);
                    onArchive();
                  }}
                />
              </>
            ) : null}
            <MenuOption
              icon="trash-outline"
              label="Delete account"
              danger
              onPress={() => {
                setMenuOpen(false);
                onDelete();
              }}
            />
          </View>
        </Pressable>
      </OverlayModal>

      {/* SMS details: only used to match pasted messages to this account. Empty clears them. */}
      <SheetModal visible={smsOpen} onClose={() => setSmsOpen(false)}>
        <AppText variant="title" style={styles.sheetTitle} accessibilityRole="header">
          SMS details
        </AppText>
        <AppText style={[styles.helper, { color: colors.textMuted }]}>
          Where this account&apos;s messages come from, and its last digits. Used only to match messages you paste. Nothing is read from your phone.
        </AppText>
        <FormInput value={smsSender} onChangeText={setSmsSender} placeholder="Messages come from, e.g. 127 or CBE" autoCapitalize="none" accessibilityLabel="SMS sender" />
        <FormInput
          value={smsDigits}
          onChangeText={(value) => setSmsDigits(value.replace(/\D/g, '').slice(0, 4))}
          placeholder="Last digits of the account"
          keyboardType="number-pad"
          maxLength={4}
          accessibilityLabel="Last digits of the account"
        />
        <Button
          title="Save"
          onPress={() => {
            void updateAccountSms(account.id, { smsSender, lastDigits: smsDigits }).then(() => setSmsOpen(false));
          }}
        />
      </SheetModal>

      {/* Rename: the name must be free; the account keeps its id, so its history is untouched. */}
      <SheetModal visible={renameOpen} onClose={closeRename}>
        <AppText variant="title" style={styles.sheetTitle} accessibilityRole="header">
          Rename account
        </AppText>
        <FormInput
          value={renameValue}
          onChangeText={(value) => {
            setRenameError(null);
            setRenameValue(value);
          }}
          placeholder="Account name"
          autoCapitalize="words"
          accessibilityLabel="Account name"
          invalid={renameProblem !== null}
        />
        {renameProblem !== null ? <InlineError message={renameProblem} /> : null}
        {renameError !== null && renameProblem === null ? <InlineError message={renameError} /> : null}
        <Button title="Save name" disabled={renameEmpty || renameProblem !== null} onPress={() => void onSaveName()} />
      </SheetModal>

      {/* Adjust balance: a signed correction that counts in the balance but is never income or an expense. */}
      <SheetModal visible={adjustOpen} onClose={closeAdjust}>
        <AppText variant="title" style={styles.sheetTitle} accessibilityRole="header">
          Adjust {account.name}
        </AppText>
        <AppText style={[styles.helper, { color: colors.textMuted }]}>
          Use this when the balance does not match your {account.type === 'cash' ? 'cash in hand' : account.type === 'wallet' ? 'wallet' : 'bank'}. It is not counted as income or spending.
        </AppText>
        <SegmentedControl options={DIRECTION_OPTIONS} value={direction} onChange={(value) => { setAdjustError(null); setDirection(value); }} />
        <FormInput
          value={adjustAmount}
          onChangeText={(value) => {
            setAdjustError(null);
            setAdjustAmount(value);
          }}
          placeholder={`Amount (${account.currency})`}
          keyboardType="decimal-pad"
          accessibilityLabel={`Adjustment amount in ${account.currency}`}
          invalid={adjustError !== null}
        />
        <FormInput value={adjustNote} onChangeText={setAdjustNote} placeholder="Note (optional)" accessibilityLabel="Note" />
        {adjustError !== null ? <InlineError message={adjustError} /> : null}
        <Button title="Save adjustment" onPress={() => void onSaveAdjustment()} />
      </SheetModal>
    </View>
  );
}

function MenuOption({ icon, label, danger = false, onPress }: { icon: keyof typeof Ionicons.glyphMap; label: string; danger?: boolean; onPress: () => void }) {
  const { colors } = useTheme();
  return (
    <Pressable
      style={({ pressed }) => [styles.menuOption, pressed && { backgroundColor: colors.surfaceMuted }]}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
    >
      <Ionicons name={icon} size={20} color={danger ? colors.expense : colors.text} />
      <AppText style={[styles.menuOptionText, { color: danger ? colors.expense : colors.text }]}>{label}</AppText>
    </Pressable>
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
  notFound: {
    padding: 20,
  },
  balanceCard: {
    padding: 16,
    gap: 10,
  },
  typeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  typeText: {
    flex: 1,
    minWidth: 0,
    fontSize: 13,
    fontWeight: '600',
  },
  balance: {
    fontSize: 28,
    lineHeight: 36,
    fontWeight: '700',
  },
  tiles: {
    flexDirection: 'row',
    gap: 10,
  },
  tile: {
    flex: 1,
    minWidth: 0,
    borderRadius: 14,
    paddingHorizontal: 12,
    paddingVertical: 9,
  },
  tileLabel: {
    fontSize: 11,
    fontWeight: '600',
  },
  tileValue: {
    fontSize: 14,
    fontWeight: '700',
    marginTop: 3,
  },
  card: {
    padding: 14,
    gap: 4,
  },
  cardTitle: {
    fontSize: 15,
    marginBottom: 4,
  },
  helper: {
    fontSize: 12,
    lineHeight: 17,
  },
  goalRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 4,
  },
  goalName: {
    flex: 1,
    minWidth: 0,
    fontSize: 14,
    fontWeight: '600',
  },
  goalAmount: {
    fontSize: 14,
    fontWeight: '600',
  },
  entryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 10,
  },
  entryText: {
    flex: 1,
    minWidth: 0,
  },
  entryTitle: {
    fontSize: 14,
    fontWeight: '600',
  },
  entryMeta: {
    fontSize: 12,
    marginTop: 2,
  },
  entryAmount: {
    flexShrink: 0,
    maxWidth: '42%',
    fontSize: 14,
    fontWeight: '600',
    textAlign: 'right',
  },
  menuBackdrop: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  menuSheet: {
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    borderTopWidth: 1,
    borderLeftWidth: 1,
    borderRightWidth: 1,
    paddingHorizontal: 20,
    paddingTop: 8,
  },
  menuOption: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 16,
  },
  menuOptionText: {
    fontSize: 15,
    fontWeight: '600',
  },
  sheetTitle: {
    fontSize: 18,
  },
});
