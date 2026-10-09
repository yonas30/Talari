import Svg, { Circle, Path } from 'react-native-svg';

import { SYMBOL_ASPECT, SYMBOL_DOT, SYMBOL_PATHS, SYMBOL_VIEWBOX } from '../assets/brand/talariPaths';
import { useTheme } from '../theme/ThemeProvider';

interface TalariSymbolProps {
  /** Width in dp; the height follows the symbol's aspect ratio. */
  width?: number;
}

const VIEW_BOX = `${SYMBOL_VIEWBOX.x} ${SYMBOL_VIEWBOX.y} ${SYMBOL_VIEWBOX.width} ${SYMBOL_VIEWBOX.height}`;

// The approved Talari symbol as a static image (the animated splash draws the same geometry itself, layer by layer).
// Light: navy stem and legs. Dark: white stem and legs. The band and the dot are always the brand orange.
export default function TalariSymbol({ width = 72 }: TalariSymbolProps) {
  const { colors, scheme } = useTheme();
  const body = scheme === 'dark' ? colors.heroText : colors.text;

  return (
    <Svg width={width} height={width * SYMBOL_ASPECT} viewBox={VIEW_BOX} accessibilityRole="image" accessibilityLabel="Talari">
      <Path d={SYMBOL_PATHS.stem} fill={body} />
      <Path d={SYMBOL_PATHS.legl} fill={body} />
      <Path d={SYMBOL_PATHS.legr} fill={body} />
      <Path d={SYMBOL_PATHS.band} fill={colors.primary} />
      <Circle cx={SYMBOL_DOT.cx} cy={SYMBOL_DOT.cy} r={SYMBOL_DOT.r} fill={colors.primary} />
    </Svg>
  );
}
