import { Tabs } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { StyleSheet, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { colors } from '../../constants/theme';
import { getTabBarMetrics, TAB_LABEL_FONT_SIZE, TAB_LABEL_MAX_SCALE } from '../../utils/layout';
import AppText from '../../components/AppText';

export default function TabsLayout() {
  // The app draws edge-to-edge on Android, so the bar must add the system navigation inset itself or
  // its buttons sit under the gesture area / 3-button bar.
  const insets = useSafeAreaInsets();
  // The bar's height is a fixed number to react-navigation, so it has to be computed from the font scale or the
  // label overflows into the navigation-bar area at large system font sizes (see utils/layout.ts).
  const { fontScale } = useWindowDimensions();
  const bar = getTabBarMetrics(fontScale, insets.bottom);

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
              <View style={styles.addButton}>
                <Ionicons name="add" size={30} color="#FFFFFF" />
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

          return <Ionicons name={iconName as keyof typeof Ionicons.glyphMap} size={size} color={color} />;
        },
        tabBarActiveTintColor: colors.navy,
        tabBarInactiveTintColor: colors.textSecondary,
        // Same cap the bar height is computed with.
        tabBarLabel: ({ color, children }) => (
          <AppText maxFontSizeMultiplier={TAB_LABEL_MAX_SCALE} numberOfLines={1} style={{ fontSize: TAB_LABEL_FONT_SIZE, color }}>
            {children}
          </AppText>
        ),
        tabBarIconStyle: { marginTop: 2 },
        tabBarStyle: {
          height: bar.height,
          paddingBottom: bar.paddingBottom,
          paddingTop: bar.paddingTop,
        },
      })}
    >
      <Tabs.Screen name="index" options={{ title: 'Home' }} />
      <Tabs.Screen name="transactions" options={{ title: 'Transactions' }} />
      <Tabs.Screen name="add" options={{ title: '', tabBarLabel: () => null }} />
      <Tabs.Screen name="reports" options={{ title: 'Insights' }} />
      <Tabs.Screen name="goals" options={{ title: 'Goals' }} />
    </Tabs>
  );
}

const styles = StyleSheet.create({
  addButton: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: colors.orange,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: -20,
    shadowColor: colors.orange,
    shadowOpacity: 0.35,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
    elevation: 4,
  },
});
