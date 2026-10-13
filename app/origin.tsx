import { useState } from 'react';
import { Alert, KeyboardAvoidingView, ScrollView, StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';

import AppHeader from '../components/AppHeader';
import AppText from '../components/AppText';
import Button from '../components/Button';
import Card from '../components/Card';
import FormInput from '../components/FormInput';
import InlineError from '../components/InlineError';
import { useFinanceStore } from '../store/finance';
import { useTheme } from '../theme/ThemeProvider';

export default function OriginScreen() {
  const router = useRouter();
  const { colors } = useTheme();
  const origin = useFinanceStore((state) => state.origin);
  const saveOrigin = useFinanceStore((state) => state.saveOrigin);

  const [startingPoint, setStartingPoint] = useState(origin?.startingPoint ?? '');
  const [whyBuilding, setWhyBuilding] = useState(origin?.whyBuilding ?? '');
  const [storyText, setStoryText] = useState(origin?.storyText ?? '');
  // Shown above the Save button (it used to be a native alert). The "Saved" confirmation below stays a native alert.
  const [error, setError] = useState<string | null>(null);

  const onSave = async () => {
    if (!storyText.trim() && !whyBuilding.trim() && !startingPoint.trim()) {
      setError('Write at least a little about your story before saving.');
      return;
    }
    setError(null);

    await saveOrigin({ storyText, startingPoint, whyBuilding });
    Alert.alert('Saved', 'Your story has been saved.');
    router.back();
  };

  return (
    <View style={[styles.screen, { backgroundColor: colors.bg }]}>
      <AppHeader title="Your Origin" />
      {/* The soft keyboard doesn't resize an edge-to-edge window; lift the form so inputs stay visible. */}
      <KeyboardAvoidingView style={styles.flex} behavior="padding">
        <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled" removeClippedSubviews={false}>
          <AppText style={[styles.subtitle, { color: colors.textMuted }]}>
            This is your story, in your own words. It's never generated for you — only you write this,
            and your dashboard will occasionally remind you of it.
          </AppText>

          <Card style={styles.card}>
            <AppText style={[styles.label, { color: colors.textMuted }]}>Where did you start financially?</AppText>
            <FormInput
              style={styles.textArea}
              value={startingPoint}
              onChangeText={(text) => {
                setStartingPoint(text);
                setError(null);
              }}
              placeholder="e.g. Living paycheck to paycheck, no savings..."
              accessibilityLabel="Where did you start financially?"
              multiline
            />
          </Card>

          <Card style={styles.card}>
            <AppText style={[styles.label, { color: colors.textMuted }]}>Why are you building this?</AppText>
            <FormInput
              style={styles.textArea}
              value={whyBuilding}
              onChangeText={(text) => {
                setWhyBuilding(text);
                setError(null);
              }}
              placeholder="e.g. I want my family to never worry about money again..."
              accessibilityLabel="Why are you building this?"
              multiline
            />
          </Card>

          <Card style={styles.card}>
            <AppText style={[styles.label, { color: colors.textMuted }]}>Your story</AppText>
            <FormInput
              style={styles.textArea}
              value={storyText}
              onChangeText={(text) => {
                setStoryText(text);
                setError(null);
              }}
              placeholder="Write as much or as little as you want..."
              accessibilityLabel="Your story"
              multiline
            />
          </Card>

          {error ? <InlineError message={error} /> : null}

          <Button title="Save my story" variant="primary" onPress={() => void onSave()} />
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: {
    flex: 1,
  },
  screen: {
    flex: 1,
  },
  container: {
    flexGrow: 1,
    paddingHorizontal: 20,
    paddingBottom: 28,
    gap: 12,
  },
  subtitle: {
    fontSize: 13,
    lineHeight: 20,
  },
  card: {
    padding: 14,
    gap: 10,
  },
  label: {
    fontSize: 13,
    fontWeight: '700',
  },
  textArea: {
    minHeight: 90,
    textAlignVertical: 'top',
  },
});
