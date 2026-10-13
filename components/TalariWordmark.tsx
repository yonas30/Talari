import Svg, { Circle, Path } from 'react-native-svg';

import { WORDMARK_ASPECT, WORDMARK_DOTS, WORDMARK_LETTERS, WORDMARK_VIEWBOX } from '../assets/brand/talariPaths';
import { useTheme } from '../theme/ThemeProvider';

const VIEW_BOX = `${WORDMARK_VIEWBOX.x} ${WORDMARK_VIEWBOX.y} ${WORDMARK_VIEWBOX.width} ${WORDMARK_VIEWBOX.height}`;
// Index of the letter (T A L A R I) each dot belongs to - the dots are not needed for a static drawing, the A's carry their own.
const DOT_FOR_LETTER: Record<number, number> = { 1: 0, 3: 1 };

// The approved TALARI wordmark (Latin letters only) as a static image: navy in Light, white in Dark, with the brand-orange dots.
export default function TalariWordmark({ width = 120 }: { width?: number }) {
  const { colors, scheme } = useTheme();
  const body = scheme === 'dark' ? colors.heroText : colors.text;

  return (
    <Svg width={width} height={width * WORDMARK_ASPECT} viewBox={VIEW_BOX} accessibilityRole="image" accessibilityLabel="Talari">
      {WORDMARK_LETTERS.map((path, index) => (
        <Path key={index} d={path} fill={body} fillRule="evenodd" />
      ))}
      {Object.values(DOT_FOR_LETTER).map((dotIndex) => (
        <Circle key={dotIndex} cx={WORDMARK_DOTS[dotIndex].cx} cy={WORDMARK_DOTS[dotIndex].cy} r={WORDMARK_DOTS[dotIndex].r} fill={colors.primary} />
      ))}
    </Svg>
  );
}
