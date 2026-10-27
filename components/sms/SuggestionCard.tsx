import { useMemo, useState } from 'react';
import { Alert, Pressable, StyleSheet, Switch, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { Category } from '../../types';
import { AccountsState } from '../../types/accounts';
import { SmsSuggestion } from '../../types/sms';
import { useTheme } from '../../theme/ThemeProvider';
import { formatAmount } from '../../utils/accounts/money';
import { eligibleAccounts, SERVICE_LABEL } from '../../utils/sms/accountMatch';
import { saveNeedsConfirm } from '../../utils/sms/chain';
import { dateSourceNote, isEstimatedDate } from '../../utils/sms/dateSource';
import { serviceFromSender } from '../../utils/sms/parse';
import { recipientKey } from '../../utils/sms/recipient';
import { categoryOf, checkSuggestion, effectiveFee } from '../../utils/sms/saveSuggestion';
import AccountChips from '../accounts/AccountChips';
import AppText from '../AppText';
import Button from '../Button';
import CategoryPicker from '../CategoryPicker';
import Card from '../Card';
import DateField from '../DateField';
import FormInput from '../FormInput';
import InlineError from '../InlineError';
import MoveOpeningAction from './MoveOpeningAction';

interface SuggestionCardProps {
  suggestion: SmsSuggestion;
  state: AccountsState;
  categories: Category[];
  onChange: (patch: { accountId?: string | null; category?: string; feeAmount?: number | null; date?: string }) => void;
  onLinkAccount: (accountId: string) => void;
  // Resolves when saved; throws a message-bearing Error when it could not be (nothing is written then).
  onSave: (remember: boolean) => Promise<void>;
  onIgnore: () => void;
  // Phase 6C-2: "Something is missing between this and the message before it" (a note, never a block).
  chainNote?: string | null;
  // A fee worked out from the balance (a message that printed no charges): only proposed, applied when the owner taps "Use as fee".
  feeProposal?: { fee: number; drop: number } | null;
}

const feeText = (value: number): string => (value > 0 ? String(value) : '');

// One pending message. It says what the message was (direction, amount, who), lets the owner settle the account, date, category and fee, warns
// about anything odd, and saves or ignores it. The warnings come from planning the save without writing it, so they always match what
// Save would do.
export default function SuggestionCard({ suggestion, state, categories, onChange, onLinkAccount, onSave, onIgnore, chainNote = null, feeProposal = null }: SuggestionCardProps) {
  const { colors } = useTheme();
  const [remember, setRemember] = useState(true);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fee, setFee] = useState(feeText(effectiveFee(suggestion)));
  const [feeProblem, setFeeProblem] = useState<string | null>(null);
  // After "Save anyway" on a card that shows the missing-message note the owner is not asked again.
  const [saveAnyway, setSaveAnyway] = useState(false);

  const isOut = suggestion.direction === 'out';
  const accounts = useMemo(() => eligibleAccounts(state.accounts), [state.accounts]);
  const account = accounts.find((item) => item.id === suggestion.accountId) ?? null;
  const check = useMemo(() => checkSuggestion(state, suggestion), [state, suggestion]);
  const options = categories.filter((category) => category.type === (isOut ? 'expense' : 'income'));
  // A message with no category yet is Uncategorised; it saves like any other and can be fixed from Transactions later.
  const selectedCategory = options.find((category) => category.name === categoryOf(suggestion));
  const key = recipientKey(suggestion);
  const who = suggestion.counterpartyName ?? suggestion.counterpartyBank ?? SERVICE_LABEL[suggestion.service];
  const tails = [suggestion.counterpartyPhoneTail, suggestion.counterpartyAccountTail].filter((tail): tail is string => !!tail);
  const toneColor = isOut ? colors.expense : colors.income;
  // Offered when the chosen account is not yet known to be this service's account.
  const canLink = account !== null && serviceFromSender(account.smsSender) !== suggestion.service;
  const showAccountChips = editing || account === null;

  // The fee box keeps what is typed and commits it to the card when it loses focus.
  const commitFee = () => {
    const trimmed = fee.trim();
    if (trimmed === '') {
      setFeeProblem(null);
      onChange({ feeAmount: 0 });
      return;
    }
    const value = Number(trimmed);
    if (!Number.isFinite(value) || value < 0) {
      setFeeProblem('Enter the fee as a number, or leave it empty for none.');
      return;
    }
    setFeeProblem(null);
    onChange({ feeAmount: value });
  };

  // A card that says a message seems to be missing before it asks once before saving (a note is never a block: Save anyway goes ahead).
  const askThenSave = () => {
    if (!saveNeedsConfirm(chainNote, saveAnyway)) {
      void save();
      return;
    }
    Alert.alert('A message seems to be missing before this one', 'Save anyway?', [
      { text: 'Go back', style: 'cancel' },
      {
        text: 'Save anyway',
        onPress: () => {
          setSaveAnyway(true);
          void save();
        },
      },
    ]);
  };

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      await onSave(remember && key !== null);
    } catch (reason) {
      // The suggestion stays pending; nothing was written.
      setError(reason instanceof Error ? reason.message : 'Could not save this message. Nothing was changed.');
    } finally {
      setSaving(false);
    }
  };

  const canSave = !saving && check.missing.length === 0 && check.blocked === null && feeProblem === null;

  return (
    <Card style={styles.card} accessibilityLabel={`${isOut ? 'Money out' : 'Money in'}, ETB ${formatAmount(suggestion.amount)}, ${who}`}>
      <View style={styles.topRow}>
        <View style={[styles.badge, { backgroundColor: isOut ? colors.expenseDisc : colors.incomeDisc }]}>
          <Ionicons name={isOut ? 'arrow-up' : 'arrow-down'} size={14} color={isOut ? colors.expenseGlyph : colors.incomeGlyph} />
          <AppText style={[styles.badgeText, { color: isOut ? colors.expenseGlyph : colors.incomeGlyph }]}>{isOut ? 'Out' : 'In'}</AppText>
        </View>
        <AppText style={[styles.service, { color: colors.textMuted }]}>{SERVICE_LABEL[suggestion.service]}</AppText>
        <AppText variant="number" style={[styles.amount, { color: toneColor }]} numberOfLines={1}>
          ETB {formatAmount(suggestion.amount)}
        </AppText>
      </View>

      <AppText style={[styles.who, { color: colors.text }]} numberOfLines={2}>
        {who}
        {tails.length > 0 ? `  ····${tails[0]}` : ''}
      </AppText>
      {suggestion.note ? <AppText style={[styles.meta, { color: colors.textMuted }]}>{suggestion.note}</AppText> : null}

      {/* Account */}
      <View style={styles.block}>
        <AppText style={[styles.label, { color: colors.textMuted }]}>Account</AppText>
        {account !== null && !showAccountChips ? (
          <AppText style={[styles.value, { color: colors.text }]}>{account.name}</AppText>
        ) : (
          <>
            {account === null ? (
              <AppText style={[styles.meta, { color: colors.text }]}>
                {accounts.length === 0 ? 'Add an ETB account first (Accounts in the menu).' : `Which account is this ${SERVICE_LABEL[suggestion.service]} message from?`}
              </AppText>
            ) : null}
            {accounts.length > 0 ? <AccountChips accounts={accounts} value={account?.id ?? null} onChange={(accountId) => onChange({ accountId })} /> : null}
          </>
        )}
        {canLink && account !== null ? (
          <Button
            title={`Link ${account.name} to ${SERVICE_LABEL[suggestion.service]}`}
            variant="link"
            onPress={() => onLinkAccount(account.id)}
            accessibilityHint="Remembers that this account receives these messages, so the next ones pick it automatically"
          />
        ) : null}
      </View>

      {/* Date */}
      <View style={styles.block}>
        {editing || suggestion.occurredAt === null ? (
          <DateField label={suggestion.occurredAt === null ? 'Date (the message has none)' : 'Date'} value={suggestion.date} onChange={(date) => onChange({ date })} />
        ) : (
          <>
            <AppText style={[styles.label, { color: colors.textMuted }]}>Date</AppText>
            <AppText style={[styles.value, { color: colors.text }]}>{suggestion.date}</AppText>
          </>
        )}
        <View style={styles.dateNote} accessible accessibilityLabel={dateSourceNote(suggestion.dateSource)}>
          <Ionicons name={isEstimatedDate(suggestion.dateSource) ? 'calendar-clear-outline' : 'calendar-outline'} size={13} color={colors.textMuted} />
          <AppText style={[styles.dateNoteText, { color: colors.textMuted }]}>{dateSourceNote(suggestion.dateSource)}</AppText>
        </View>
      </View>

      {/* Category */}
      <View style={styles.block}>
        <AppText style={[styles.label, { color: colors.textMuted }]}>Category</AppText>
        <CategoryPicker
          value={selectedCategory?.id ?? ''}
          options={options}
          onChange={(id) => onChange({ category: options.find((category) => category.id === id)?.name ?? '' })}
          discColor={isOut ? colors.expenseDisc : colors.incomeDisc}
          glyphColor={isOut ? colors.expenseGlyph : colors.incomeGlyph}
        />
        {key !== null ? (
          <View style={styles.switchRow}>
            <AppText style={[styles.meta, styles.switchLabel, { color: colors.text }]}>Remember for {suggestion.counterpartyName ?? 'this recipient'}</AppText>
            <Switch
              value={remember}
              onValueChange={setRemember}
              trackColor={{ true: colors.primary, false: colors.border }}
              accessibilityLabel={`Remember this category for ${suggestion.counterpartyName ?? 'this recipient'}`}
            />
          </View>
        ) : null}
      </View>

      {/* Fee: money out only */}
      {isOut && (editing || effectiveFee(suggestion) > 0) ? (
        <View style={styles.block}>
          <AppText style={[styles.label, { color: colors.textMuted }]}>Fee (service charge, VAT and any other charge)</AppText>
          {editing ? (
            <FormInput
              value={fee}
              onChangeText={(value) => {
                setFeeProblem(null);
                setFee(value);
              }}
              onBlur={commitFee}
              onEndEditing={commitFee}
              placeholder="0.00"
              keyboardType="decimal-pad"
              accessibilityLabel="Fee"
              invalid={feeProblem !== null}
            />
          ) : (
            <AppText style={[styles.value, { color: colors.text }]}>ETB {formatAmount(effectiveFee(suggestion))}, saved as its own Fees expense</AppText>
          )}
          {feeProblem !== null ? <InlineError message={feeProblem} /> : null}
        </View>
      ) : null}

      {/* The figures of the message were corrected, or do not add up */}
      {suggestion.flags.includes('amount_was_total') && suggestion.totalDeducted !== null ? (
        <View style={[styles.notice, { backgroundColor: colors.surfaceMuted, borderColor: colors.border }]}>
          <Ionicons name="information-circle-outline" size={18} color={colors.text} />
          <AppText style={[styles.noticeText, { color: colors.text }]}>
            The message printed ETB {formatAmount(suggestion.totalDeducted)} as the amount, which is the total debited. Talari shows ETB {formatAmount(suggestion.amount)} as the amount and ETB {formatAmount(effectiveFee(suggestion))} as the charges, so the fee is not counted twice.
          </AppText>
        </View>
      ) : null}
      {suggestion.flags.includes('fee_from_total') && suggestion.totalDeducted !== null ? (
        <View style={[styles.notice, { backgroundColor: colors.surfaceMuted, borderColor: colors.border }]}>
          <Ionicons name="information-circle-outline" size={18} color={colors.text} />
          <AppText style={[styles.noticeText, { color: colors.text }]}>
            The message&apos;s total (ETB {formatAmount(suggestion.totalDeducted)}) is ETB {formatAmount(suggestion.totalDeducted - suggestion.amount)} more than the amount, so that is shown as the fee.
          </AppText>
        </View>
      ) : null}

      {/* The balance chain (Phase 6C-2) */}
      {chainNote !== null ? (
        <View style={[styles.notice, { backgroundColor: colors.surfaceMuted, borderColor: colors.border }]} accessibilityRole="alert">
          <Ionicons name="git-compare-outline" size={18} color={colors.text} />
          <AppText style={[styles.noticeText, { color: colors.text }]}>{chainNote}</AppText>
        </View>
      ) : null}
      {feeProposal !== null && isOut && suggestion.feeAmount === null ? (
        <View style={[styles.notice, { backgroundColor: colors.surfaceMuted, borderColor: colors.border }]}>
          <Ionicons name="calculator-outline" size={18} color={colors.text} />
          <View style={styles.proposal}>
            <AppText style={[styles.noticeText, { color: colors.text }]}>
              The balance dropped by ETB {formatAmount(feeProposal.drop)}, ETB {formatAmount(feeProposal.fee)} more than the amount. That could be a fee the message did not print.
            </AppText>
            <Button
              title={`Use ETB ${formatAmount(feeProposal.fee)} as the fee`}
              variant="secondary"
              onPress={() => {
                setFee(String(feeProposal.fee));
                setFeeProblem(null);
                onChange({ feeAmount: feeProposal.fee });
              }}
              accessibilityHint="Adds this as a fee on this message. You can still change it."
            />
          </View>
        </View>
      ) : null}

      {/* Warnings and blocks */}
      {check.warnings.map((warning) => (
        <View key={warning.kind} style={[styles.notice, { backgroundColor: colors.surfaceMuted, borderColor: colors.border }]} accessibilityRole="alert">
          <Ionicons name="warning-outline" size={18} color={colors.text} />
          <AppText style={[styles.noticeText, { color: colors.text }]}>{warning.message}</AppText>
        </View>
      ))}
      {check.blocked !== null ? <InlineError message={check.blocked} /> : null}
      {check.beforeOpening && account !== null ? <MoveOpeningAction accountId={account.id} /> : null}
      {error !== null ? <InlineError message={error} /> : null}

      <View style={styles.actions}>
        <Button title={saving ? 'Saving…' : 'Save'} onPress={askThenSave} disabled={!canSave} style={styles.action} />
        <Button title="Skip" variant="secondary" onPress={onIgnore} disabled={saving} style={styles.action} accessibilityHint="Moves this message to the Skipped list. You can restore it later." />
        <Pressable
          onPress={() => setEditing((value) => !value)}
          accessibilityRole="button"
          accessibilityLabel={editing ? 'Done editing' : 'Edit this message'}
          hitSlop={8}
          style={({ pressed }) => [styles.editButton, pressed && { opacity: 0.6 }]}
        >
          <AppText style={[styles.editText, { color: colors.primaryText }]}>{editing ? 'Done' : 'Edit'}</AppText>
        </Pressable>
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  card: {
    padding: 16,
    gap: 10,
  },
  topRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 999,
  },
  badgeText: {
    fontSize: 12,
    fontWeight: '700',
  },
  service: {
    flex: 1,
    fontSize: 12,
    fontWeight: '600',
  },
  amount: {
    fontSize: 20,
    fontWeight: '700',
  },
  who: {
    fontSize: 16,
    fontWeight: '600',
  },
  meta: {
    fontSize: 13,
    lineHeight: 18,
  },
  block: {
    gap: 4,
  },
  label: {
    fontSize: 12,
    fontWeight: '600',
  },
  value: {
    fontSize: 14,
    fontWeight: '600',
  },
  proposal: {
    flex: 1,
    gap: 8,
  },
  dateNote: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  dateNoteText: {
    fontSize: 12,
    lineHeight: 16,
  },
  switchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    minHeight: 44,
  },
  switchLabel: {
    flex: 1,
  },
  notice: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    borderWidth: 1,
    borderRadius: 12,
    padding: 10,
  },
  noticeText: {
    flex: 1,
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '600',
  },
  actions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 4,
  },
  action: {
    flex: 1,
  },
  editButton: {
    minHeight: 44,
    paddingHorizontal: 8,
    justifyContent: 'center',
  },
  editText: {
    fontSize: 14,
    fontWeight: '700',
  },
});
