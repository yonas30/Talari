import { StyleSheet, View, ViewProps } from 'react-native';

import { useTheme } from '../theme/ThemeProvider';

interface CardProps extends ViewProps {
  /** 'hero' is the navy Total Balance card; 'surface' is the normal card. */
  variant?: 'surface' | 'hero';
}

// Flat card: 1px border, no shadow in Dark, only a very light one in Light. The hero card is navy in both schemes, with
// no border in Light and a hairline border in Dark.
export default function Card({ variant = 'surface', style, ...rest }: CardProps) {
  const { colors, scheme } = useTheme();
  const hero = variant === 'hero';

  return (
    <View
      {...rest}
      style={[
        styles.base,
        {
          backgroundColor: hero ? colors.heroBg : colors.surface,
          borderColor: hero ? colors.heroBorder : colors.border,
          borderWidth: hero && scheme === 'light' ? 0 : 1,
        },
        scheme === 'light' && !hero && styles.lightShadow,
        style,
      ]}
    />
  );
}

const styles = StyleSheet.create({
  base: {
    borderRadius: 20,
    padding: 16,
  },
  // Barely there: the border does the work. No elevation, which on Android draws a heavy shadow.
  lightShadow: {
    shadowColor: '#17233C',
    shadowOpacity: 0.04,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
  },
});
