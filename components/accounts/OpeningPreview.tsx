import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { useSmsStore } from '../../store/sms';
import { useUiStore } from '../../store/ui';
import { useTheme } from '../../theme/ThemeProvider';
import { formatAmount } from '../../utils/accounts/money';
import { formatDateKey, maskAmount } from '../../utils/format';
import { SERVICE_LABEL } from '../../utils/sms/accountMatch';
import { OpeningOffer } from '../../utils/sms/opening';
import AppText from '../AppText';
import Button from '../Button';
import InlineError from '../InlineError';
import SheetModal from '../SheetModal';

interface OpeningPreviewProps {
  offer: OpeningOffer | null;
  onClose: () => void;
}

const TITLES: Record<OpeningOffer['mode'], string> = {
  create: 'Create the opening balance',
  move: 'Move the opening balance back',
  replace: 'Replace the opening balance',
};

// The before-and-after of an opening-balance change (V2_SPEC Part Z, Phase 6C-3). Nothing is written until Confirm; while balances are hidden
// every figure here is hidden, the words stay.
export default function OpeningPreview({ offer, onClose }: OpeningPreviewProps) {
  const { colors } = useTheme();
  const isBalanceHidden = useUiStore((store) => store.isBalanceHidden);
  const applyOpeningChange = useSmsStore((store) => store.applyOpeningChange);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const close = () => {
    setError(null);
    onClose();
  };

  const mask = (text: string) => maskAmount(text, isBalanceHidden);
  const etb = (value: number) => mask(`ETB ${formatAmount(value)}`);

  const confirm = async () => {
    if (offer === null) return;
    setBusy(true);
    setError(null);
    try {
      await applyOpeningChange(offer);
      close();
    } catch (reason) {
      // Nothing was changed. The text says why (it may be that things changed since the preview was made).
      setError(reason instanceof Error ? reason.message : 'Could not change the opening balance. Nothing was changed.');
    } finally {
      setBusy(false);
    }
  };

  const line = (label: string, value: string) => (
    <View style={styles.line} key={label}>
      <AppText style={[styles.label, { color: colors.textMuted }]}>{label}</AppText>
      <AppText style={[styles.value, { color: colors.text }]}>{value}</AppText>
    </View>
  );

  return (
    <SheetModal visible={offer !== null} onClose={close}>
      {offer !== null ? (
        <>
          <AppText variant="title" style={styles.title} accessibilityRole="header">
            {TITLES[offer.mode]}
          </AppText>
          <AppText style={[styles.text, { color: colors.textMuted }]}>
            {offer.source === 'messages' && offer.basis !== null
              ? `Worked out from your ${SERVICE_LABEL[offer.basis.service]} message of ${formatDateKey(offer.basis.date)}, the oldest one. Nothing changes until you confirm.`
              : 'The opening balance you typed. Nothing changes until you confirm.'}
          </AppText>

          {offer.estimatedWarning !== null ? (
            <View style={[styles.warning, { backgroundColor: colors.accentDisc, borderColor: colors.primary }]} accessibilityRole="alert">
              <Ionicons name="alert-circle-outline" size={18} color={colors.primaryText} />
              <AppText style={[styles.warningText, { color: colors.text }]}>{offer.estimatedWarning}</AppText>
            </View>
          ) : null}

          <View style={[styles.box, { backgroundColor: colors.surfaceMuted, borderColor: colors.border }]}>
            {line('Opening now', offer.before === null ? 'None' : `${etb(offer.before.amount)} on ${formatDateKey(offer.before.date)}`)}
            {line(
              'Opening after',
              offer.after.amount === 0 ? 'None (the account started at zero)' : `${etb(offer.after.amount)} on ${formatDateKey(offer.after.date)}`,
            )}
            {line(`${offer.accountName} balance now`, etb(offer.balanceNow))}
            {line(`${offer.accountName} balance after`, etb(offer.balanceAfter))}
          </View>

          {offer.saves.length > 0 ? (
            <View style={styles.saves}>
              <AppText style={[styles.text, { color: colors.text }]}>
                {offer.saves.length === 1 ? '1 message is saved with it:' : `${offer.saves.length} messages are saved with it:`}
              </AppText>
              {offer.saves.map((save) => (
                <AppText key={save.id} style={[styles.save, { color: colors.textMuted }]}>
                  • {save.direction === 'out' ? 'Out' : 'In'} {etb(save.amount)}
                  {save.fee > 0 ? ` and a fee of ${etb(save.fee)}` : ''} · {formatDateKey(save.date)}
                </AppText>
              ))}
            </View>
          ) : null}

          {offer.check !== null ? (
            <AppText style={[styles.text, { color: colors.textMuted }]}>
              After this, Talari matches your {SERVICE_LABEL[offer.check.service]} message of {formatDateKey(offer.check.date)}, which says {etb(offer.check.bankBalance)}.
            </AppText>
          ) : null}
          <AppText style={[styles.text, { color: colors.textMuted }]}>
            Your other transactions are not changed. The opening balance is not counted as income or spending.
          </AppText>

          {error !== null ? <InlineError message={error} /> : null}
          <View style={styles.actions}>
            <Button title="Cancel" variant="secondary" onPress={close} disabled={busy} style={styles.action} />
            <Button title={busy ? 'Saving…' : 'Confirm'} onPress={() => void confirm()} disabled={busy} style={styles.action} />
          </View>
        </>
      ) : null}
    </SheetModal>
  );
}

const styles = StyleSheet.create({
  title: { fontSize: 18 },
  text: { fontSize: 13, lineHeight: 19 },
  warning: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, borderWidth: 1.5, borderRadius: 14, padding: 12 },
  warningText: { flex: 1, minWidth: 0, fontSize: 13, lineHeight: 19 },
  box: { borderWidth: 1, borderRadius: 14, padding: 12, gap: 8 },
  line: { flexDirection: 'row', justifyContent: 'space-between', gap: 12 },
  label: { flexShrink: 1, fontSize: 13 },
  value: { flexShrink: 1, fontSize: 13, fontWeight: '600', textAlign: 'right' },
  saves: { gap: 4 },
  save: { fontSize: 12, lineHeight: 17 },
  actions: { flexDirection: 'row', gap: 8 },
  action: { flex: 1 },
});
