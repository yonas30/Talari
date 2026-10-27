import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { AccountsState } from '../../types/accounts';
import { useTheme } from '../../theme/ThemeProvider';
import { formatAmount } from '../../utils/accounts/money';
import { dateSourceNote } from '../../utils/sms/dateSource';
import { PairCandidate, PairSide } from '../../utils/sms/pairing';
import { PairCheck, PairMode } from '../../utils/sms/pairSave';
import AppText from '../AppText';
import Button from '../Button';
import Card from '../Card';
import FormInput from '../FormInput';
import InlineError from '../InlineError';

interface PairCardProps {
  candidate: PairCandidate;
  check: PairCheck;
  state: AccountsState;
  onFee: (value: number | null) => void;
  // Resolves when saved; throws a message-bearing Error when it could not be (nothing is written then).
  onAccept: (mode: PairMode, fee: number | null) => Promise<void>;
  onReject: (reason: 'not_pair' | 'keep_separate') => void;
}

const nameOf = (state: AccountsState, id: string): string => state.accounts.find((account) => account.id === id)?.name ?? 'Account';

// One possible transfer between two of the owner's own accounts, shown as ONE card with both sides. It is only a suggestion: nothing is saved
// until Accept (or Convert), and "Not a pair" / "Keep separate" send both messages back to being ordinary cards for good.
export default function PairCard({ candidate, check, state, onFee, onAccept, onReject }: PairCardProps) {
  const { colors } = useTheme();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fee, setFee] = useState(check.fee > 0 ? String(check.fee) : '');
  const [feeProblem, setFeeProblem] = useState<string | null>(null);
  const from = nameOf(state, candidate.fromAccountId);
  const to = nameOf(state, candidate.toAccountId);

  // Applied as the owner TYPES, so the effect line below changes at once. An empty box means no fee; something that is not a number is
  // reported and the last good value stays in force.
  const applyFee = (text: string) => {
    const trimmed = text.trim();
    if (trimmed === '') {
      setFeeProblem(null);
      onFee(0);
      return;
    }
    const value = Number(trimmed);
    if (!Number.isFinite(value) || value < 0) {
      setFeeProblem('Enter the fee as a number, or leave it empty for none.');
      return;
    }
    setFeeProblem(null);
    onFee(value);
  };

  const run = async (mode: PairMode) => {
    setSaving(true);
    setError(null);
    try {
      const typed = fee.trim() === '' ? 0 : Number(fee.trim());
      await onAccept(mode, Number.isFinite(typed) && typed >= 0 ? typed : null);
    } catch (reason) {
      // Both messages stay pending; nothing was written.
      setError(reason instanceof Error ? reason.message : 'Could not save this transfer. Nothing was changed.');
    } finally {
      setSaving(false);
    }
  };

  const hasExisting = check.existingEntry !== null;

  return (
    <Card style={styles.card} accessibilityLabel={`Possible transfer of ETB ${formatAmount(candidate.amount)} from ${from} to ${to}`}>
      <View style={styles.topRow}>
        <View style={[styles.badge, { backgroundColor: colors.transferDisc }]}>
          <Ionicons name="swap-horizontal" size={14} color={colors.transferGlyph} />
          <AppText style={[styles.badgeText, { color: colors.transferGlyph }]}>Transfer?</AppText>
        </View>
        <AppText style={[styles.reason, { color: colors.textMuted }]}>
          {candidate.rule === 'reference' ? 'Same transaction number' : candidate.rule === 'names' ? 'Same amount and day, and one names the other' : 'Same amount and day, and your own name is on one side'}
        </AppText>
      </View>
      <AppText variant="number" style={[styles.amount, { color: colors.text }]}>
        ETB {formatAmount(candidate.amount)}
      </AppText>
      <AppText style={[styles.route, { color: colors.text }]}>
        {from} → {to}
      </AppText>

      <Side title="Sent" side={candidate.out} account={from} />
      <Side title="Received" side={candidate.inn} account={to} />

      <View style={[styles.decided, { backgroundColor: colors.surfaceMuted, borderColor: colors.border }]}>
        <AppText style={[styles.label, { color: colors.textMuted }]}>Transfer date</AppText>
        <AppText style={[styles.value, { color: colors.text }]}>{check.decided.date}</AppText>
        <AppText style={[styles.meta, { color: colors.textMuted }]}>
          {check.decided.upgraded.length > 0
            ? 'Taken from the better-sourced message; the other is recorded as paired with it.'
            : dateSourceNote(check.decided.source)}
        </AppText>
      </View>

      {check.feeDifference !== null ? (
        <View style={[styles.decided, { backgroundColor: colors.surfaceMuted, borderColor: colors.border }]} accessibilityLiveRegion="polite">
          <AppText style={[styles.value, { color: colors.text }]}>
            Your entry is ETB {formatAmount(check.feeDifference.entry)}. The transfer is ETB {formatAmount(check.feeDifference.transfer)}. The difference ETB {formatAmount(check.feeDifference.difference)} becomes the fee.
          </AppText>
        </View>
      ) : null}

      {candidate.out.kind === 'suggestion' || check.feeDifference !== null ? (
        <View style={styles.block}>
          <AppText style={[styles.label, { color: colors.textMuted }]}>Fee (saved as its own Fees expense, linked to the transfer)</AppText>
          <FormInput
            value={fee}
            onChangeText={(value) => {
              setFee(value);
              applyFee(value);
            }}
            placeholder="0.00"
            keyboardType="decimal-pad"
            accessibilityLabel="Fee"
            invalid={feeProblem !== null}
          />
          {feeProblem !== null ? <InlineError message={feeProblem} /> : null}
          {check.feeEffect !== null && feeProblem === null ? (
            <AppText style={[styles.meta, { color: colors.text }]} accessibilityLiveRegion="polite">
              {check.feeEffect.text}
            </AppText>
          ) : null}
        </View>
      ) : null}

      {check.ambiguous !== null ? <InlineError message={check.ambiguous} /> : null}

      {hasExisting ? (
        <View style={[styles.decided, { backgroundColor: colors.surfaceMuted, borderColor: colors.border }]}>
          <AppText style={[styles.label, { color: colors.textMuted }]}>
            {candidate.existingDuplicatesAMessage ? 'You already have one side in your entries' : 'One side is already in your entries'}
          </AppText>
          {check.changes.map((line) => (
            <AppText key={line} style={[styles.meta, { color: colors.text }]}>
              {line}
            </AppText>
          ))}
        </View>
      ) : null}

      {check.warnings.map((warning) => (
        <View key={warning.kind} style={[styles.notice, { backgroundColor: colors.surfaceMuted, borderColor: colors.border }]} accessibilityRole="alert">
          <Ionicons name="warning-outline" size={18} color={colors.text} />
          <AppText style={[styles.noticeText, { color: colors.text }]}>{warning.message}</AppText>
        </View>
      ))}
      {hasExisting && check.convertBlocked !== null ? <InlineError message={check.convertBlocked} /> : null}
      {check.newBlocked !== null ? <InlineError message={check.newBlocked} /> : null}
      {error !== null ? <InlineError message={error} /> : null}

      <View style={styles.actions}>
        {hasExisting && check.canConvert ? <Button title={saving ? 'Saving…' : 'Convert my entry to this transfer'} onPress={() => void run('convert')} disabled={saving || feeProblem !== null} /> : null}
        {check.canAddNew ? (
          <Button
            title={saving ? 'Saving…' : hasExisting ? 'Add as a new transfer (records it twice)' : 'Accept as one transfer'}
            variant={hasExisting ? 'secondary' : 'primary'}
            onPress={() => void run('new')}
            disabled={saving || feeProblem !== null}
          />
        ) : null}
        <View style={styles.row}>
          <Button title="Not a pair" variant="secondary" onPress={() => onReject('not_pair')} disabled={saving} style={styles.rowButton} accessibilityHint="These two messages are unrelated. They will not be offered together again." />
          <Button title="Keep separate" variant="secondary" onPress={() => onReject('keep_separate')} disabled={saving} style={styles.rowButton} accessibilityHint="Save them as separate entries. They will not be offered together again." />
        </View>
      </View>
    </Card>
  );
}

function Side({ title, side, account }: { title: string; side: PairSide; account: string }) {
  const { colors } = useTheme();
  return (
    <View style={styles.side} accessible accessibilityLabel={`${title}: ${side.label}, ${account}, ${side.date}. ${dateSourceNote(side.dateSource)}`}>
      <AppText style={[styles.label, { color: colors.textMuted }]}>{title}</AppText>
      <AppText style={[styles.value, { color: colors.text }]} numberOfLines={2}>
        {side.kind === 'entry' ? `Your entry: ${side.label}` : side.label} · {account}
      </AppText>
      <View style={styles.dateRow}>
        <Ionicons name="calendar-outline" size={13} color={colors.textMuted} />
        <AppText style={[styles.meta, { color: colors.textMuted }]}>
          {side.date} · {dateSourceNote(side.dateSource)}
        </AppText>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { padding: 16, gap: 10 },
  topRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  badge: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 8, paddingVertical: 4, borderRadius: 999 },
  badgeText: { fontSize: 12, fontWeight: '700' },
  reason: { flex: 1, fontSize: 12, lineHeight: 16 },
  amount: { fontSize: 22, fontWeight: '700' },
  route: { fontSize: 15, fontWeight: '600' },
  side: { gap: 2 },
  dateRow: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  block: { gap: 4 },
  label: { fontSize: 12, fontWeight: '600' },
  value: { fontSize: 14, fontWeight: '600' },
  meta: { fontSize: 12, lineHeight: 17 },
  decided: { borderWidth: 1, borderRadius: 12, padding: 10, gap: 3 },
  notice: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, borderWidth: 1, borderRadius: 12, padding: 10 },
  noticeText: { flex: 1, fontSize: 13, lineHeight: 18, fontWeight: '600' },
  actions: { gap: 8, marginTop: 4 },
  row: { flexDirection: 'row', gap: 8 },
  rowButton: { flex: 1 },
});
