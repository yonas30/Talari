import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import AuthGate from '../components/AuthGate';
import SideDrawer from '../components/SideDrawer';
import { colors } from '../constants/theme';
import { useFinanceStore } from '../store/finance';
import { statusBarStyleForBackground } from '../utils/statusBar';

export default function RootLayout() {
  const loadData = useFinanceStore((state) => state.loadData);
  const insets = useSafeAreaInsets();

  useEffect(() => {
    void loadData();
  }, [loadData]);

  return (
    <>
      {/* Icons always visible: dark icons on the light app background, light icons if it ever turns dark. */}
      <StatusBar style={statusBarStyleForBackground(colors.background)} />
      <AuthGate>
      {/*
        The five main sections live in the (tabs) group. Every other screen is a real stack entry above
        it, so Android Back pops one level at a time (edit screen -> list, Settings -> Home, ...) instead
        of jumping to the first tab.
      */}
      <Stack
        screenOptions={{
          headerShown: false,
          // Stack screens have no tab bar, so keep their bottom content out of the gesture/nav bar area.
          contentStyle: { backgroundColor: colors.background, paddingBottom: insets.bottom },
        }}
      >
        {/* The tab bar already accounts for the bottom inset itself. */}
        <Stack.Screen name="(tabs)" options={{ contentStyle: { backgroundColor: colors.background } }} />
      </Stack>
        <SideDrawer />
      </AuthGate>
    </>
  );
}
