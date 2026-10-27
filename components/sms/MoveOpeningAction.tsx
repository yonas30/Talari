import { useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { useAccountsState } from '../../store/finance';
import { useSmsStore } from '../../store/sms';
import { useUiStore } from '../../store/ui';
import { defaultCtx } from '../../utils/accounts/context';
import { maskAmount } from '../../utils/format';
import { proposeFromMessages } from '../../utils/sms/opening';
import InlineError from '../InlineError';
import Button from '../Button';
import OpeningPreview from '../accounts/OpeningPreview';

interface MoveOpeningActionProps {
  accountId: string;
}

// Under a card blocked by "dated before the account's opening balance" (V2_SPEC Part Z): what to do next. Either a button that opens the same
// before-and-after preview as "Get it from my messages", or, when that is refused, the reason, right on the card.
export default function MoveOpeningAction({ accountId }: MoveOpeningActionProps) {
  const state = useAccountsState();
  const suggestions = useSmsStore((store) => store.suggestions);
  const openingOptions = useSmsStore((store) => store.openingOptions);
  const isBalanceHidden = useUiStore((store) => store.isBalanceHidden);
  const [preview, setPreview] = useState<ReturnType<typeof proposeFromMessages> | null>(null);

  const proposal = useMemo(
    () => proposeFromMessages(state, suggestions, accountId, { ...openingOptions((text) => maskAmount(text, isBalanceHidden)), ctx: defaultCtx }, true),
    [state, suggestions, accountId, openingOptions, isBalanceHidden],
  );

  if (proposal.kind === 'refused') {
    return <InlineError message={proposal.message} />;
  }
  if (proposal.kind !== 'offer') {
    return null;
  }
  return (
    <View style={styles.box}>
      <Button title="Move the opening back" variant="secondary" onPress={() => setPreview(proposal)} accessibilityHint="Shows before and after. Nothing changes until you confirm." />
      <OpeningPreview offer={preview !== null && preview.kind === 'offer' ? preview : null} onClose={() => setPreview(null)} />
    </View>
  );
}

const styles = StyleSheet.create({
  box: { gap: 6 },
});
