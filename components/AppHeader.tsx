import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useRouter, useSegments } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';

import { colors, typography } from '../constants/theme';
import { useUiStore } from '../store/ui';

interface AppHeaderProps {
  title: string;
  notificationCount?: number;
  onNotificationPress?: () => void;
}

export default function AppHeader({ title, notificationCount = 0, onNotificationPress }: AppHeaderProps) {
  const openDrawer = useUiStore((state) => state.openDrawer);
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
    <View style={[styles.container, { paddingTop: insets.top + 8 }]}>
      {isStackScreen ? (
        <Pressable onPress={goBack} hitSlop={12} style={styles.menuButton} accessibilityRole="button" accessibilityLabel="Go back">
          <Ionicons name="chevron-back" size={26} color={colors.navy} />
        </Pressable>
      ) : (
        <Pressable onPress={openDrawer} hitSlop={12} style={styles.menuButton} accessibilityRole="button" accessibilityLabel="Open menu">
          <Ionicons name="menu" size={26} color={colors.navy} />
        </Pressable>
      )}
      <Text style={styles.title}>{title}</Text>
      <View style={styles.rightArea}>
        {onNotificationPress ? (
          <Pressable onPress={onNotificationPress} hitSlop={10} style={styles.notificationButton}>
            <Ionicons name="notifications-outline" size={22} color={colors.navy} />
            {notificationCount > 0 && <View style={styles.badge} />}
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
    backgroundColor: colors.background,
    gap: 12,
  },
  menuButton: {
    padding: 4,
  },
  title: {
    ...typography.sectionTitle,
    color: colors.navy,
    fontWeight: '700',
    flex: 1,
  },
  rightArea: {
    width: 28,
    alignItems: 'center',
    justifyContent: 'center',
  },
  notificationButton: {
    position: 'relative',
  },
  badge: {
    position: 'absolute',
    top: -2,
    right: -2,
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.red,
  },
  spacer: {
    width: 26,
  },
});
