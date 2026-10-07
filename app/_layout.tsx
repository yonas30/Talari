import { Inter_600SemiBold } from '@expo-google-fonts/inter/600SemiBold';
import { useFonts } from 'expo-font';
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useCallback, useEffect, useState } from 'react';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import AuthGate from '../components/AuthGate';
import SideDrawer from '../components/SideDrawer';
import SplashOverlay from '../components/SplashOverlay';
import { colors } from '../constants/theme';
import { useFinanceStore } from '../store/finance';
import { statusBarStyleForBackground } from '../utils/statusBar';

// Keep the native splash (plain orange) up until the in-app SplashOverlay has drawn its first frame. Called at module
// scope on purpose - inside a component it can run after the splash has already auto-hidden.
void SplashScreen.preventAutoHideAsync().catch(() => undefined);

const SPLASH_BACKGROUND = '#F47C20';

export default function RootLayout() {
  const loadData = useFinanceStore((state) => state.loadData);
  const isReady = useFinanceStore((state) => state.isReady);
  const insets = useSafeAreaInsets();
  const [splashActive, setSplashActive] = useState(true);
  // The splash may only fade once we know whether the lock screen or the app comes next, and the automatic biometric
  // prompt waits for that fade so no system dialog appears over the animation.
  const [lockResolved, setLockResolved] = useState(false);
  const [splashFading, setSplashFading] = useState(false);
  const onLockResolved = useCallback(() => setLockResolved(true), []);
  const onSplashFadeStart = useCallback(() => setSplashFading(true), []);
  // Inter is only used by the splash tagline; it loads while the animation plays.
  const [fontsLoaded] = useFonts({ Inter_600SemiBold });

  useEffect(() => {
    void loadData();
  }, [loadData]);

  return (
    <>
      {/* Icons always visible: dark icons on the light app background, light icons if it ever turns dark. */}
      <StatusBar style={statusBarStyleForBackground(splashActive ? SPLASH_BACKGROUND : colors.background)} />
      <AuthGate onLockResolved={onLockResolved} promptAllowed={!splashActive || splashFading}>
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
      {splashActive && (
        <SplashOverlay
          ready={isReady && lockResolved}
          fontsLoaded={fontsLoaded}
          onFadeStart={onSplashFadeStart}
          onFinish={() => setSplashActive(false)}
        />
      )}
    </>
  );
}
