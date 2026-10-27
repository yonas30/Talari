import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { useTheme } from '../../theme/ThemeProvider';
import { OpeningOffer, OpeningRefusal } from '../../utils/sms/opening';
import AppText from '../AppText';
import Button from '../Button';
import OpeningPreview from './OpeningPreview';

interface OpeningCardProps {
  proposal: OpeningOffer | OpeningRefusal;
  accountName: string;
  // "Type it": opens the typed opening (on the account's own screen it is a sheet; on the review screen it opens the account).
  onType: () => void;
  // On the review screen the card brings its own side margins; on the account screen the page already has them.
  inset?: boolean;
}

const HEADLINES: Record<OpeningOffer['mode'], string> = {
  create: 'Opening balance',
  move: 'Move the opening back',
  replace: 'Opening balance',
};

// The quiet "Opening balance" card (V2_SPEC Part Z, Phase 6C-3): an account that has no opening entry but has messages, or messages older than
// its opening. An offer opens the before-and-after preview; a refusal says why it cannot be worked out and offers to type it instead.
// Nothing changes until the preview is confirmed.
export default function OpeningCard({ proposal, accountName, onType, inset = false }: OpeningCardProps) {
  const { colors } = useTheme();
  const [previewOf, setPreviewOf] = useState<OpeningOffer | null>(null);

  const offer = proposal.kind === 'offer' ? proposal : null;
  const text =
    offer === null
      ? (proposal as OpeningRefusal).message
      : offer.mode === 'create'
        ? `${accountName} has no opening balance yet. Your messages can give it: it is the balance just before your oldest message.`
        : offer.mode === 'move'
          ? `Some of your messages are older than ${accountName}'s opening balance. The opening balance can move back to just before the oldest one, and those messages are saved.`
          : `Your messages give a different opening balance for ${accountName}.`;

  return (
    <View
      style={[styles.card, inset ? styles.inset : null, { backgroundColor: colors.surfaceMuted, borderColor: colors.border }]}
      accessibilityLabel={`Opening balance of ${accountName}`}
    >
      <View style={styles.head}>
        <Ionicons name="flag-outline" size={18} color={colors.textMuted} />
        <AppText style={[styles.title, { color: colors.text }]}>{offer ? HEADLINES[offer.mode] : 'Opening balance'}</AppText>
      </View>
      <AppText style={[styles.text, { color: colors.textMuted }]}>{text}</AppText>
      <View style={styles.actions}>
        {offer !== null ? <Button title="Look at it" onPress={() => setPreviewOf(offer)} style={styles.action} accessibilityHint="Shows before and after. Nothing changes until you confirm." /> : null}
        <Button title="Type it" variant="secondary" onPress={onType} style={styles.action} />
      </View>
      <OpeningPreview offer={previewOf} onClose={() => setPreviewOf(null)} />
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderWidth: 1, borderRadius: 14, padding: 12, gap: 8 },
  inset: { marginHorizontal: 0 },
  head: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  title: { flex: 1, fontSize: 14, fontWeight: '700' },
  text: { fontSize: 12, lineHeight: 17 },
  actions: { flexDirection: 'row', gap: 8 },
  action: { flex: 1 },
});
