// Checks the Talari theme tokens.
//  1. WCAG contrast of every text/background pair in both palettes (4.5:1, or 3:1 for large bold text).
//  2. The legacy `colors` object: a key may differ from its old value only if the change is imperceptible (CIEDE2000 < 3).
//  3. The categorical chart palette: no red/green, stable id -> colour mapping.
// Run: npx tsx scripts/verify-contrast.ts
import { colors } from '../constants/theme';
import { CATEGORY_PALETTE, CHART_PALETTE, categoryColor, OTHERS_COLOR } from '../theme/chartPalette';
import { BREAKDOWN_PALETTE } from '../utils/reports';
import { palettes, ThemeColors, ThemeScheme } from '../theme/tokens';

let passed = 0;
let failed = 0;
function check(name: string, ok: boolean, detail = '') {
  if (ok) {
    passed += 1;
  } else {
    failed += 1;
    console.log(`FAIL ${name} ${detail}`);
  }
}

// ---- colour maths ---------------------------------------------------------------------------------------------------
type Rgb = [number, number, number];

function parse(color: string): { rgb: Rgb; alpha: number } {
  const rgba = /^rgba\((\d+),(\d+),(\d+),([\d.]+)\)$/.exec(color.replace(/\s/g, ''));
  if (rgba) {
    return { rgb: [Number(rgba[1]), Number(rgba[2]), Number(rgba[3])], alpha: Number(rgba[4]) };
  }
  const hex = color.replace('#', '');
  return { rgb: [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16)) as Rgb, alpha: 1 };
}

// Composite a (possibly translucent) colour over an opaque background.
function over(foreground: string, background: string): Rgb {
  const fg = parse(foreground);
  const bg = parse(background).rgb;
  return fg.rgb.map((value, i) => Math.round(value * fg.alpha + bg[i] * (1 - fg.alpha))) as Rgb;
}

const linear = (channel: number) => {
  const c = channel / 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
};
const luminance = ([r, g, b]: Rgb) => 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b);

function contrast(foreground: string, background: string): number {
  const a = luminance(over(foreground, background));
  const b = luminance(parse(background).rgb);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

function lab([r8, g8, b8]: Rgb): Rgb {
  const toLinear = (c: number) => {
    const v = c / 255;
    return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  const [r, g, b] = [toLinear(r8), toLinear(g8), toLinear(b8)];
  const x = (0.4124564 * r + 0.3575761 * g + 0.1804375 * b) / 0.95047;
  const y = 0.2126729 * r + 0.7151522 * g + 0.072175 * b;
  const z = (0.0193339 * r + 0.119192 * g + 0.9503041 * b) / 1.08883;
  const f = (t: number) => (t > 216 / 24389 ? Math.cbrt(t) : ((24389 / 27) * t + 16) / 116);
  return [116 * f(y) - 16, 500 * (f(x) - f(y)), 200 * (f(y) - f(z))];
}

// CIEDE2000.
function deltaE(hexA: string, hexB: string): number {
  const rad = Math.PI / 180;
  const [L1, a1, b1] = lab(parse(hexA).rgb);
  const [L2, a2, b2] = lab(parse(hexB).rgb);
  const meanC = (Math.hypot(a1, b1) + Math.hypot(a2, b2)) / 2;
  const G = 0.5 * (1 - Math.sqrt(meanC ** 7 / (meanC ** 7 + 25 ** 7)));
  const a1p = (1 + G) * a1;
  const a2p = (1 + G) * a2;
  const C1 = Math.hypot(a1p, b1);
  const C2 = Math.hypot(a2p, b2);
  const hue = (b: number, a: number) => {
    const h = Math.atan2(b, a) / rad;
    return h < 0 ? h + 360 : h;
  };
  const h1 = hue(b1, a1p);
  const h2 = hue(b2, a2p);
  const dL = L2 - L1;
  const dC = C2 - C1;
  let dh = h2 - h1;
  if (C1 * C2 === 0) dh = 0;
  else if (dh > 180) dh -= 360;
  else if (dh < -180) dh += 360;
  const dH = 2 * Math.sqrt(C1 * C2) * Math.sin((dh / 2) * rad);
  const meanL = (L1 + L2) / 2;
  const meanCp = (C1 + C2) / 2;
  let meanH = h1 + h2;
  if (C1 * C2 !== 0) {
    meanH = Math.abs(h1 - h2) <= 180 ? meanH / 2 : (meanH + (meanH < 360 ? 360 : -360)) / 2;
  }
  const T =
    1 -
    0.17 * Math.cos((meanH - 30) * rad) +
    0.24 * Math.cos(2 * meanH * rad) +
    0.32 * Math.cos((3 * meanH + 6) * rad) -
    0.2 * Math.cos((4 * meanH - 63) * rad);
  const dTheta = 30 * Math.exp(-(((meanH - 275) / 25) ** 2));
  const Rc = 2 * Math.sqrt(meanCp ** 7 / (meanCp ** 7 + 25 ** 7));
  const Sl = 1 + (0.015 * (meanL - 50) ** 2) / Math.sqrt(20 + (meanL - 50) ** 2);
  const Sc = 1 + 0.045 * meanCp;
  const Sh = 1 + 0.015 * meanCp * T;
  const Rt = -Math.sin(2 * dTheta * rad) * Rc;
  return Math.sqrt((dL / Sl) ** 2 + (dC / Sc) ** 2 + (dH / Sh) ** 2 + Rt * (dC / Sc) * (dH / Sh));
}

// ---- 1. text pairs --------------------------------------------------------------------------------------------------
type Pair = { fg: keyof ThemeColors; bg: keyof ThemeColors; min: number; note?: string };

const BODY = 4.5;
const LARGE = 3;
const pairs: Pair[] = [
  ...(['bg', 'surface', 'surfaceMuted'] as const).flatMap((bg) => [
    { fg: 'text', bg, min: BODY },
    { fg: 'textMuted', bg, min: BODY },
    { fg: 'primaryText', bg, min: BODY },
  ] as Pair[]),
  { fg: 'onPrimary', bg: 'primary', min: BODY },
  { fg: 'heroText', bg: 'heroBg', min: BODY },
  { fg: 'heroTextMuted', bg: 'heroBg', min: BODY },
  ...(['income', 'expense', 'net', 'saved', 'transfer', 'goals'] as const).flatMap((fg) => [
    { fg, bg: 'bg', min: BODY },
    { fg, bg: 'surface', min: BODY },
  ] as Pair[]),
  { fg: 'welcomeAccent', bg: 'bg', min: LARGE, note: 'large bold headline' },
  { fg: 'segmentSelectedText', bg: 'segmentSelectedBg', min: BODY },
  { fg: 'segmentText', bg: 'segmentTrack', min: BODY },
];

console.log('Contrast ratios (text pair -> ratio, required)');
for (const scheme of ['light', 'dark'] as ThemeScheme[]) {
  const palette = palettes[scheme];
  for (const pair of pairs) {
    const ratio = contrast(palette[pair.fg], palette[pair.bg]);
    const ok = ratio >= pair.min;
    console.log(`  ${scheme.padEnd(5)} ${(pair.fg + ' on ' + pair.bg).padEnd(34)} ${ratio.toFixed(2).padStart(6)}  (>= ${pair.min})${ok ? '' : '   <-- FAIL'}`);
    check(`${scheme}: ${pair.fg} on ${pair.bg}`, ok, `${ratio.toFixed(2)} < ${pair.min}`);
  }
}
check('light palette has no hero border', palettes.light.heroBorder === 'transparent');

// Welcome screen (Phase 2). Text pairs it uses are all in the table above: headline "Welcome to" = text on bg, accent word =
// welcomeAccent on bg (large bold, 3:1), supporting copy / privacy note / placeholder = textMuted on bg and surface, the
// Skip button = primaryText on bg, Continue = onPrimary on primary. The name field's focus border is a UI component edge,
// which needs 3:1 (WCAG 1.4.11) against both the screen and the field fill.
console.log('\nText fields: focus border and resting border (inputBorder) - both need 3:1 against the field fill and the screen');
const focusBorder: Record<ThemeScheme, keyof ThemeColors> = { light: 'text', dark: 'primary' };
for (const scheme of ['light', 'dark'] as ThemeScheme[]) {
  const palette = palettes[scheme];
  const border = palette[focusBorder[scheme]];
  for (const against of ['bg', 'surface'] as const) {
    const ratio = contrast(border, palette[against]);
    console.log(`  ${scheme.padEnd(5)} focus border (${focusBorder[scheme]}) on ${against.padEnd(8)} ${ratio.toFixed(2).padStart(6)}  (>= 3)${ratio >= 3 ? '' : '   <-- FAIL'}`);
    check(`${scheme}: welcome input focus border on ${against}`, ratio >= 3, ratio.toFixed(2));
  }
  for (const against of ['bg', 'surface'] as const) {
    const ratio = contrast(palette.inputBorder, palette[against]);
    console.log(`  ${scheme.padEnd(5)} resting border (inputBorder) on ${against.padEnd(8)} ${ratio.toFixed(2).padStart(6)}  (>= 3)${ratio >= 3 ? '' : '   <-- FAIL'}`);
    check(`${scheme}: inputBorder on ${against}`, ratio >= 3, ratio.toFixed(2));
  }
}

// ---- 1b. Home tokens (Phase 3) ---------------------------------------------------------------------------------------
// A colour with transparency, resolved against what is behind it, as a solid hex.
function solid(color: string, base: string): string {
  const [r, g, b] = over(color, base);
  return '#' + [r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('');
}

console.log('\nHome: glyphs on their PALE icon discs (graphics need 3:1), large figures, streak card, + button, tab bar');
for (const scheme of ['light', 'dark'] as ThemeScheme[]) {
  const c = palettes[scheme];
  const discs: [string, keyof ThemeColors, keyof ThemeColors][] = [
    ['income glyph', 'incomeGlyph', 'incomeDisc'],
    ['expense glyph', 'expenseGlyph', 'expenseDisc'],
    ['net glyph', 'netGlyph', 'netDisc'],
    ['transfer glyph', 'transferGlyph', 'transferDisc'],
  ];
  for (const [label, glyph, disc] of discs) {
    const fill = solid(c[disc], c.surface);
    const ratio = contrast(c[glyph], fill);
    console.log(`  ${scheme.padEnd(5)} ${label.padEnd(15)} on its disc over surface ${ratio.toFixed(2).padStart(6)}  (>= 3)${ratio >= 3 ? '' : '   <-- FAIL'}`);
    check(`${scheme}: ${label} on disc`, ratio >= 3, ratio.toFixed(2));
  }
  // The pale discs: glyph colour on a 16% tint over the card surface (graphics need 3:1).
  // Net is drawn at 20 sp bold = large text (3:1) in netLarge; income / expense amounts are small text (4.5:1, checked above).
  for (const against of ['surface'] as const) {
    const ratio = contrast(c.netLarge, c[against]);
    console.log(`  ${scheme.padEnd(5)} Net amount (netLarge, 20 sp bold) on ${against.padEnd(8)} ${ratio.toFixed(2).padStart(6)}  (>= 3)${ratio >= 3 ? '' : '   <-- FAIL'}`);
    check(`${scheme}: netLarge on ${against}`, ratio >= LARGE, ratio.toFixed(2));
  }
  const streakBg = solid(c.streakFill, c.bg);
  const flameDisc = c.streakDisc === 'transparent' ? streakBg : solid(c.streakDisc, streakBg);
  for (const [label, fg, bgColor, min] of [
    ['streak title (text)', c.text, streakBg, BODY],
    ['streak subtitle', c.streakMuted, streakBg, BODY],
    ['streak flame on its disc (graphic)', c.streakAccent, flameDisc, LARGE],
  ] as [string, string, string, number][]) {
    const ratio = contrast(fg, bgColor);
    console.log(`  ${scheme.padEnd(5)} ${label.padEnd(36)} ${ratio.toFixed(2).padStart(6)}  (>= ${min})${ratio >= min ? '' : '   <-- FAIL'}`);
    check(`${scheme}: ${label}`, ratio >= min, ratio.toFixed(2));
  }
  // Over-budget banner: its text is the normal text colour on the expense wash over the screen background
  const banner = solid(c.expenseWash, c.bg);
  check(`${scheme}: banner text on the expense wash`, contrast(c.text, banner) >= BODY, contrast(c.text, banner).toFixed(2));
  const heroDivider = contrast(solid(c.heroDivider, c.heroBg), c.heroBg);
  console.log(`  ${scheme.padEnd(5)} hero divider on hero (decorative line, informational) ${heroDivider.toFixed(2)}`);
  // Section headings and links on the screen background
  for (const fg of ['text', 'primaryText'] as const) {
    const ratio = contrast(c[fg], c.bg);
    check(`${scheme}: ${fg} on bg (headings, See all links)`, ratio >= BODY, ratio.toFixed(2));
  }
  // The raised + button: navy plus on the brand orange
  check(`${scheme}: plus icon (onPrimary) on the primary fill`, contrast(c.onPrimary, c.primary) >= 3, contrast(c.onPrimary, c.primary).toFixed(2));
  // Tab bar: the active label (primaryText), the inactive label (textMuted) and the vivid active ICON (primary, a graphic) on the bar
  check(`${scheme}: active tab label on the bar`, contrast(c.primaryText, c.surface) >= BODY, contrast(c.primaryText, c.surface).toFixed(2));
  check(`${scheme}: inactive tab label on the bar`, contrast(c.textMuted, c.surface) >= BODY, contrast(c.textMuted, c.surface).toFixed(2));
  const activeIcon = contrast(c.primary, c.surface);
  console.log(`  ${scheme.padEnd(5)} active tab icon (vivid orange, filled + semi-bold label) on bar ${activeIcon.toFixed(2)}  (informational; below 3 in Light)`);
}

// Donut slices and legend dots against the card surface. They carry no meaning alone (the legend text says it all), so this is informational.
console.log('\nHome donut colours (the breakdown colours Insights also uses) on the card surface (informational: legend text carries the meaning)');
for (const scheme of ['light', 'dark'] as ThemeScheme[]) {
  for (const hex of [...BREAKDOWN_PALETTE, OTHERS_COLOR]) {
    const ratio = contrast(hex, palettes[scheme].surface);
    console.log(`  ${scheme.padEnd(5)} ${hex} on surface ${ratio.toFixed(2).padStart(6)}${ratio >= 3 ? '' : '   (below 3:1)'}`);
  }
}

// ---- 2. legacy colors mapping ---------------------------------------------------------------------------------------
const OLD_COLORS: Record<keyof typeof colors, string> = {
  background: '#F7F7F3',
  surface: '#FFFFFF',
  navy: '#172033',
  textSecondary: '#66708B',
  olive: '#6B7D3A',
  oliveLight: '#E8EDDC',
  orange: '#E87532',
  orangeLight: '#FCE8DA',
  blue: '#4169E1',
  red: '#D95C5C',
  redLight: '#FBE4E4',
  statusIncome: '#16A34A',
  statusExpense: '#D95C5C',
  statusWarning: '#F59E0B',
  statusInfo: '#3B82F6',
};
const CHANGEABLE: (keyof typeof colors)[] = ['background', 'surface', 'navy'];
console.log('\nLegacy colors: old -> new');
for (const key of Object.keys(OLD_COLORS) as (keyof typeof colors)[]) {
  const before = OLD_COLORS[key];
  const after = colors[key];
  const dE = deltaE(before, after);
  const changed = before.toLowerCase() !== after.toLowerCase();
  console.log(`  ${key.padEnd(14)} ${before} -> ${after}  ${changed ? `dE ${dE.toFixed(2)}` : 'unchanged'}`);
  check(`legacy ${key}: changed only if imperceptible`, !changed || (CHANGEABLE.includes(key) && dE < 3), `dE ${dE.toFixed(2)}`);
}

// ---- 3. chart palette -----------------------------------------------------------------------------------------------
function isRedOrGreen(hex: string): boolean {
  const [r, g, b] = parse(hex).rgb;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  if (max - min < 40) return false; // greys
  const hueValue =
    max === r ? (((g - b) / (max - min)) * 60 + 360) % 360 : max === g ? ((b - r) / (max - min)) * 60 + 120 : ((r - g) / (max - min)) * 60 + 240;
  return hueValue < 15 || hueValue > 345 || (hueValue > 75 && hueValue < 165);
}
check('chart palette has 7 distinct colours', new Set(CHART_PALETTE).size === 7);
check('category palette is the chart palette without the Others grey (6 colours)', CATEGORY_PALETTE.length === 6 && !CATEGORY_PALETTE.includes(OTHERS_COLOR as never));
check('chart palette contains no red or green', CHART_PALETTE.every((hex) => !isRedOrGreen(hex)));
check('category id -> colour is deterministic', categoryColor('cat-food') === categoryColor('cat-food'));
const sample = Array.from({ length: 70 }, (_, i) => categoryColor(`category-${i}`));
check('ids spread over the category palette (every colour used)', new Set(sample).size === CATEGORY_PALETTE.length);
check('no category ever gets the Others grey', sample.every((hex) => hex !== OTHERS_COLOR));


console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
