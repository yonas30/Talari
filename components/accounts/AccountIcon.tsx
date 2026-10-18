import { StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { useTheme } from '../../theme/ThemeProvider';
import { accountColors } from '../../theme/tokens';
import { AccountType } from '../../types/accounts';

const ICONS: Record<AccountType, keyof typeof Ionicons.glyphMap> = {
  cash: 'cash-outline',
  wallet: 'wallet-outline',
  bank: 'business-outline',
};

// The rounded icon tile of an account: the type's pale disc with its glyph on it (colours from the theme tokens, checked for contrast).
export default function AccountIcon({ type, size = 36 }: { type: AccountType; size?: number }) {
  const { colors } = useTheme();
  const tokens = accountColors(colors, type);
  return (
    <View style={[styles.tile, { width: size, height: size, borderRadius: Math.round(size / 3), backgroundColor: tokens.disc }]}>
      <Ionicons name={ICONS[type]} size={Math.round(size * 0.55)} color={tokens.glyph} />
    </View>
  );
}

const styles = StyleSheet.create({
  tile: {
    alignItems: 'center',
    justifyContent: 'center',
  },
});
