import { useEffect, useRef, useState } from 'react';
import {
  AccessibilityInfo,
  Keyboard,
  KeyboardAvoidingView,
  LayoutChangeEvent,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useProfileStore } from '../store/profile';
import { useUiStore } from '../store/ui';
import { useTheme } from '../theme/ThemeProvider';
import { EMPTY_NAME_MESSAGE, NAME_MAX_LENGTH, sanitiseName } from '../utils/profile';
import AppText from './AppText';
import AppTextInput from './AppTextInput';
import TalariSymbol from './TalariSymbol';

// Fresh install: shown once, full screen, instead of Home. Everything comes from the theme tokens.
export default function WelcomeScreen() {
  const { colors, scheme } = useTheme();
  const insets = useSafeAreaInsets();
  const completeWelcome = useProfileStore((state) => state.completeWelcome);
  const isSplashDone = useUiStore((state) => state.isSplashDone);

  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [focused, setFocused] = useState(false);
  const inputRef = useRef<TextInput>(null);
  const scrollRef = useRef<ScrollView>(null);
  // Top of the form block (label ... Skip) inside the scroll content, and whether the keyboard is up.
  const formTop = useRef(0);
  const keyboardUp = useRef(false);

  // Focus the field once the splash has left (a keyboard rising under the splash would be odd).
  useEffect(() => {
    if (isSplashDone) {
      inputRef.current?.focus();
    }
  }, [isSplashDone]);

  // With the keyboard open the visible area is small, so the heading is scrolled out of the way and the form block
  // (label, field, note, Continue AND Skip) is brought to the top. If the whole form is shorter than the visible area the
  // ScrollView simply clamps to its end, which shows all of it anyway. This runs when the keyboard appears AND when the
  // ScrollView is resized by it (the resize is what actually changes what fits), always to the same target, so it cannot
  // fight itself.
  const showForm = (animated: boolean) => {
    scrollRef.current?.scrollTo({ y: Math.max(0, formTop.current - 8), animated });
  };

  useEffect(() => {
    const shown = Keyboard.addListener('keyboardDidShow', () => {
      keyboardUp.current = true;
      showForm(true);
    });
    const hidden = Keyboard.addListener('keyboardDidHide', () => {
      keyboardUp.current = false;
    });
    return () => {
      shown.remove();
      hidden.remove();
    };
  }, []);

  const onScrollViewLayout = () => {
    if (keyboardUp.current) {
      showForm(false);
    }
  };

  const onFormLayout = (event: LayoutChangeEvent) => {
    formTop.current = event.nativeEvent.layout.y;
  };

  const submit = () => {
    const clean = sanitiseName(name);
    if (clean === null) {
      setError(EMPTY_NAME_MESSAGE);
      AccessibilityInfo.announceForAccessibility(EMPTY_NAME_MESSAGE);
      return;
    }
    Keyboard.dismiss();
    completeWelcome(clean);
  };

  const skip = () => {
    Keyboard.dismiss();
    completeWelcome(null);
  };

  // Navy in Light, orange in Dark (both pass 3:1 against the field - see scripts/verify-contrast.ts).
  const focusBorder = scheme === 'dark' ? colors.primary : colors.text;

  return (
    <KeyboardAvoidingView style={[styles.flex, { backgroundColor: colors.bg }]} behavior="padding">
      <ScrollView
        ref={scrollRef}
        onLayout={onScrollViewLayout}
        contentContainerStyle={styles.container}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
      >
        {/* Tapping anywhere that is not a control closes the keyboard. */}
        <Pressable
          accessible={false}
          onPress={Keyboard.dismiss}
          style={[styles.content, { paddingTop: insets.top + 32, paddingBottom: insets.bottom + 24 }]}
        >
          <TalariSymbol width={72} />

          <AppText variant="heading" style={styles.headline} accessibilityRole="header">
            Welcome to{' '}
            <AppText variant="heading" style={[styles.headline, { color: colors.welcomeAccent }]}>
              Talari
            </AppText>
          </AppText>

          <View style={styles.copy}>
            <AppText style={[styles.copyLine, { color: colors.textMuted }]}>Know where your money is.</AppText>
            <AppText style={[styles.copyLine, { color: colors.textMuted }]}>Control where it goes.</AppText>
            <AppText style={[styles.copyLine, { color: colors.textMuted }]}>Watch it grow.</AppText>
          </View>

          {/* Label, field, note, Continue and Skip form one block directly under the copy; it is what stays on screen. */}
          <View onLayout={onFormLayout} style={styles.form}>
            <AppText style={[styles.label, { color: colors.text }]}>What should we call you?</AppText>
            <AppTextInput
              ref={inputRef}
              value={name}
              onChangeText={(value) => {
                setName(value);
                if (error) {
                  setError(null);
                }
              }}
              onFocus={() => setFocused(true)}
              onBlur={() => setFocused(false)}
              onSubmitEditing={submit}
              placeholder="Your name"
              placeholderTextColor={colors.textMuted}
              cursorColor={colors.primary}
              selectionColor={colors.primary}
              autoCapitalize="words"
              autoCorrect={false}
              returnKeyType="done"
              maxLength={NAME_MAX_LENGTH}
              maxFontSizeMultiplier={1.3}
              accessibilityLabel="Your name"
              style={[
                styles.input,
                { color: colors.text, backgroundColor: colors.surface, borderColor: focused ? focusBorder : colors.inputBorder },
              ]}
            />
            {error ? (
              <AppText
                accessibilityRole="alert"
                accessibilityLiveRegion="polite"
                style={[styles.error, { color: colors.expense }]}
              >
                {error}
              </AppText>
            ) : null}

            <View style={styles.privacy}>
              <Ionicons name="lock-closed-outline" size={14} color={colors.textMuted} />
              <AppText style={[styles.privacyText, { color: colors.textMuted }]}>
                Stays on this phone. We use it for your greeting.
              </AppText>
            </View>

            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Continue"
              onPress={submit}
              style={({ pressed }) => [styles.continue, { backgroundColor: colors.primary }, pressed && styles.pressed]}
            >
              <AppText style={[styles.continueLabel, { color: colors.onPrimary }]} numberOfLines={1} maxFontSizeMultiplier={1.3}>
                Continue
              </AppText>
              <Ionicons name="arrow-forward" size={22} color={colors.onPrimary} style={styles.continueIcon} />
            </Pressable>

            <Pressable accessibilityRole="button" accessibilityLabel="Skip for now" onPress={skip} style={styles.skip} hitSlop={8}>
              <AppText style={[styles.skipLabel, { color: colors.primaryText }]} maxFontSizeMultiplier={1.3}>
                Skip for now
              </AppText>
            </Pressable>
          </View>
        </Pressable>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: {
    flex: 1,
  },
  container: {
    flexGrow: 1,
  },
  content: {
    flexGrow: 1,
    paddingHorizontal: 24,
  },
  headline: {
    fontSize: 34,
    lineHeight: 42,
    marginTop: 28,
  },
  copy: {
    marginTop: 14,
    gap: 2,
  },
  copyLine: {
    fontSize: 18,
    lineHeight: 26,
  },
  form: {
    marginTop: 36,
  },
  label: {
    fontSize: 16,
    fontWeight: '600',
    marginBottom: 10,
  },
  input: {
    minHeight: 56,
    borderRadius: 16,
    borderWidth: 2,
    paddingHorizontal: 16,
    fontSize: 18,
  },
  error: {
    fontSize: 14,
    marginTop: 8,
  },
  privacy: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 12,
  },
  privacyText: {
    flex: 1,
    fontSize: 13,
  },
  continue: {
    minHeight: 56,
    borderRadius: 16,
    marginTop: 24,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 52,
  },
  pressed: {
    opacity: 0.8,
  },
  continueLabel: {
    fontSize: 17,
    fontWeight: '700',
    textAlign: 'center',
  },
  continueIcon: {
    position: 'absolute',
    right: 20,
  },
  skip: {
    minHeight: 48,
    marginTop: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  skipLabel: {
    fontSize: 16,
    fontWeight: '600',
  },
});
