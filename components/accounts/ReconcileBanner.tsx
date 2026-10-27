import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { useTheme } from '../../theme/ThemeProvider';
import { formatAmount } from '../../utils/accounts/money';
import { SERVICE_LABEL } from '../../utils/sms/accountMatch';
import { gapSentence } from '../../utils/sms/chain';
import { AdjustmentOptions, MAX_ADJUSTMENT_NOTE, ReconcileStatus } from '../../utils/sms/reconcile';
import AppText from '../AppText';
import Button from '../Button';
import DateField from '../DateField';
import FormInput from '../FormInput';
import InlineError from '../InlineError';
import SheetModal from '../SheetModal';

interface ReconcileBannerProps {
  status: ReconcileStatus;
  // Applies the adjustment. Throws a message-bearing Error when it cannot (nothing is written then).
  onAdjust: (options: AdjustmentOptions) => Promise<void>;
  onDismiss: () => void;
  // Hidden balances: the figures are masked, like everywhere else.
  mask: (text: string) => string;
}

// The orange "balance does not match your bank" banner of the account screen (V2_SPEC Part Z, Phase 6C-2). It says which message it is
// comparing with and as of which day, so the owner can judge a small difference that is only a same-day timing effect, and where the
// difference most likely comes from. "Add adjustment" asks for the day (default: the message's) and an optional note before it writes anything.
export default function ReconcileBanner({ status, onAdjust, onDismiss, mask }: ReconcileBannerProps) {
  const { colors } = useTheme();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [date, setDate] = useState<string | null>(status.date);
  const [note, setNote] = useState('');
  const bank = `ETB ${formatAmount(status.bankBalance)}`;
  const talari = `ETB ${formatAmount(status.talariBalance)}`;
  const difference = `ETB ${formatAmount(Math.abs(status.difference))}`;

  const openSheet = () => {
    setDate(status.date);
    setNote('');
    setError(null);
    setOpen(true);
  };

  const adjust = async () => {
    setBusy(true);
    setError(null);
    try {
      await onAdjust({ date: date ?? status.date, note });
      setOpen(false);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not add the adjustment. Nothing was changed.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <View
      style={[styles.banner, { backgroundColor: colors.accentDisc, borderColor: colors.primary }]}
      accessibilityRole="alert"
      accessibilityLabel="Your balance does not match your bank"
    >
      <View style={styles.head}>
        <Ionicons name="alert-circle-outline" size={20} color={colors.primaryText} />
        <AppText style={[styles.title, { color: colors.text }]}>Balance doesn&apos;t match your bank</AppText>
      </View>
      <AppText style={[styles.text, { color: colors.text }]}>
        Your {SERVICE_LABEL[status.service]} message of {status.date} says {mask(bank)}. Talari has {mask(talari)} as of that day. The difference is{' '}
        {mask(difference)} ({status.difference > 0 ? 'the bank has more' : 'Talari has more'}).
      </AppText>
      {status.gaps.length > 0 ? (
        <View style={styles.gaps}>
          <AppText style={[styles.text, { color: colors.text, fontWeight: '700' }]}>Likely where it comes from:</AppText>
          {status.gaps.map((gap) => (
            <AppText key={`${gap.fromDate}-${gap.toDate}-${gap.amount}`} style={[styles.text, { color: colors.text }]}>
              • {gapSentence(gap, mask)}
            </AppText>
          ))}
        </View>
      ) : null}
      <View style={styles.actions}>
        <Button title="Add adjustment" onPress={openSheet} disabled={busy} style={styles.action} accessibilityHint="Asks for the day and a note, then adds one adjustment for the difference. It is not income or spending." />
        <Button title="Dismiss" variant="secondary" onPress={onDismiss} disabled={busy} style={styles.action} accessibilityHint="Hides this until a newer message arrives and the balances still differ" />
      </View>

      <SheetModal visible={open} onClose={() => setOpen(false)}>
        <AppText variant="title" style={styles.sheetTitle} accessibilityRole="header">
          Add adjustment
        </AppText>
        <AppText style={[styles.text, { color: colors.textMuted }]}>
          One adjustment of {mask(difference)} ({status.difference > 0 ? 'adds to' : 'takes from'} the account) so Talari agrees with the bank. It is not income or spending.
        </AppText>
        <DateField label="Day" value={date} onChange={setDate} />
        <FormInput
          value={note}
          onChangeText={(value) => {
            setError(null);
            setNote(value);
          }}
          placeholder="What was it? (optional), e.g. failed ATM withdrawal"
          maxLength={MAX_ADJUSTMENT_NOTE}
          accessibilityLabel="Note, optional"
        />
        {error !== null ? <InlineError message={error} /> : null}
        <View style={styles.actions}>
          <Button title="Cancel" variant="secondary" onPress={() => setOpen(false)} disabled={busy} style={styles.action} />
          <Button title={busy ? 'Adding…' : 'Confirm'} onPress={() => void adjust()} disabled={busy} style={styles.action} />
        </View>
      </SheetModal>
    </View>
  );
}

const styles = StyleSheet.create({
  banner: { borderWidth: 1.5, borderRadius: 14, padding: 14, gap: 8 },
  head: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  title: { flex: 1, fontSize: 15, fontWeight: '700' },
  text: { fontSize: 13, lineHeight: 19 },
  gaps: { gap: 2 },
  sheetTitle: { fontSize: 18 },
  actions: { flexDirection: 'row', gap: 8, marginTop: 2 },
  action: { flex: 1 },
});
