import { Redirect, Tabs } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { StyleSheet, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useFinanceStore } from '../../store/finance';
import { useTheme } from '../../theme/ThemeProvider';
import { getTabBarMetrics, TAB_LABEL_FONT_SIZE, TAB_LABEL_MAX_SCALE } from '../../utils/layout';
import AppText from '../../components/AppText';

export default function TabsLayout() {
  // The app draws edge-to-edge on Android, so the bar must add the system navigation inset itself or
  // its buttons sit under the gesture area / 3-button bar.
  const insets = useSafeAreaInsets();
  const { colors, scheme } = useTheme();
  // The bar's height is a fixed number to react-navigation, so it has to be computed from the font scale or the
  // label overflows into the navigation-bar area at large system font sizes (see utils/layout.ts).
  const { fontScale } = useWindowDimensions();
  const bar = getTabBarMetrics(fontScale, insets.bottom);
  const isReady = useFinanceStore((state) => state.isReady);
  const hasAccounts = useFinanceStore((state) => state.accounts.some((account) => !account.archived));

  // Nothing can be recorded without an account, so until one exists every tab sends the owner to "Add your first account" (and nobody
  // is left on an empty Home).
  if (isReady && !hasAccounts) {
    return <Redirect href="/first-account" />;
  }

  return (
    <Tabs
      // Android Back returns to the tab you came from (then exits the app from the first one). The
      // default, 'firstRoute', jumps straight to Home from any tab.
      backBehavior="history"
      screenOptions={({ route }) => ({
        headerShown: false,
        tabBarIcon: ({ focused, color, size }) => {
          if (route.name === 'add') {
            return (
              // Brand orange with a NAVY plus (white on orange fails contrast). It is one plain circle: no shadow and no elevation (on
              // Android both drew a rectangular box below the button in Light). Light: a 1 px border token. Dark: a thin ring in the
              // background colour separates the button from the content behind it.
              <View
                style={[
                  styles.addButton,
                  { backgroundColor: colors.primary },
                  scheme === 'light' ? { borderWidth: 1, borderColor: colors.border } : { borderWidth: 3, borderColor: colors.bg },
                ]}
              >
                <Ionicons name="add" size={34} color={colors.onPrimary} />
              </View>
            );
          }

          const iconName =
            route.name === 'index'
              ? focused
                ? 'home'
                : 'home-outline'
              : route.name === 'transactions'
                ? focused
                  ? 'list'
                  : 'list-outline'
                : route.name === 'reports'
                  ? focused
                    ? 'bar-chart'
                    : 'bar-chart-outline'
                  : focused
                    ? 'flag'
                    : 'flag-outline';

          // The active icon is the vivid brand orange (it is a graphic, and it is also filled, so it never relies on colour alone);
          // the label next to it uses the text-safe orange.
          return <Ionicons name={iconName as keyof typeof Ionicons.glyphMap} size={size} color={focused ? colors.primary : color} />;
        },
        // Active = the text-safe orange (primaryText: darker in Light), plus a filled icon and a semi-bold label, so the active tab
        // never depends on colour alone. Inactive = muted text.
        tabBarActiveTintColor: colors.primaryText,
        tabBarInactiveTintColor: colors.textMuted,
        // Same cap the bar height is computed with.
        tabBarLabel: ({ color, children, focused }) => (
          // Inter is about 7% wider than the old system font: "Transactions" is 67 dp at 11 sp but a tab is only 64-82 dp wide
          // (and 88 dp at the 1.3x cap), so the label may shrink a little instead of being cut off with an ellipsis.
          <AppText
            maxFontSizeMultiplier={TAB_LABEL_MAX_SCALE}
            numberOfLines={1}
            adjustsFontSizeToFit
            minimumFontScale={0.8}
            style={{ fontSize: TAB_LABEL_FONT_SIZE, color, fontWeight: focused ? '600' : '400' }}
          >
            {children}
          </AppText>
        ),
        tabBarIconStyle: { marginTop: 2 },
        tabBarStyle: {
          backgroundColor: colors.surface,
          borderTopColor: colors.border,
          borderTopWidth: StyleSheet.hairlineWidth,
          height: bar.height,
          paddingBottom: bar.paddingBottom,
          paddingTop: bar.paddingTop,
        },
      })}
    >
      <Tabs.Screen name="index" options={{ title: 'Home' }} />
      <Tabs.Screen name="transactions" options={{ title: 'Transactions' }} />
      <Tabs.Screen name="add" options={{ title: '', tabBarLabel: () => null, tabBarAccessibilityLabel: 'Add transaction' }} />
      <Tabs.Screen name="reports" options={{ title: 'Insights' }} />
      <Tabs.Screen name="goals" options={{ title: 'Goals' }} />
    </Tabs>
  );
}

const styles = StyleSheet.create({
  addButton: {
    width: 60,
    height: 60,
    borderRadius: 30,
    alignItems: 'center',
    justifyContent: 'center',
    // Raised above the bar. Screens leave bottom padding for the part that sticks out.
    marginTop: -24,
  },
});
