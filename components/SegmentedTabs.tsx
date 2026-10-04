import { Pressable, StyleSheet, Text, View } from 'react-native';

import { colors, radius } from '../constants/theme';
import { CONTROL_LABEL_MAX_SCALE } from '../utils/layout';

export interface TabOption<T extends string> {
  key: T;
  label: string;
}

interface SegmentedTabsProps<T extends string> {
  tabs: TabOption<T>[];
  value: T;
  onChange: (key: T) => void;
}

// The pill-style tab row used for Upcoming/All (Recurring), Active/Completed (Goals) and the Transactions type
// filter. One implementation, so the large-font handling is fixed in one place: every tab shares the width equally, and
// its label stays on ONE line - it may grow with the system font only up to CONTROL_LABEL_MAX_SCALE and then shrinks to
// fit, so a long label ("Transfer") can never wrap mid-word or overflow its pill however large the system font is.
export default function SegmentedTabs<T extends string>({ tabs, value, onChange }: SegmentedTabsProps<T>) {
  return (
    <View style={styles.tabs} accessibilityRole="tablist">
      {tabs.map((tab) => {
        const selected = tab.key === value;
        return (
          <Pressable
            key={tab.key}
            style={[styles.tab, selected && styles.tabSelected]}
            onPress={() => onChange(tab.key)}
            accessibilityRole="tab"
            accessibilityState={{ selected }}
            accessibilityLabel={tab.label}
          >
            <Text
              style={[styles.tabText, selected && styles.tabTextSelected]}
              numberOfLines={1}
              adjustsFontSizeToFit
              minimumFontScale={0.7}
              maxFontSizeMultiplier={CONTROL_LABEL_MAX_SCALE}
            >
              {tab.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  tabs: {
    flexDirection: 'row',
    backgroundColor: colors.surface,
    borderRadius: radius.button,
    padding: 4,
  },
  tab: {
    flex: 1,
    minWidth: 0,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 9,
    paddingHorizontal: 4,
    borderRadius: radius.button - 2,
  },
  tabSelected: {
    backgroundColor: colors.navy,
  },
  tabText: {
    color: colors.navy,
    fontWeight: '600',
    textAlign: 'center',
  },
  tabTextSelected: {
    color: '#FFFFFF',
  },
});
