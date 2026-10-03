import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { colors, typography } from '../constants/theme';
import { useUiStore } from '../store/ui';

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

  const onNavigate = (route: string) => {
    closeDrawer();
    // navigate() reuses the screen if it is already on the stack instead of stacking a duplicate.
    router.navigate(route as never);
  };

  return (
    <Modal visible={isOpen} animationType="fade" transparent onRequestClose={closeDrawer}>
      <Pressable style={styles.backdrop} onPress={closeDrawer}>
        <Pressable style={styles.drawer} onPress={(event) => event.stopPropagation()}>
          <ScrollView contentContainerStyle={[styles.content, { paddingTop: insets.top + 24, paddingBottom: insets.bottom + 16 }]}>
            <Text style={styles.title}>More</Text>
            {links.map((link) => (
              <Pressable key={link.route} style={styles.linkRow} onPress={() => onNavigate(link.route)}>
                <Ionicons name={link.icon} size={22} color={colors.navy} />
                <Text style={styles.linkLabel}>{link.label}</Text>
              </Pressable>
            ))}
          </ScrollView>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(23, 32, 51, 0.4)',
    flexDirection: 'row',
  },
  drawer: {
    width: '78%',
    maxWidth: 320,
    height: '100%',
    backgroundColor: colors.surface,
  },
  content: {
    paddingHorizontal: 20,
    gap: 4,
  },
  title: {
    ...typography.pageTitle,
    fontSize: 22,
    color: colors.navy,
    marginBottom: 12,
  },
  linkRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: colors.background,
  },
  linkLabel: {
    flex: 1,
    ...typography.body,
    color: colors.navy,
    fontWeight: '600',
  },
});
