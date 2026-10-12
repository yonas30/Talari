import { Pressable, ScrollView, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { typography } from '../constants/theme';
import { useUiStore } from '../store/ui';
import { useThemeColors } from '../theme/ThemeProvider';
import AppText from './AppText';
import OverlayModal from './OverlayModal';

interface DrawerLink {
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
  route: string;
}

const links: DrawerLink[] = [
  { label: 'Budgets', icon: 'wallet-outline', route: '/budgets' },
  { label: 'Recurring', icon: 'repeat-outline', route: '/recurring' },
  { label: 'Exchange Rates', icon: 'swap-horizontal-outline', route: '/exchange-rates' },
  { label: 'Journey', icon: 'trending-up-outline', route: '/journey' },
  { label: 'Settings', icon: 'settings-outline', route: '/backup' },
  { label: 'About', icon: 'information-circle-outline', route: '/about' },
];

export default function SideDrawer() {
  const isOpen = useUiStore((state) => state.isDrawerOpen);
  const closeDrawer = useUiStore((state) => state.closeDrawer);
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const colors = useThemeColors();

  const onNavigate = (route: string) => {
    closeDrawer();
    // navigate() reuses the screen if it is already on the stack instead of stacking a duplicate.
    router.navigate(route as never);
  };

  return (
    <OverlayModal visible={isOpen} animationType="fade" onRequestClose={closeDrawer}>
      <Pressable style={[styles.backdrop, { backgroundColor: colors.scrim }]} onPress={closeDrawer}>
        <Pressable
          style={[styles.drawer, { backgroundColor: colors.surface, borderRightColor: colors.border }]}
          onPress={(event) => event.stopPropagation()}
        >
          <ScrollView contentContainerStyle={[styles.content, { paddingTop: insets.top + 24, paddingBottom: insets.bottom + 16 }]}>
            <AppText style={[styles.title, { color: colors.text }]}>More</AppText>
            {links.map((link) => (
              <Pressable
                key={link.route}
                style={({ pressed }) => [styles.linkRow, { borderBottomColor: colors.border }, pressed && { backgroundColor: colors.surfaceMuted }]}
                onPress={() => onNavigate(link.route)}
                accessibilityRole="button"
                accessibilityLabel={link.label}
              >
                <Ionicons name={link.icon} size={22} color={colors.text} />
                <AppText style={[styles.linkLabel, { color: colors.text }]}>{link.label}</AppText>
              </Pressable>
            ))}
          </ScrollView>
        </Pressable>
      </Pressable>
    </OverlayModal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    flexDirection: 'row',
  },
  drawer: {
    width: '78%',
    maxWidth: 320,
    height: '100%',
    borderRightWidth: 1,
  },
  content: {
    paddingHorizontal: 20,
    gap: 4,
  },
  title: {
    ...typography.pageTitle,
    fontSize: 22,
    marginBottom: 12,
  },
  linkRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  linkLabel: {
    flex: 1,
    ...typography.body,
    fontWeight: '600',
  },
});
