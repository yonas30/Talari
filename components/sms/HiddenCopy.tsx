import { useEffect, useMemo, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import * as Clipboard from 'expo-clipboard';

import { useTheme } from '../../theme/ThemeProvider';
import { HIDDEN_COPY_NOTE, hideMessageText } from '../../utils/sms/hideText';
import AppText from '../AppText';
import Button from '../Button';

interface HiddenCopyProps {
  // The message as pasted. Only its hidden version is ever shown here or copied.
  text: string;
}

// "Copy hidden version" (V2_SPEC Part Z, Phase 6D-2): shows exactly what will be copied, says plainly that the hiding is best effort and must be
// checked, and copies it. Never describes the copy as anonymous.
export default function HiddenCopy({ text }: HiddenCopyProps) {
  const { colors } = useTheme();
  const hidden = useMemo(() => hideMessageText(text), [text]);
  const [copied, setCopied] = useState(false);
  const [failed, setFailed] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (timer.current !== null) clearTimeout(timer.current);
    },
    [],
  );

  const copy = async () => {
    setFailed(false);
    try {
      await Clipboard.setStringAsync(hidden);
      setCopied(true);
      if (timer.current !== null) clearTimeout(timer.current);
      timer.current = setTimeout(() => setCopied(false), 3000);
    } catch {
      setCopied(false);
      setFailed(true);
    }
  };

  return (
    <View style={styles.box}>
      <AppText style={[styles.label, { color: colors.textMuted }]}>Hidden version</AppText>
      <View style={[styles.text, { borderColor: colors.border, backgroundColor: colors.bg }]}>
        <AppText selectable style={[styles.hidden, { color: colors.text }]}>
          {hidden}
        </AppText>
      </View>
      <AppText style={[styles.note, { color: colors.textMuted }]}>{HIDDEN_COPY_NOTE}</AppText>
      <Button
        title={copied ? 'Copied' : 'Copy hidden version'}
        variant="secondary"
        icon={copied ? 'checkmark-outline' : 'copy-outline'}
        onPress={() => void copy()}
        accessibilityHint="Copies the hidden version above. It is hidden as far as possible, not guaranteed. Check it before you share it."
      />
      {failed ? <AppText style={[styles.note, { color: colors.expense }]}>Could not copy. Long-press the hidden text above to copy it.</AppText> : null}
      {copied ? (
        <AppText style={styles.live} accessibilityLiveRegion="polite">
          Copied
        </AppText>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  box: { gap: 6 },
  label: { fontSize: 12, fontWeight: '600' },
  text: { borderWidth: 1, borderRadius: 10, padding: 10 },
  hidden: { fontSize: 13, lineHeight: 19 },
  note: { fontSize: 12, lineHeight: 17 },
  // Read out by a screen reader; the button already says "Copied".
  live: { height: 0, width: 0, opacity: 0 },
});
