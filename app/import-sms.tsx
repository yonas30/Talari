import { useMemo, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';

import AppHeader from '../components/AppHeader';
import AppText from '../components/AppText';
import Button from '../components/Button';
import Card from '../components/Card';
import DateField from '../components/DateField';
import FormInput from '../components/FormInput';
import InlineError from '../components/InlineError';
import HiddenCopy from '../components/sms/HiddenCopy';
import { useSmsStore } from '../store/sms';
import { useTheme } from '../theme/ThemeProvider';
import { todayKey } from '../utils/dates';
import { BatchPreview, previewBatch } from '../utils/sms/staging';
import { IgnoreReason } from '../utils/sms/types';

const IGNORED_LABELS: Record<IgnoreReason, string> = {
  empty: 'Empty',
  otp: 'Looks like a code',
  no_amount: 'No amount in it',
  airtime_received: 'Airtime received',
};

// Paste screen (V2_SPEC Part Z). The messages are read on this phone and never sent anywhere. "Check messages" shows what is in the
// paste without saving anything; "Add to review" saves the new ones as pending suggestions.
export default function ImportSmsScreen() {
  const { colors } = useTheme();
  const router = useRouter();
  const suggestions = useSmsStore((store) => store.suggestions);
  const addBatch = useSmsStore((store) => store.addBatch);
  const [text, setText] = useState('');
  const [preview, setPreview] = useState<BatchPreview | null>(null);
  const [batchDate, setBatchDate] = useState(todayKey());
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ignoredOpen, setIgnoredOpen] = useState(false);

  const waiting = useMemo(() => suggestions.filter((item) => item.status === 'pending').length, [suggestions]);

  const onChangeText = (value: string) => {
    setText(value);
    // The summary belongs to the text it was made from.
    setPreview(null);
    setNotice(null);
    setError(null);
    setIgnoredOpen(false);
  };

  const onPaste = async () => {
    setNotice(null);
    setError(null);
    try {
      // Empty means the clipboard is empty, or (iOS 16+) paste was refused; the two cannot be told apart.
      const pasted = await Clipboard.getStringAsync();
      if (pasted.trim() === '') {
        setNotice('Nothing to paste. Copy your messages first, or long-press the box and choose Paste.');
        return;
      }
      onChangeText(text.trim() === '' ? pasted : `${text.trimEnd()}\n\n${pasted}`);
    } catch {
      setNotice('Could not read the clipboard. Long-press the box and choose Paste instead.');
    }
  };

  const onCheck = () => {
    setError(null);
    setNotice(null);
    setPreview(previewBatch(text, useSmsStore.getState().knownHashes()));
  };

  const onAdd = () => {
    if (!preview) {
      return;
    }
    try {
      addBatch(preview, batchDate);
      router.replace('/sms-review');
    } catch {
      setError('Could not save these messages. Nothing was added; try again.');
    }
  };

  return (
    <View style={[styles.screen, { backgroundColor: colors.bg }]}>
      <AppHeader title="Import from SMS" />
      <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
        <View style={[styles.privacy, { backgroundColor: colors.surfaceMuted, borderColor: colors.border }]}>
          <Ionicons name="lock-closed-outline" size={18} color={colors.textMuted} />
          <AppText style={[styles.privacyText, { color: colors.text }]}>
            Messages are read on this phone only. Nothing is sent anywhere, and the text is not kept after you leave this screen.
          </AppText>
        </View>

        {waiting > 0 ? (
          <Button title={`${waiting} waiting for review`} variant="secondary" icon="list-outline" onPress={() => router.push('/sms-review')} />
        ) : null}

        <FormInput
          value={text}
          onChangeText={onChangeText}
          placeholder="Paste your messages here. You can paste several at once."
          multiline
          textAlignVertical="top"
          style={styles.box}
          autoCorrect={false}
          autoCapitalize="none"
          accessibilityLabel="Messages to import"
        />

        <View style={styles.row}>
          <Button title="Paste" variant="secondary" icon="clipboard-outline" onPress={() => void onPaste()} style={styles.rowButton} />
          <Button title="Clear" variant="secondary" disabled={text === ''} onPress={() => onChangeText('')} style={styles.rowButton} />
        </View>
        {notice !== null ? (
          <AppText style={[styles.notice, { color: colors.text }]} accessibilityLiveRegion="polite">
            {notice}
          </AppText>
        ) : null}

        <Button title="Check messages" onPress={onCheck} disabled={text.trim() === ''} />

        {text.trim() === '' && preview === null ? (
          <Card style={styles.empty}>
            <Ionicons name="chatbubble-ellipses-outline" size={32} color={colors.textMuted} />
            <AppText style={[styles.emptyText, { color: colors.textMuted }]}>
              Copy messages from Telebirr, CBE, Bank of Abyssinia or Awash Bank in your messages app, then tap Paste.
            </AppText>
          </Card>
        ) : null}

        {preview !== null ? (
          <Card style={styles.summary} accessibilityLiveRegion="polite">
            <AppText variant="title">Found in your paste</AppText>
            <SummaryRow label="New" value={preview.fresh.length} />
            <SummaryRow label="Already handled" value={preview.alreadyHandled} />
            <SummaryRow label="Not transactions" value={preview.ignored} hint="codes, promotions, airtime received" />
            <SummaryRow label="Couldn't read" value={preview.unreadable.length} />

            {preview.fresh.length === 0 && preview.unreadable.length === 0 && preview.alreadyHandled === 0 && preview.ignored === 0 ? (
              <AppText style={[styles.meta, { color: colors.textMuted }]}>Nothing in this paste looks like a message.</AppText>
            ) : null}
            {preview.fresh.length === 0 && (preview.alreadyHandled > 0 || preview.ignored > 0) ? (
              <AppText style={[styles.meta, { color: colors.textMuted }]}>Nothing new to review.</AppText>
            ) : null}

            {preview.needsDate && preview.fresh.length > 0 ? (
              <View style={styles.dateBlock}>
                <AppText style={[styles.meta, { color: colors.text }]}>
                  Some of these messages have no date. They will be dated with this day, and you can change each one in the review.
                </AppText>
                <DateField label="Date for messages without one" value={batchDate} onChange={setBatchDate} />
              </View>
            ) : null}

            {error !== null ? <InlineError message={error} /> : null}
            {preview.fresh.length > 0 ? <Button title={`Add ${preview.fresh.length} to review`} onPress={onAdd} /> : null}
          </Card>
        ) : null}

        {preview !== null && preview.unreadable.length > 0 ? (
          <Card style={styles.summary}>
            <AppText variant="title">Couldn&apos;t read these</AppText>
            <AppText style={[styles.meta, { color: colors.textMuted }]}>
              They are not saved. Add one yourself if it matters.
            </AppText>
            {preview.unreadable.map((item) => (
              <View key={item.rawHash} style={[styles.unreadable, { borderColor: colors.border, backgroundColor: colors.surfaceMuted }]}>
                <AppText selectable style={[styles.unreadableText, { color: colors.text }]}>
                  {item.text}
                </AppText>
                <Button title="Add manually" variant="secondary" icon="add-outline" onPress={() => router.push('/add')} accessibilityHint="Opens Add transaction so you can enter this one yourself" />
                <HiddenCopy text={item.text} />
              </View>
            ))}
          </Card>
        ) : null}

        {preview !== null && preview.ignoredItems.length > 0 ? (
          <Card style={styles.summary}>
            <Button
              title={`${ignoredOpen ? 'Hide' : 'Show'} the ${preview.ignoredItems.length} that are not transactions`}
              variant="secondary"
              icon={ignoredOpen ? 'chevron-up' : 'chevron-down'}
              onPress={() => setIgnoredOpen((value) => !value)}
              accessibilityState={{ expanded: ignoredOpen }}
            />
            {ignoredOpen ? (
              <>
                <AppText style={[styles.meta, { color: colors.textMuted }]}>
                  These are not saved. Only a hidden version is shown, because a message like this can hold a code.
                </AppText>
                {preview.ignoredItems.map((item, index) => (
                  <View key={`${index}-${item.reason}`} style={[styles.unreadable, { borderColor: colors.border, backgroundColor: colors.surfaceMuted }]}>
                    <AppText style={[styles.meta, { color: colors.text, fontWeight: '700' }]}>{IGNORED_LABELS[item.reason]}</AppText>
                    <HiddenCopy text={item.text} />
                  </View>
                ))}
              </>
            ) : null}
          </Card>
        ) : null}
      </ScrollView>
    </View>
  );
}

function SummaryRow({ label, value, hint }: { label: string; value: number; hint?: string }) {
  const { colors } = useTheme();
  return (
    <View style={styles.summaryRow} accessible accessibilityLabel={`${label}${hint ? `, ${hint}` : ''}: ${value}`}>
      <View style={styles.summaryLabelBox}>
        <AppText style={[styles.summaryLabel, { color: colors.text }]}>{label}</AppText>
        {hint ? <AppText style={[styles.summaryHint, { color: colors.textMuted }]}>{hint}</AppText> : null}
      </View>
      <AppText variant="number" style={[styles.summaryValue, { color: colors.text }]}>
        {value}
      </AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
  },
  container: {
    padding: 20,
    paddingBottom: 48,
    gap: 14,
  },
  privacy: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    borderWidth: 1,
    borderRadius: 12,
    padding: 12,
  },
  privacyText: {
    flex: 1,
    fontSize: 13,
    lineHeight: 18,
  },
  box: {
    minHeight: 200,
    maxHeight: 320,
    paddingTop: 12,
    fontSize: 14,
  },
  row: {
    flexDirection: 'row',
    gap: 10,
  },
  rowButton: {
    flex: 1,
  },
  notice: {
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '600',
  },
  empty: {
    alignItems: 'center',
    gap: 8,
    padding: 20,
  },
  emptyText: {
    fontSize: 14,
    lineHeight: 20,
    textAlign: 'center',
  },
  summary: {
    padding: 16,
    gap: 10,
  },
  summaryRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  summaryLabelBox: {
    flex: 1,
    minWidth: 0,
  },
  summaryLabel: {
    fontSize: 15,
  },
  summaryHint: {
    fontSize: 12,
    lineHeight: 16,
  },
  summaryValue: {
    fontSize: 16,
    fontWeight: '700',
  },
  meta: {
    fontSize: 13,
    lineHeight: 18,
  },
  dateBlock: {
    gap: 8,
  },
  unreadable: {
    borderWidth: 1,
    borderRadius: 10,
    padding: 10,
    gap: 10,
  },
  unreadableText: {
    fontSize: 13,
    lineHeight: 18,
  },
});
