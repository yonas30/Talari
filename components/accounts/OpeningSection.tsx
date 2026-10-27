import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { useAccountsState } from '../../store/finance';
import { useSmsStore } from '../../store/sms';
import { useUiStore } from '../../store/ui';
import { useTheme } from '../../theme/ThemeProvider';
import { formatAmount } from '../../utils/accounts/money';
import { defaultCtx } from '../../utils/accounts/context';
import { todayKey } from '../../utils/dates';
import { formatDateKey, maskAmount } from '../../utils/format';
import { OpeningOffer, proposeFromMessages, proposeTyped } from '../../utils/sms/opening';
import AppText from '../AppText';
import Button from '../Button';
import Card from '../Card';
import DateField from '../DateField';
import FormInput from '../FormInput';
import InlineError from '../InlineError';
import SheetModal from '../SheetModal';
import OpeningPreview from './OpeningPreview';

interface OpeningSectionProps {
  accountId: string;
  // Opens "Type it" from elsewhere on the page (the quiet card's button).
  typeOpen: boolean;
  onTypeOpenChange: (open: boolean) => void;
}

// The "Opening balance" card of an ETB account's screen (V2_SPEC Part Z, Phase 6C-3): what the opening is now, "Get it from my messages" and
// "Type it". Both end in the same before-and-after preview; an answer that cannot be offered is shown as words, never applied.
export default function OpeningSection({ accountId, typeOpen, onTypeOpenChange }: OpeningSectionProps) {
  const { colors } = useTheme();
  const state = useAccountsState();
  const suggestions = useSmsStore((store) => store.suggestions);
  const openingOptions = useSmsStore((store) => store.openingOptions);
  const isBalanceHidden = useUiStore((store) => store.isBalanceHidden);
  const [preview, setPreview] = useState<OpeningOffer | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [amount, setAmount] = useState('');
  const [date, setDate] = useState<string | null>(null);
  const [typedError, setTypedError] = useState<string | null>(null);

  const mask = (text: string) => maskAmount(text, isBalanceHidden);
  const opening = state.entries.find((entry) => entry.type === 'opening' && entry.accountId === accountId) ?? null;
  const options = () => ({ ...openingOptions(mask), ctx: defaultCtx });

  const fromMessages = () => {
    setMessage(null);
    const proposal = proposeFromMessages(state, suggestions, accountId, options(), true);
    if (proposal.kind === 'offer') setPreview(proposal);
    else if (proposal.kind === 'refused') setMessage(proposal.message);
  };

  const openTyped = () => {
    setAmount(opening ? String(opening.amount) : '');
    setDate(opening ? opening.date : todayKey());
    setTypedError(null);
    onTypeOpenChange(true);
  };

  const lookAtTyped = () => {
    const value = amount.trim() === '' ? 0 : Number(amount);
    const proposal = proposeTyped(state, suggestions, accountId, { amount: value, date: date ?? todayKey() }, options());
    if (proposal.kind === 'offer') {
      onTypeOpenChange(false);
      setPreview(proposal);
    } else if (proposal.kind === 'refused') {
      setTypedError(proposal.message);
    }
  };

  // The quiet card asks for the sheet from outside: fill it in when it opens that way.
  const sheetVisible = typeOpen;

  return (
    <Card style={styles.card}>
      <AppText variant="title" style={styles.title} accessibilityRole="header">
        Opening balance
      </AppText>
      <AppText style={[styles.text, { color: colors.textMuted }]}>
        {opening
          ? `${mask(`ETB ${formatAmount(opening.amount)}`)} on ${formatDateKey(opening.date)}${opening.note ? ` · ${opening.note}` : ' · typed'}`
          : 'None yet. The balance starts at zero and follows what you record or import.'}
      </AppText>
      {message !== null ? <InlineError message={message} /> : null}
      <View style={styles.actions}>
        <Button title="Get it from my messages" variant="secondary" onPress={fromMessages} style={styles.action} />
        <Button title="Type it" variant="secondary" onPress={openTyped} style={styles.action} />
      </View>

      <SheetModal visible={sheetVisible} onClose={() => onTypeOpenChange(false)}>
        <AppText variant="title" style={styles.title} accessibilityRole="header">
          Type the opening balance
        </AppText>
        <AppText style={[styles.text, { color: colors.textMuted }]}>
          What was in the account at the start of that day. Zero removes the opening balance. You will see before and after before anything changes.
        </AppText>
        <FormInput
          value={amount}
          onChangeText={(value) => {
            setTypedError(null);
            setAmount(value);
          }}
          placeholder="0.00"
          keyboardType="decimal-pad"
          accessibilityLabel="Opening balance amount"
          invalid={typedError !== null}
        />
        <DateField label="Day" value={date} onChange={setDate} />
        {typedError !== null ? <InlineError message={typedError} /> : null}
        <Button title="Look at it" onPress={lookAtTyped} />
      </SheetModal>

      <OpeningPreview offer={preview} onClose={() => setPreview(null)} />
    </Card>
  );
}

const styles = StyleSheet.create({
  card: { padding: 14, gap: 8 },
  title: { fontSize: 15 },
  text: { fontSize: 12, lineHeight: 17 },
  actions: { flexDirection: 'row', gap: 8 },
  action: { flex: 1 },
});
