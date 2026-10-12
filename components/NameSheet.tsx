import { useState } from 'react';
import { AccessibilityInfo, StyleSheet, View } from 'react-native';

import { useThemeColors } from '../theme/ThemeProvider';
import { NAME_MAX_LENGTH, sanitiseName } from '../utils/profile';
import AppText from './AppText';
import AppTextInput from './AppTextInput';
import Button from './Button';
import SheetModal from './SheetModal';

interface NameSheetProps {
  visible: boolean;
  title: string;
  body?: string;
  /** Pre-filled text (the current name in Settings). */
  initialName?: string;
  saveLabel?: string;
  /** Shown under the field when Save is tapped with nothing typed. */
  emptyMessage: string;
  /** Secondary button, e.g. "Not now" or "Remove name". Omit for none. */
  secondaryLabel?: string;
  onSave: (name: string) => void;
  onSecondary?: () => void;
  /** Android Back or a tap on the backdrop. */
  onClose: () => void;
}

// The one name-entry sheet: used for the one-time "What should we call you?" over Home (existing data) and for the
// "Your name" row in Settings. Same sanitising and the same empty-input handling as the Welcome screen.
export default function NameSheet(props: NameSheetProps) {
  return (
    <NameSheetFrame visible={props.visible} onClose={props.onClose}>
      {/* A closed Modal renders nothing, so this form mounts fresh every time the sheet opens: current name, no old message. */}
      <NameForm {...props} />
    </NameSheetFrame>
  );
}

// The sheet itself follows the theme (fill and edge), so its title and text are readable in Dark.
function NameSheetFrame({ visible, onClose, children }: { visible: boolean; onClose: () => void; children: React.ReactNode }) {
  const colors = useThemeColors();
  return (
    <SheetModal visible={visible} onClose={onClose} surfaceColor={colors.surface} borderColor={colors.border}>
      {children}
    </SheetModal>
  );
}

function NameForm({
  title,
  body,
  initialName = '',
  saveLabel = 'Save',
  emptyMessage,
  secondaryLabel,
  onSave,
  onSecondary,
}: NameSheetProps) {
  const colors = useThemeColors();
  const [value, setValue] = useState(initialName);
  const [error, setError] = useState<string | null>(null);
  const [focused, setFocused] = useState(false);

  const save = () => {
    const clean = sanitiseName(value);
    if (clean === null) {
      setError(emptyMessage);
      AccessibilityInfo.announceForAccessibility(emptyMessage);
      return;
    }
    onSave(clean);
  };

  return (
    <>
      <AppText style={[styles.title, { color: colors.text }]} accessibilityRole="header">
        {title}
      </AppText>
      {body ? <AppText style={[styles.body, { color: colors.textMuted }]}>{body}</AppText> : null}
      <AppTextInput
        value={value}
        onChangeText={(text) => {
          setValue(text);
          if (error) {
            setError(null);
          }
        }}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        onSubmitEditing={save}
        placeholder="Your name"
        placeholderTextColor={colors.textMuted}
        cursorColor={colors.primary}
        selectionColor={colors.primary}
        autoCapitalize="words"
        autoCorrect={false}
        returnKeyType="done"
        maxLength={NAME_MAX_LENGTH}
        maxFontSizeMultiplier={1.3}
        accessibilityLabel="Your name"
        style={[
          styles.input,
          // Field fill is the screen colour (a step away from the sheet surface); the edge is the 3:1 inputBorder.
          { color: colors.text, backgroundColor: colors.bg, borderColor: focused ? colors.text : colors.inputBorder },
        ]}
      />
      {error ? (
        <AppText accessibilityRole="alert" accessibilityLiveRegion="polite" style={[styles.error, { color: colors.expense }]}>
          {error}
        </AppText>
      ) : null}
      <View style={styles.buttons}>
        <Button title={saveLabel} onPress={save} />
        {secondaryLabel && onSecondary ? <Button title={secondaryLabel} variant="secondary" onPress={onSecondary} /> : null}
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  title: {
    fontSize: 20,
    fontWeight: '700',
  },
  body: {
    fontSize: 15,
    lineHeight: 22,
  },
  input: {
    minHeight: 52,
    borderRadius: 14,
    borderWidth: 2,
    paddingHorizontal: 14,
    fontSize: 17,
    marginTop: 4,
  },
  error: {
    fontSize: 14,
  },
  buttons: {
    gap: 10,
    marginTop: 8,
  },
});
