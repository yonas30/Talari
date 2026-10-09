import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import * as SystemUI from 'expo-system-ui';
import { useCallback, useEffect, useState } from 'react';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import AuthGate from '../components/AuthGate';
import SideDrawer from '../components/SideDrawer';
import SplashOverlay from '../components/SplashOverlay';
import WelcomeScreen from '../components/WelcomeScreen';
import { useAppFonts } from '../theme/fonts';
import { ThemeProvider, useTheme } from '../theme/ThemeProvider';
import { useFinanceStore } from '../store/finance';
import { useProfileStore } from '../store/profile';
import { useUiStore } from '../store/ui';
import { statusBarStyleForBackground } from '../utils/statusBar';

// Keep the native splash (plain orange) up until the in-app SplashOverlay has drawn its first frame. Called at module
// scope on purpose - inside a component it can run after the splash has already auto-hidden.
void SplashScreen.preventAutoHideAsync().catch(() => undefined);

const SPLASH_BACKGROUND = '#F47C20';

export default function RootLayout() {
  return (
    <ThemeProvider>
      <RootLayoutContent />
    </ThemeProvider>
  );
}

function RootLayoutContent() {
  const { colors, ready: themeReady } = useTheme();
  const loadData = useFinanceStore((state) => state.loadData);
  const isReady = useFinanceStore((state) => state.isReady);
  const onboardingResolved = useProfileStore((state) => state.resolved);
  const firstScreen = useProfileStore((state) => state.screen);
  const resolveOnboarding = useProfileStore((state) => state.resolve);
  const setSplashDone = useUiStore((state) => state.setSplashDone);
  const insets = useSafeAreaInsets();
  const [splashActive, setSplashActive] = useState(true);
  // The splash may only fade once we know whether the lock screen or the app comes next, and the automatic biometric
  // prompt waits for that fade so no system dialog appears over the animation.
  const [lockResolved, setLockResolved] = useState(false);
  const [splashFading, setSplashFading] = useState(false);
  const onLockResolved = useCallback(() => setLockResolved(true), []);
  const onSplashFadeStart = useCallback(() => setSplashFading(true), []);
  // Inter + Plus Jakarta Sans load while the animation plays. The splash holds on its full lockup until they are ready
  // (or 4 s have passed - see FONT_WAIT_LIMIT_MS - so a font problem can never trap the user on the splash).
  const fonts = useAppFonts();

  useEffect(() => {
    void loadData();
  }, [loadData]);

  // Welcome or app? Needs the ledger loaded (someone with data skips the full Welcome screen). It is decided here, while
  // the splash is still up, and the splash does not leave before it is known - Home can never flash before Welcome.
  useEffect(() => {
    if (!isReady || onboardingResolved) {
      return;
    }
    const { transactions, goals, origin } = useFinanceStore.getState();
    const hasOrigin = Boolean(origin && (origin.storyText.trim() || origin.startingPoint.trim() || origin.whyBuilding.trim()));
    void resolveOnboarding(transactions.length > 0 || goals.length > 0 || hasOrigin);
  }, [isReady, onboardingResolved, resolveOnboarding]);

  // app.json paints the root view orange so the first frame has no white edge. Once the splash is gone, the root view takes
  // the active scheme's background, so an overscroll or a slow screen never shows orange (or white in Dark).
  useEffect(() => {
    if (!splashActive) {
      void SystemUI.setBackgroundColorAsync(colors.bg).catch(() => undefined);
    }
  }, [splashActive, colors.bg]);

  return (
    <>
      {/* Icons always visible: dark icons on a light app background, light icons on a dark one. */}
      <StatusBar style={statusBarStyleForBackground(splashActive ? SPLASH_BACKGROUND : colors.bg)} />
      <AuthGate onLockResolved={onLockResolved} promptAllowed={!splashActive || splashFading}>
        {/*
          Order of events: splash, then the lock screen (AuthGate), then Welcome or the app. Welcome is rendered INSTEAD of the
          navigator (not as a route above it), so there is nothing to go back to: after Continue / Skip the navigator mounts
          with Home as its only entry, and Android Back leaves the app instead of returning to Welcome. Nothing is rendered
          before the decision is known (the splash waits for it), so Home can never flash before Welcome.
        */}
        {!onboardingResolved ? null : firstScreen === 'welcome' ? (
          <WelcomeScreen />
        ) : (
          <>
            {/*
              The five main sections live in the (tabs) group. Every other screen is a real stack entry above
              it, so Android Back pops one level at a time (edit screen -> list, Settings -> Home, ...) instead
              of jumping to the first tab.
            */}
            <Stack
              screenOptions={{
                headerShown: false,
                // Stack screens have no tab bar, so keep their bottom content out of the gesture/nav bar area.
                contentStyle: { backgroundColor: colors.bg, paddingBottom: insets.bottom },
              }}
            >
              {/* The tab bar already accounts for the bottom inset itself. */}
              <Stack.Screen name="(tabs)" options={{ contentStyle: { backgroundColor: colors.bg } }} />
            </Stack>
            <SideDrawer />
          </>
        )}
      </AuthGate>
      {splashActive && (
        <SplashOverlay
          // The saved theme is read before the splash leaves, so the first revealed frame already has the right scheme.
          ready={isReady && lockResolved && themeReady && fonts.ready && onboardingResolved}
          fontsLoaded={fonts.loaded}
          onFadeStart={onSplashFadeStart}
          onFinish={() => {
            setSplashActive(false);
            setSplashDone();
          }}
        />
      )}
    </>
  );
}
