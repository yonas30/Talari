import { useState } from 'react';
import { Pressable, StyleSheet, Switch, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { useAccountDraft } from '../../store/accountDraft';
import { useFinanceStore } from '../../store/finance';
import { useTheme } from '../../theme/ThemeProvider';
import { accountColors } from '../../theme/tokens';
import { AccountType, MoneyAccount } from '../../types/accounts';
import { AccountsError } from '../../utils/accounts/errors';
import { accountNameProblem, MAX_SMS_SENDER_LENGTH } from '../../utils/accounts/manage';
import { getRateToETB } from '../../utils/currency';
import { SERVICE_SENDER } from '../../utils/sms/accountMatch';
import { formatNumber } from '../../utils/format';
import AppText from '../AppText';
import Button from '../Button';
import FormInput from '../FormInput';
import InlineError from '../InlineError';
import SegmentedControl, { SegmentOption } from '../SegmentedControl';
import CurrencyChips from './CurrencyChips';

const TYPE_OPTIONS: SegmentOption<AccountType>[] = [
  { key: 'cash', label: 'Cash' },
  { key: 'wallet', label: 'Wallet' },
  { key: 'bank', label: 'Bank' },
];

interface QuickPick {
  label: string;
  // The name it fills in. Empty for "Other": the owner types their own.
  name: string;
  // The SMS sender it pre-fills (Telebirr 127, CBE CBE, BOA BOA, Awash Awash Bank). Other picks leave the field as it is.
  sender?: string;
}

// Quick picks under the name field. Banks are the ones the owner named; wallets and cash get a short list of their own.
const QUICK_PICKS: Record<AccountType, QuickPick[]> = {
  bank: [
    { label: 'CBE', name: 'CBE', sender: SERVICE_SENDER.cbe },
    { label: 'BOA', name: 'BOA', sender: SERVICE_SENDER.boa },
    { label: 'Awash', name: 'Awash Bank', sender: SERVICE_SENDER.awash },
    { label: 'Dashen', name: 'Dashen Bank' },
    { label: 'Other', name: '' },
  ],
  wallet: [
    { label: 'Telebirr', name: 'Telebirr', sender: SERVICE_SENDER.telebirr },
    { label: 'M-Pesa', name: 'M-Pesa' },
    { label: 'CBE Birr', name: 'CBE Birr' },
    { label: 'Other', name: '' },
  ],
  cash: [
    { label: 'Cash', name: 'Cash' },
    { label: 'Other', name: '' },
  ],
};

interface AccountFormProps {
  submitLabel?: string;
  onCreated: (account: MoneyAccount) => void;
  // A foreign account needs a stored rate before it can be created. The host takes the owner to the Exchange rates screen (the draft
  // stays in the draft store, so the choices are still here when they come back).
  onSetRate: (currency: string) => void;
}

// The New account form: type, name (with quick picks), "What's in it right now?" with a currency, and the button. Used inside the New
// account sheet and as the first-account setup. What the owner types is kept in the draft store, never only in this component.
export default function AccountForm({ submitLabel = 'Add account', onCreated, onSetRate }: AccountFormProps) {
  const { colors } = useTheme();
  const { draft, setDraft, resetDraft } = useAccountDraft();
  const exchangeRates = useFinanceStore((state) => state.exchangeRates);
  const accounts = useFinanceStore((state) => state.accounts);
  const addAccount = useFinanceStore((state) => state.addAccount);
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  const picks = QUICK_PICKS[draft.type];
  const tokens = accountColors(colors, draft.type);
  const rate = draft.currency === 'ETB' ? 1 : getRateToETB(draft.currency, exchangeRates);
  // Never create a foreign account without a rate: it could not be valued (V2_SPEC Part B section 1).
  const needsRate = rate === null;
  // "Get it from my messages": no starting amount is typed, so the account has no opening entry until the first import creates one.
  const numericAmount = draft.fromMessages || draft.amount.trim() === '' ? 0 : Number(draft.amount);
  const amountOk = Number.isFinite(numericAmount) && numericAmount >= 0;
  const matchesPick = picks.some((pick) => pick.name !== '' && pick.name === draft.name);
  // A name another account (archived ones included) already has: shown under the field as the owner types, with a free name to try, and the
  // button stays off until it is fixed. What was typed is kept.
  const nameProblem = accountNameProblem(accounts, draft.name);

  const edit = (patch: Partial<typeof draft>) => {
    setError(null);
    setDraft(patch);
  };

  const submit = async () => {
    if (nameProblem !== null) {
      return;
    }
    if (needsRate) {
      onSetRate(draft.currency);
      return;
    }
    if (!draft.name.trim()) {
      setError('Give the account a name.');
      return;
    }
    if (!amountOk) {
      setError('Enter what is in the account now, or leave it empty for zero.');
      return;
    }

    setIsSaving(true);
    setError(null);
    try {
      const account = await addAccount({
        name: draft.name,
        type: draft.type,
        currency: draft.currency,
        openingAmount: numericAmount,
        smsSender: draft.smsSender,
        lastDigits: draft.lastDigits,
      });
      resetDraft();
      onCreated(account);
    } catch (reason) {
      if (reason instanceof AccountsError) {
        setError(reason.message);
      } else {
        throw reason;
      }
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <View style={styles.form}>
      <View>
        <AppText style={[styles.label, { color: colors.textMuted }]}>Type</AppText>
        <SegmentedControl options={TYPE_OPTIONS} value={draft.type} onChange={(type) => edit({ type })} />
      </View>

      <View>
        <AppText style={[styles.label, { color: colors.textMuted }]}>Name</AppText>
        <View style={styles.picks}>
          {picks.map((pick) => {
            const selected = pick.name === '' ? draft.name.trim() !== '' && !matchesPick : pick.name === draft.name;
            return (
              <Pressable
                key={pick.label}
                onPress={() => edit(pick.sender !== undefined ? { name: pick.name, smsSender: pick.sender } : { name: pick.name })}
                accessibilityRole="button"
                accessibilityState={{ selected }}
                accessibilityLabel={pick.name === '' ? 'Other, type your own name' : pick.label}
                style={({ pressed }) => [
                  styles.pick,
                  { backgroundColor: selected ? tokens.disc : colors.surface, borderColor: selected ? tokens.glyph : colors.border },
                  selected && styles.pickSelected,
                  pressed && styles.pressed,
                ]}
              >
                <AppText style={[styles.pickText, { color: colors.text, fontWeight: selected ? '700' : '600' }]} maxFontSizeMultiplier={1.3}>
                  {pick.label}
                </AppText>
              </Pressable>
            );
          })}
        </View>
        <FormInput
          value={draft.name}
          onChangeText={(name) => edit({ name })}
          placeholder="Account name"
          autoCapitalize="words"
          accessibilityLabel="Account name"
          invalid={nameProblem !== null || (error !== null && !draft.name.trim())}
        />
        {nameProblem !== null ? <InlineError message={nameProblem} /> : null}
      </View>

      <View>
        <AppText style={[styles.label, { color: colors.textMuted }]}>What&apos;s in it right now?</AppText>
        <FormInput
          style={styles.amountInput}
          value={draft.fromMessages ? '' : draft.amount}
          editable={!draft.fromMessages}
          onChangeText={(amount) => edit({ amount })}
          placeholder="0.00"
          keyboardType="decimal-pad"
          maxFontSizeMultiplier={1.3}
          accessibilityLabel="What is in the account right now"
          invalid={error !== null && !amountOk}
        />
        {draft.currency === 'ETB' ? (
          <View style={styles.switchRow}>
            <AppText style={[styles.helper, styles.switchLabel, { color: colors.text }]}>Get it from my messages</AppText>
            <Switch
              value={draft.fromMessages}
              onValueChange={(fromMessages) => edit({ fromMessages })}
              trackColor={{ true: colors.primary, false: colors.border }}
              accessibilityLabel="Get the starting amount from my messages"
            />
          </View>
        ) : null}
        {draft.fromMessages && draft.currency === 'ETB' ? (
          <AppText style={[styles.helper, { color: colors.textMuted }]}>
            The account starts with no opening balance. When you import its messages, Talari offers the balance just before the oldest one, and you confirm it.
          </AppText>
        ) : null}
        <AppText style={[styles.label, styles.currencyLabel, { color: colors.textMuted }]}>Currency</AppText>
        <CurrencyChips value={draft.currency} onChange={(currency) => edit({ currency })} />
        <AppText style={[styles.helper, { color: colors.textMuted }]}>
          Talari starts from this number and tracks every change after it. Check your bank app for the exact balance.
        </AppText>
        {draft.currency !== 'ETB' && rate !== null && amountOk && numericAmount > 0 ? (
          <AppText style={[styles.helper, { color: colors.textMuted }]}>
            At today&apos;s rate (1 {draft.currency} = ETB {formatNumber(rate)}) that is about ETB {formatNumber(numericAmount * rate)}.
          </AppText>
        ) : null}
      </View>

      <View>
        <AppText style={[styles.label, { color: colors.textMuted }]}>Bank messages (optional)</AppText>
        <FormInput
          value={draft.smsSender}
          onChangeText={(smsSender) => edit({ smsSender })}
          placeholder="Messages come from, e.g. 127 or CBE"
          autoCapitalize="none"
          maxLength={MAX_SMS_SENDER_LENGTH}
          accessibilityLabel="SMS sender, optional"
        />
        <FormInput
          style={styles.digitsInput}
          value={draft.lastDigits}
          onChangeText={(lastDigits) => edit({ lastDigits: lastDigits.replace(/\D/g, '').slice(0, 4) })}
          placeholder="Last digits of the account"
          keyboardType="number-pad"
          maxLength={4}
          accessibilityLabel="Last digits of the account, optional"
        />
        <AppText style={[styles.helper, { color: colors.textMuted }]}>
          Used only to match messages you paste to this account. Nothing is read from your phone.
        </AppText>
      </View>

      {needsRate ? (
        <View style={[styles.notice, { backgroundColor: colors.surfaceMuted, borderColor: colors.border }]} accessibilityLiveRegion="polite">
          <Ionicons name="information-circle-outline" size={20} color={colors.textMuted} />
          <AppText style={[styles.noticeText, { color: colors.text }]}>
            {draft.currency} has no exchange rate yet. Set it first, then come back: what you have filled in here is kept.
          </AppText>
        </View>
      ) : null}

      {error !== null ? <InlineError message={error} /> : null}

      <Button
        title={needsRate ? `Set the ${draft.currency} rate first` : submitLabel}
        variant="primary"
        disabled={isSaving || nameProblem !== null}
        onPress={() => void submit()}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  form: {
    gap: 14,
  },
  label: {
    fontSize: 12,
    fontWeight: '600',
    marginBottom: 6,
  },
  picks: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 8,
  },
  pick: {
    minHeight: 36,
    paddingHorizontal: 12,
    justifyContent: 'center',
    borderRadius: 999,
    borderWidth: 1,
  },
  pickSelected: {
    borderWidth: 1.5,
  },
  pickText: {
    fontSize: 13,
  },
  currencyLabel: {
    marginTop: 12,
  },
  digitsInput: {
    marginTop: 8,
  },
  amountInput: {
    fontSize: 18,
    fontWeight: '600',
    fontVariant: ['tabular-nums'],
  },
  switchRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginTop: 8 },
  switchLabel: { flex: 1, marginTop: 0 },
  helper: {
    fontSize: 12,
    lineHeight: 17,
    marginTop: 8,
  },
  notice: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    borderWidth: 1,
    borderRadius: 14,
    padding: 12,
  },
  noticeText: {
    flex: 1,
    minWidth: 0,
    fontSize: 13,
    lineHeight: 18,
  },
  pressed: {
    opacity: 0.7,
  },
});
