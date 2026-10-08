import { Pressable, StyleSheet, View } from 'react-native';

import { radius } from '../constants/theme';
import { useTheme } from '../theme/ThemeProvider';
import { CONTROL_LABEL_MAX_SCALE } from '../utils/layout';
import AppText from './AppText';

export interface SegmentOption<T extends string> {
  key: T;
  label: string;
}

interface SegmentedControlProps<T extends string> {
  options: SegmentOption<T>[];
  value: T;
  onChange: (key: T) => void;
}

// THE segmented control (it replaces SegmentedTabs when screens are migrated; same large-font behaviour). Light: the
// selected segment is a navy pill with white text. Dark: an off-white pill with navy text, which stays clearly visible
// on the #222C44 track. Every segment has the same width and its label stays on one line, shrinking before it would wrap.
export default function SegmentedControl<T extends string>({ options, value, onChange }: SegmentedControlProps<T>) {
  const { colors } = useTheme();

  return (
    <View style={[styles.track, { backgroundColor: colors.segmentTrack }]} accessibilityRole="tablist">
      {options.map((option) => {
        const selected = option.key === value;
        return (
          <Pressable
            key={option.key}
            style={[styles.segment, selected && { backgroundColor: colors.segmentSelectedBg }]}
            onPress={() => onChange(option.key)}
            accessibilityRole="tab"
            accessibilityState={{ selected }}
            accessibilityLabel={option.label}
          >
            <AppText
              numberOfLines={1}
              adjustsFontSizeToFit
              minimumFontScale={0.7}
              maxFontSizeMultiplier={CONTROL_LABEL_MAX_SCALE}
              style={[styles.label, { color: selected ? colors.segmentSelectedText : colors.segmentText }]}
            >
              {option.label}
            </AppText>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  track: {
    flexDirection: 'row',
    borderRadius: radius.button,
    padding: 4,
  },
  segment: {
    flex: 1,
    minWidth: 0,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 9,
    paddingHorizontal: 4,
    borderRadius: radius.button - 2,
  },
  label: {
    fontSize: 14,
    fontWeight: '600',
    textAlign: 'center',
  },
});
