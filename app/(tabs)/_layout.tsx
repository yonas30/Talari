import { Tabs } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { colors } from '../../constants/theme';

const TAB_BAR_CONTENT_HEIGHT = 56;

export default function TabsLayout() {
  // The app draws edge-to-edge on Android, so the bar must add the system navigation inset itself or
  // its buttons sit under the gesture area / 3-button bar.
  const insets = useSafeAreaInsets();

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
        tabBarLabelStyle: { fontSize: 11 },
        tabBarIconStyle: { marginTop: 2 },
        tabBarStyle: {
          height: TAB_BAR_CONTENT_HEIGHT + insets.bottom,
          paddingBottom: insets.bottom + 6,
          paddingTop: 6,
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
