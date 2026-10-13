import { ReactNode } from 'react';
import { KeyboardAvoidingView, Pressable, ScrollView, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { spacing } from '../constants/theme';
import { useThemeColors } from '../theme/ThemeProvider';
import OverlayModal from './OverlayModal';

interface SheetModalProps {
  visible: boolean;
  onClose: () => void;
  children: ReactNode;
}

// Bottom sheet that rises above the keyboard (a plain Modal is not resized by the soft keyboard, which
// would hide the confirm button while typing) and clears the system navigation bar. Android Back and a
// tap on the backdrop both close it. Fill, edge and dim all come from the theme tokens.
export default function SheetModal({ visible, onClose, children }: SheetModalProps) {
  const insets = useSafeAreaInsets();
  const colors = useThemeColors();

  return (
    <OverlayModal visible={visible} animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView style={styles.flex} behavior="padding">
        <Pressable style={[styles.backdrop, { backgroundColor: colors.scrim }]} onPress={onClose}>
          <Pressable
            testID="sheet"
            style={[
              styles.sheet,
              { paddingBottom: spacing.xl + insets.bottom, backgroundColor: colors.surface, borderColor: colors.border },
            ]}
            onPress={(event) => event.stopPropagation()}
          >
            {/* Scrollable, so the last button can always be reached with the keyboard open, on a short screen or at a large font. */}
            <ScrollView
              style={styles.scroll}
              contentContainerStyle={styles.scrollContent}
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={false}
            >
              {children}
            </ScrollView>
          </Pressable>
        </Pressable>
      </KeyboardAvoidingView>
    </OverlayModal>
  );
}

const styles = StyleSheet.create({
  flex: {
    flex: 1,
  },
  backdrop: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  sheet: {
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    borderTopWidth: 1,
    borderLeftWidth: 1,
    borderRightWidth: 1,
    padding: spacing.xl,
    maxHeight: '90%',
  },
  scroll: {
    flexGrow: 0,
  },
  scrollContent: {
    gap: spacing.md,
  },
});
