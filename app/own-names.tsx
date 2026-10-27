import { useState } from 'react';
import { Alert, ScrollView, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import AppHeader from '../components/AppHeader';
import AppText from '../components/AppText';
import Button from '../components/Button';
import Card from '../components/Card';
import FormInput from '../components/FormInput';
import InlineError from '../components/InlineError';
import SheetModal from '../components/SheetModal';
import { useSmsStore } from '../store/sms';
import { useTheme } from '../theme/ThemeProvider';
import { MAX_OWN_NAME_LENGTH, MAX_OWN_NAMES } from '../utils/sms/ownNames';

// "Your name as banks write it" (V2_SPEC Part Z, Phase 6D-3): the owner's names exactly as a bank prints them. Used only by pairing rule 3, to
// notice a movement between the owner's own accounts. Never guessed from the messages.
export default function OwnNamesScreen() {
  const { colors } = useTheme();
  const names = useSmsStore((store) => store.ownNames);
  const addOwnName = useSmsStore((store) => store.addOwnName);
  const renameOwnName = useSmsStore((store) => store.renameOwnName);
  const removeOwnName = useSmsStore((store) => store.removeOwnName);
  // null: closed. { id: null }: adding. { id }: editing that name.
  const [sheet, setSheet] = useState<{ id: string | null } | null>(null);
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);

  const open = (id: string | null) => {
    setText(id === null ? '' : (names.find((row) => row.id === id)?.name ?? ''));
    setError(null);
    setSheet({ id });
  };

  const save = () => {
    try {
      if (sheet?.id) renameOwnName(sheet.id, text);
      else addOwnName(text);
      setSheet(null);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not save this name.');
    }
  };

  const confirmRemove = (id: string, name: string) => {
    Alert.alert(`Remove ${name}?`, 'Transfers that were only found because of this name will no longer be offered. Nothing already saved changes.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Remove', style: 'destructive', onPress: () => removeOwnName(id) },
    ]);
  };

  return (
    <View style={[styles.screen, { backgroundColor: colors.bg }]}>
      <AppHeader title="Your name as banks write it" />
      <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
        <AppText style={[styles.text, { color: colors.textMuted }]}>
          Banks print your name in their own way, sometimes half hidden, like &quot;Hxxxxx Nxxxxx&quot;. Add each way you see it. When a message names you as the other
          person, and the same amount left one of your accounts and arrived in another that day, Talari offers it as one transfer. You always decide. Talari never
          guesses names from your messages, and these stay on this phone and in your backup file, which you should keep private.
        </AppText>

        {names.length === 0 ? (
          <Card style={styles.empty}>
            <Ionicons name="person-outline" size={32} color={colors.textMuted} />
            <AppText style={[styles.emptyText, { color: colors.textMuted }]}>No names yet. Transfers are still found by transaction number and by the bank named.</AppText>
          </Card>
        ) : (
          names.map((row) => (
            <Card key={row.id} style={styles.row}>
              <AppText style={[styles.name, { color: colors.text }]} numberOfLines={2}>
                {row.name}
              </AppText>
              <View style={styles.actions}>
                <Button title="Edit" variant="secondary" onPress={() => open(row.id)} accessibilityLabel={`Edit ${row.name}`} />
                <Button title="Remove" variant="secondary" onPress={() => confirmRemove(row.id, row.name)} accessibilityLabel={`Remove ${row.name}`} />
              </View>
            </Card>
          ))
        )}

        <Button title="Add a name" icon="add-outline" onPress={() => open(null)} disabled={names.length >= MAX_OWN_NAMES} />
        {names.length >= MAX_OWN_NAMES ? <AppText style={[styles.text, { color: colors.textMuted }]}>You can keep up to {MAX_OWN_NAMES} names.</AppText> : null}
      </ScrollView>

      <SheetModal visible={sheet !== null} onClose={() => setSheet(null)}>
        <AppText variant="title" style={styles.sheetTitle} accessibilityRole="header">
          {sheet?.id ? 'Edit name' : 'Add a name'}
        </AppText>
        <AppText style={[styles.text, { color: colors.textMuted }]}>
          Type it the way your bank prints it. Capital letters, spaces and a title such as Mr do not matter; the whole name has to match.
        </AppText>
        <FormInput
          value={text}
          onChangeText={(value) => {
            setError(null);
            setText(value);
          }}
          placeholder="Name as your bank writes it"
          autoCapitalize="words"
          maxLength={MAX_OWN_NAME_LENGTH}
          accessibilityLabel="Name as your bank writes it"
          invalid={error !== null}
        />
        {error !== null ? <InlineError message={error} /> : null}
        <Button title="Save name" onPress={save} />
      </SheetModal>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  container: { padding: 20, paddingBottom: 48, gap: 14 },
  text: { fontSize: 13, lineHeight: 19 },
  empty: { alignItems: 'center', gap: 10, padding: 24 },
  emptyText: { fontSize: 14, lineHeight: 20, textAlign: 'center' },
  row: { padding: 14, gap: 10 },
  name: { fontSize: 16, fontWeight: '600' },
  actions: { flexDirection: 'row', gap: 8 },
  sheetTitle: { fontSize: 18 },
});
