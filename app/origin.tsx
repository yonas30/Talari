import { useState } from 'react';
import { Alert, KeyboardAvoidingView, ScrollView, StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';

import AppButton from '../components/AppButton';
import AppHeader from '../components/AppHeader';
import { colors, radius, spacing, typography } from '../constants/theme';
import { useFinanceStore } from '../store/finance';
import AppText from '../components/AppText';
import AppTextInput from '../components/AppTextInput';

export default function OriginScreen() {
  const router = useRouter();
  const origin = useFinanceStore((state) => state.origin);
  const saveOrigin = useFinanceStore((state) => state.saveOrigin);

  const [startingPoint, setStartingPoint] = useState(origin?.startingPoint ?? '');
  const [whyBuilding, setWhyBuilding] = useState(origin?.whyBuilding ?? '');
  const [storyText, setStoryText] = useState(origin?.storyText ?? '');

  const onSave = async () => {
    if (!storyText.trim() && !whyBuilding.trim() && !startingPoint.trim()) {
      Alert.alert('Write at least a little about your story before saving.');
      return;
    }

    await saveOrigin({ storyText, startingPoint, whyBuilding });
    Alert.alert('Saved', 'Your story has been saved.');
    router.back();
  };

  return (
    <View style={styles.screen}>
      <AppHeader title="Your Origin" />
      {/* The soft keyboard doesn't resize an edge-to-edge window; lift the form so inputs stay visible. */}
      <KeyboardAvoidingView style={styles.flex} behavior="padding">
        <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled" removeClippedSubviews={false}>
          <AppText style={styles.subtitle}>
            This is your story, in your own words. It's never generated for you — only you write this,
            and your dashboard will occasionally remind you of it.
          </AppText>

          <View style={styles.card}>
            <AppText style={styles.label}>Where did you start financially?</AppText>
            <AppTextInput
              style={styles.textArea}
              value={startingPoint}
              onChangeText={setStartingPoint}
              placeholder="e.g. Living paycheck to paycheck, no savings..."
              placeholderTextColor={colors.textSecondary}
              multiline
            />
          </View>

          <View style={styles.card}>
            <AppText style={styles.label}>Why are you building this?</AppText>
            <AppTextInput
              style={styles.textArea}
              value={whyBuilding}
              onChangeText={setWhyBuilding}
              placeholder="e.g. I want my family to never worry about money again..."
              placeholderTextColor={colors.textSecondary}
              multiline
            />
          </View>

          <View style={styles.card}>
            <AppText style={styles.label}>Your story</AppText>
            <AppTextInput
              style={styles.textArea}
              value={storyText}
              onChangeText={setStoryText}
              placeholder="Write as much or as little as you want..."
              placeholderTextColor={colors.textSecondary}
              multiline
            />
          </View>

          <AppButton title="Save my story" variant="primary" onPress={() => void onSave()} />
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
    backgroundColor: colors.background,
  },
  container: {
    flexGrow: 1,
    paddingHorizontal: spacing.xl,
    paddingBottom: spacing.xl,
    gap: spacing.md,
  },
  subtitle: {
    ...typography.helper,
    color: colors.textSecondary,
    lineHeight: 20,
  },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.card,
    padding: spacing.lg,
    gap: spacing.md,
    shadowColor: '#000',
    shadowOpacity: 0.05,
    shadowRadius: 8,
    elevation: 2,
  },
  label: {
    ...typography.helper,
    color: colors.textSecondary,
    fontWeight: '700',
  },
  textArea: {
    backgroundColor: colors.background,
    borderColor: '#E2E5DE',
    borderWidth: 1,
    borderRadius: radius.button,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    fontSize: 15,
    minHeight: 90,
    textAlignVertical: 'top',
    color: colors.navy,
  },
});
