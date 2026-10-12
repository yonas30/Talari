import { ReactNode } from 'react';
import { KeyboardAvoidingView, Modal, Pressable, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { colors, radius, spacing } from '../constants/theme';

interface SheetModalProps {
  visible: boolean;
  onClose: () => void;
  children: ReactNode;
  /** Sheet fill. Defaults to today's light surface, so sheets that do not pass it are unchanged. */
  surfaceColor?: string;
  /** Optional hairline along the top edge of the sheet (used by themed sheets, so a dark sheet reads against the dim). */
  borderColor?: string;
}

// Bottom sheet that rises above the keyboard (a plain Modal is not resized by the soft keyboard, which
// would hide the confirm button while typing) and clears the system navigation bar. Android Back and a
// tap on the backdrop both close it.
export default function SheetModal({ visible, onClose, children, surfaceColor, borderColor }: SheetModalProps) {
  const insets = useSafeAreaInsets();

  return (
    // statusBarTranslucent: the Modal's window also covers the strip behind the status bar. Without it that strip kept the
    // screen colour while the rest was dimmed, and the status-bar icons sat on an undimmed cream bar.
    <Modal visible={visible} transparent statusBarTranslucent animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView style={styles.flex} behavior="padding">
        <Pressable style={styles.backdrop} onPress={onClose}>
          <Pressable
            testID="sheet"
            style={[
              styles.sheet,
              { paddingBottom: spacing.xl + insets.bottom },
              surfaceColor ? { backgroundColor: surfaceColor } : null,
              borderColor ? { borderTopWidth: 1, borderLeftWidth: 1, borderRightWidth: 1, borderColor } : null,
            ]}
            onPress={(event) => event.stopPropagation()}
          >
            {children}
          </Pressable>
        </Pressable>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  flex: {
    flex: 1,
  },
  backdrop: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(23, 32, 51, 0.4)',
  },
  sheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: radius.card,
    borderTopRightRadius: radius.card,
    padding: spacing.xl,
    gap: spacing.md,
    maxHeight: '90%',
  },
});
