import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { usePathname, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

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
  { label: 'Accounts', icon: 'albums-outline', route: '/accounts' },
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
  const pathname = usePathname();
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
            <AppText variant="heading" style={[styles.title, { color: colors.text }]} accessibilityRole="header">
              More
            </AppText>
            {links.map((link) => {
              // The screen you are on is marked with a bold label, a check and a tinted row - never by colour alone.
              const current = pathname === link.route;
              return (
                <Pressable
                  key={link.route}
                  style={({ pressed }) => [
                    styles.linkRow,
                    (current || pressed) && { backgroundColor: colors.surfaceMuted },
                  ]}
                  onPress={() => onNavigate(link.route)}
                  accessibilityRole="button"
                  accessibilityState={{ selected: current }}
                  accessibilityLabel={current ? `${link.label}, current screen` : link.label}
                >
                  <View style={[styles.disc, { backgroundColor: colors.accentDisc }]}>
                    <Ionicons name={link.icon} size={20} color={colors.primaryText} />
                  </View>
                  <AppText style={[styles.linkLabel, { color: colors.text, fontWeight: current ? '700' : '500' }]}>{link.label}</AppText>
                  {current ? <Ionicons name="checkmark-circle" size={20} color={colors.primaryText} /> : null}
                </Pressable>
              );
            })}
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
    paddingHorizontal: 12,
    gap: 4,
  },
  title: {
    fontSize: 22,
    lineHeight: 28,
    paddingHorizontal: 8,
    marginBottom: 12,
  },
  linkRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 10,
    paddingHorizontal: 8,
    borderRadius: 14,
  },
  disc: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  linkLabel: {
    flex: 1,
    minWidth: 0,
    fontSize: 15,
  },
});
