import { ReactNode } from 'react';
import { KeyboardAvoidingView, Modal, Pressable, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { colors, radius, spacing } from '../constants/theme';

interface SheetModalProps {
  visible: boolean;
  onClose: () => void;
  children: ReactNode;
}

// Bottom sheet that rises above the keyboard (a plain Modal is not resized by the soft keyboard, which
// would hide the confirm button while typing) and clears the system navigation bar. Android Back and a
// tap on the backdrop both close it.
export default function SheetModal({ visible, onClose, children }: SheetModalProps) {
  const insets = useSafeAreaInsets();

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView style={styles.flex} behavior="padding">
        <Pressable style={styles.backdrop} onPress={onClose}>
          <Pressable
            style={[styles.sheet, { paddingBottom: spacing.xl + insets.bottom }]}
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
