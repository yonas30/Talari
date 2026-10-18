import { Pressable, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { useTheme } from '../../theme/ThemeProvider';
import { MoneyAccount } from '../../types/accounts';
import AppText from '../AppText';
import SheetModal from '../SheetModal';
import AccountForm from './AccountForm';

interface NewAccountSheetProps {
  visible: boolean;
  onClose: () => void;
  onCreated: (account: MoneyAccount) => void;
  onSetRate: (currency: string) => void;
}

// The "New account" bottom sheet around the shared form.
export default function NewAccountSheet({ visible, onClose, onCreated, onSetRate }: NewAccountSheetProps) {
  const { colors } = useTheme();

  return (
    <SheetModal visible={visible} onClose={onClose}>
      <View style={styles.header}>
        <AppText variant="title" style={styles.title} accessibilityRole="header">
          New account
        </AppText>
        <Pressable onPress={onClose} hitSlop={12} accessibilityRole="button" accessibilityLabel="Close">
          <Ionicons name="close" size={24} color={colors.textMuted} />
        </Pressable>
      </View>
      <AccountForm onCreated={onCreated} onSetRate={onSetRate} />
    </SheetModal>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  title: {
    fontSize: 20,
    flex: 1,
  },
});
