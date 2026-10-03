import { Tabs } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';

import AuthGate from '../components/AuthGate';
import SideDrawer from '../components/SideDrawer';
import { colors } from '../constants/theme';
import { useFinanceStore } from '../store/finance';

export default function RootLayout() {
  const loadData = useFinanceStore((state) => state.loadData);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  return (
    <AuthGate>
    <Tabs
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

          return <Ionicons name={iconName as any} size={size} color={color} />;
        },
        tabBarActiveTintColor: colors.navy,
        tabBarInactiveTintColor: colors.textSecondary,
        tabBarLabelStyle: { fontSize: 11 },
        tabBarIconStyle: { marginTop: 2 },
        tabBarStyle: { height: 64, paddingBottom: 8, paddingTop: 6 },
      })}
    >
      <Tabs.Screen name="index" options={{ title: 'Home' }} />
      <Tabs.Screen name="transactions" options={{ title: 'Transactions' }} />
      <Tabs.Screen name="add" options={{ title: '', tabBarLabel: () => null }} />
      <Tabs.Screen name="reports" options={{ title: 'Insights' }} />
      <Tabs.Screen name="goals" options={{ title: 'Goals' }} />
      <Tabs.Screen name="budgets" options={{ href: null }} />
      <Tabs.Screen name="backup" options={{ href: null }} />
      <Tabs.Screen name="notifications" options={{ href: null }} />
      <Tabs.Screen name="export-data" options={{ href: null }} />
      <Tabs.Screen name="recurring" options={{ href: null }} />
      <Tabs.Screen name="journey" options={{ href: null }} />
      <Tabs.Screen name="categories" options={{ href: null }} />
      <Tabs.Screen name="exchange-rates" options={{ href: null }} />
      <Tabs.Screen name="about" options={{ href: null }} />
      <Tabs.Screen name="edit-transaction/[id]" options={{ href: null }} />
      <Tabs.Screen name="origin" options={{ href: null }} />
    </Tabs>
    <SideDrawer />
    </AuthGate>
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
