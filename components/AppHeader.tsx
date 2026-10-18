import { Pressable, StyleSheet, View } from 'react-native';
import { useRouter, useSegments } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';

import { typography } from '../constants/theme';
import { useThemeColors } from '../theme/ThemeProvider';
import { useUiStore } from '../store/ui';
import { balanceToggleLabel } from '../utils/balanceVisibility';
import AppText from './AppText';

interface AppHeaderProps {
  title: string;
  /** Home has no title: the menu button and the bell sit at the two ends. */
  hideTitle?: boolean;
  /** The Notifications screen itself has no bell. */
  hideBell?: boolean;
  /** An eye button beside the bell that shows or hides balances. It is the same switch as Home's: one shared flag. */
  showBalanceToggle?: boolean;
}

// The one header of the app: menu (or back arrow) on the left, the title, and the bell with its unread badge on the right. The
// unread count comes from the store, so every screen shows the same badge without being handed it.
export default function AppHeader({ title, hideTitle = false, hideBell = false, showBalanceToggle = false }: AppHeaderProps) {
  const colors = useThemeColors();
  const openDrawer = useUiStore((state) => state.openDrawer);
  const notificationCount = useUiStore((state) => state.notifications.filter((notification) => !notification.isRead).length);
  const isBalanceHidden = useUiStore((state) => state.isBalanceHidden);
  const toggleBalanceVisibility = useUiStore((state) => state.toggleBalanceVisibility);
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const segments = useSegments();
  // Main sections (the tabs) get the menu; every screen pushed above them gets a visible back arrow.
  // iOS has no hardware Back, and this also gives Android a tappable option; hardware/gesture Back
  // still works as before.
  const isStackScreen = segments[0] !== '(tabs)';

  const goBack = () => {
    // After a cold start straight into a deep link there may be nothing to go back to.
    if (router.canGoBack()) {
      router.back();
    } else {
      router.replace('/');
    }
  };

  return (
    <View style={[styles.container, { paddingTop: insets.top + 8, backgroundColor: colors.bg }]}>
      {isStackScreen ? (
        <Pressable onPress={goBack} hitSlop={12} style={styles.menuButton} accessibilityRole="button" accessibilityLabel="Go back">
          <Ionicons name="chevron-back" size={26} color={colors.text} />
        </Pressable>
      ) : (
        <Pressable onPress={openDrawer} hitSlop={12} style={styles.menuButton} accessibilityRole="button" accessibilityLabel="Open menu">
          <Ionicons name="menu" size={26} color={colors.text} />
        </Pressable>
      )}
      {hideTitle ? <View style={styles.titleSpace} /> : <AppText style={[styles.title, { color: colors.text }]}>{title}</AppText>}
      <View style={styles.rightArea}>
        {showBalanceToggle ? (
          <Pressable
            onPress={toggleBalanceVisibility}
            hitSlop={10}
            accessibilityRole="button"
            accessibilityLabel={balanceToggleLabel(isBalanceHidden)}
            style={({ pressed }) => (pressed ? { opacity: 0.6 } : null)}
          >
            <Ionicons name={isBalanceHidden ? 'eye-off-outline' : 'eye-outline'} size={22} color={colors.text} />
          </Pressable>
        ) : null}
        {!hideBell ? (
          <Pressable
            onPress={() => router.push('/notifications')}
            hitSlop={10}
            style={styles.notificationButton}
            accessibilityRole="button"
            accessibilityLabel={notificationCount > 0 ? `Notifications, ${notificationCount} unread` : 'Notifications'}
          >
            <Ionicons name="notifications-outline" size={22} color={colors.text} />
            {notificationCount > 0 && (
              <View style={[styles.badge, { backgroundColor: colors.danger, borderColor: colors.bg }]} testID="notification-badge">
                <AppText style={[styles.badgeText, { color: colors.onDanger }]} maxFontSizeMultiplier={1}>
                  {notificationCount > 9 ? '9+' : notificationCount}
                </AppText>
              </View>
            )}
          </Pressable>
        ) : (
          <View style={styles.spacer} />
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingBottom: 12,
    gap: 12,
  },
  menuButton: {
    padding: 4,
  },
  title: {
    ...typography.sectionTitle,
    fontWeight: '700',
    flex: 1,
  },
  rightArea: {
    minWidth: 28,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: 16,
  },
  notificationButton: {
    position: 'relative',
  },
  // Red count badge on the bell's top-right corner; the background-coloured ring keeps it legible over the icon.
  badge: {
    position: 'absolute',
    top: -6,
    right: -8,
    minWidth: 16,
    height: 16,
    paddingHorizontal: 3,
    borderRadius: 8,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeText: {
    fontSize: 10,
    lineHeight: 12,
    fontWeight: '800',
  },
  spacer: {
    width: 26,
  },
  titleSpace: {
    flex: 1,
  },
});
