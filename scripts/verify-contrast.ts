// Checks the Talari theme tokens.
//  1. WCAG contrast of every text/background pair in both palettes (4.5:1, or 3:1 for large bold text).
//  2. The categorical chart palette: no red/green, stable id -> colour mapping.
// Run: npx tsx scripts/verify-contrast.ts
import { CATEGORY_PALETTE, CHART_PALETTE, categoryColor, OTHERS_COLOR } from '../theme/chartPalette';
import { BREAKDOWN_PALETTE } from '../utils/reports';
import { accountColour } from '../constants/accounts';
import { accountColors, accountFills, accountHeroDots, brandFills, palettes, ThemeColors, ThemeScheme, withAlpha } from '../theme/tokens';

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
  // Buttons: Danger (label on the expense-tone fill) and the selected state of the secondary button
  { fg: 'onDanger', bg: 'danger', min: BODY },
  { fg: 'text', bg: 'segmentTrack', min: BODY },
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

// ---- 1c. Transactions list (Phase 4a) ---------------------------------------------------------------------------------
// Rows sit on the card surface; a pressed row shows the screen background. Titles use text, sub-lines textMuted, signed amounts
// income / expense / text (transfers), and the "Clear search" / "Show all" links primaryText.
console.log('\nTransactions: row text on the card surface and on the pressed-row background (all small text, 4.5:1)');
for (const scheme of ['light', 'dark'] as ThemeScheme[]) {
  const c = palettes[scheme];
  for (const bgName of ['surface', 'bg'] as const) {
    for (const fg of ['text', 'textMuted', 'income', 'expense', 'primaryText'] as const) {
      const ratio = contrast(c[fg], c[bgName]);
      const ok = ratio >= BODY;
      console.log(`  ${scheme.padEnd(5)} ${fg.padEnd(12)} on ${bgName.padEnd(8)} ${ratio.toFixed(2).padStart(6)}  (>= ${BODY})${ok ? '' : '   <-- FAIL'}`);
      check(`${scheme}: transactions ${fg} on ${bgName}`, ok, ratio.toFixed(2));
    }
  }
  // Overlays: text on the sheet / picker surface, and the drawer's pressed row
  check(`${scheme}: sheet text on surface`, contrast(c.text, c.surface) >= BODY);
  check(`${scheme}: picker selected row (primaryText) on surface`, contrast(c.primaryText, c.surface) >= BODY);
  check(`${scheme}: drawer pressed row text on surfaceMuted`, contrast(c.text, c.surfaceMuted) >= BODY);
  // The header badge: count on the danger fill
  check(`${scheme}: bell badge count on danger`, contrast(c.onDanger, c.danger) >= BODY, contrast(c.onDanger, c.danger).toFixed(2));
}

// ---- 1d. Add / Edit transaction form (Phase 4b) -----------------------------------------------------------------------
// The fields sit on the screen colour inside a surface card. The amount is typed in the type's accent tone (large, but held to
// the small-text bar here because it sits on the field fill), labels are textMuted on the card, the inline error is the expense tone
// on the screen, and the Delete button is the danger fill with its own label colour (checked above).
console.log('\nForm: amount accents and field text on the field fill (the screen colour), labels on the card');
for (const scheme of ['light', 'dark'] as ThemeScheme[]) {
  const c = palettes[scheme];
  for (const fg of ['income', 'expense', 'transfer', 'text', 'textMuted'] as const) {
    const ratio = contrast(c[fg], c.bg);
    const ok = ratio >= BODY;
    console.log(`  ${scheme.padEnd(5)} ${fg.padEnd(10)} on field fill (bg)   ${ratio.toFixed(2).padStart(6)}  (>= ${BODY})${ok ? '' : '   <-- FAIL'}`);
    check(`${scheme}: form ${fg} on the field fill`, ok, ratio.toFixed(2));
  }
  check(`${scheme}: form labels and helper text (textMuted) on the card`, contrast(c.textMuted, c.surface) >= BODY);
  check(`${scheme}: inline error (expense) on the screen`, contrast(c.expense, c.bg) >= BODY);
  check(`${scheme}: inline error (expense) on the card`, contrast(c.expense, c.surface) >= BODY);
  check(`${scheme}: field edge (inputBorder) on the field fill`, contrast(c.inputBorder, c.bg) >= LARGE);
  check(`${scheme}: focused field edge (text) on the field fill`, contrast(c.text, c.bg) >= LARGE);
}

// ---- 1e. Insights (Phase 4c) ------------------------------------------------------------------------------------------------
// Text is held to 4.5:1 on the card. Chart marks (trend lines and points, bars, donut slices) carry no meaning alone - the legend,
// the axis labels and the percentages say it all - so their contrast against the card is printed as informational.
console.log('\nInsights: chart marks on the card surface (informational; the text next to them carries the meaning)');
for (const scheme of ['light', 'dark'] as ThemeScheme[]) {
  const c = palettes[scheme];
  const marks: [string, string][] = [
    ['trend line: income (brand green)', brandFills.income],
    ['trend line: expense (brand red)', brandFills.expense],
    ['bar track (surfaceMuted)', c.surfaceMuted],
    ['baseline (border)', c.border],
  ];
  for (const [label, hex] of marks) {
    const ratio = contrast(hex.startsWith('rgba') ? solid(hex, c.surface) : hex, c.surface);
    console.log(`  ${scheme.padEnd(5)} ${label.padEnd(34)} ${ratio.toFixed(2).padStart(6)}${ratio >= 3 ? '' : '   (below 3:1)'}`);
  }
  for (const [label, fg] of [
    ['axis labels (textMuted)', c.textMuted],
    ['legend text (textMuted)', c.textMuted],
    ['bar labels (text)', c.text],
    ['bar percentages (textMuted)', c.textMuted],
    ['legend names (text)', c.text],
    ['legend amounts below the name (textMuted)', c.textMuted],
    ['donut centre total (text)', c.text],
    ['donut centre caption (textMuted)', c.textMuted],
    ['range label and period arrows (text)', c.text],
  ] as [string, string][]) {
    check(`${scheme}: Insights ${label} on the card`, contrast(fg, c.surface) >= BODY, contrast(fg, c.surface).toFixed(2));
  }
  // Text on the screen background: the currency note, the date labels and the period label
  check(`${scheme}: Insights note and labels (textMuted) on the screen`, contrast(c.textMuted, c.bg) >= BODY);
  check(`${scheme}: Insights period label (text) on the screen`, contrast(c.text, c.bg) >= BODY);
  // The "Biggest spending category" highlight: text on the streak wash over the screen
  const highlight = solid(c.streakFill, c.bg);
  check(`${scheme}: Insights highlight title and value (text) on its card`, contrast(c.text, highlight) >= BODY, contrast(c.text, highlight).toFixed(2));
  check(`${scheme}: Insights highlight empty message (streakMuted) on its card`, contrast(c.streakMuted, highlight) >= BODY, contrast(c.streakMuted, highlight).toFixed(2));
}

// ---- 1f. Goals (Phase 4d) ---------------------------------------------------------------------------------------------------
// The progress bar is a graphic: its fill must stand out from its track (3:1). The goal icon is a glyph on a pale disc. The "Add money"
// pill and the selected account row sit on the streak wash (Light: peach, Dark: the surface); all their text is held to 4.5:1.
console.log('\nGoals: progress bar against its track, glyph on the goal disc, pills and rows');
for (const scheme of ['light', 'dark'] as ThemeScheme[]) {
  const c = palettes[scheme];
  const bar = contrast(c.goalsBar, c.surfaceMuted);
  console.log(`  ${scheme.padEnd(5)} progress bar fill on its track (surfaceMuted)  ${bar.toFixed(2).padStart(6)}  (>= 3)${bar >= 3 ? '' : '   <-- FAIL'}`);
  check(`${scheme}: goals progress fill on its track`, bar >= LARGE, bar.toFixed(2));
  const barOnCard = contrast(c.goalsBar, c.surface);
  console.log(`  ${scheme.padEnd(5)} progress bar fill on the card surface          ${barOnCard.toFixed(2).padStart(6)}  (informational)`);
  const glyph = contrast(c.goalsGlyph, solid(c.goalsDisc, c.surface));
  console.log(`  ${scheme.padEnd(5)} goal icon on its pale disc                      ${glyph.toFixed(2).padStart(6)}  (>= 3)${glyph >= 3 ? '' : '   <-- FAIL'}`);
  check(`${scheme}: goals glyph on its disc`, glyph >= LARGE, glyph.toFixed(2));
  const pill = solid(c.streakFill, c.surface);
  check(`${scheme}: Add money pill text on its fill`, contrast(c.text, pill) >= BODY, contrast(c.text, pill).toFixed(2));
  check(`${scheme}: Add money pill icon (primaryText) on its fill`, contrast(c.primaryText, pill) >= LARGE, contrast(c.primaryText, pill).toFixed(2));
  check(`${scheme}: Add money pill edge (primary) on the card`, contrast(c.primary, c.surface) >= 2.5, contrast(c.primary, c.surface).toFixed(2));
  check(`${scheme}: selected account row balance (streakMuted) on its fill`, contrast(c.streakMuted, pill) >= BODY, contrast(c.streakMuted, pill).toFixed(2));
  check(`${scheme}: radio icon (primaryText) on the selected row`, contrast(c.primaryText, pill) >= LARGE, contrast(c.primaryText, pill).toFixed(2));
  check(`${scheme}: unselected radio / pill text (textMuted) on the card`, contrast(c.textMuted, c.surface) >= BODY);
  check(`${scheme}: quick chip text on its fill (surfaceMuted)`, contrast(c.text, c.surfaceMuted) >= BODY, contrast(c.text, c.surfaceMuted).toFixed(2));
  check(`${scheme}: goals note text (textMuted) on the card`, contrast(c.textMuted, c.surface) >= BODY);
  check(`${scheme}: delete menu text (expense) on the sheet`, contrast(c.expense, c.surface) >= BODY, contrast(c.expense, c.surface).toFixed(2));
  check(`${scheme}: New goal button label on its fill`, contrast(c.onPrimary, c.primary) >= BODY, contrast(c.onPrimary, c.primary).toFixed(2));
}

// ---- 1g. Settings, drawer, About, Notifications, Journey (Phase 4e) -----------------------------------------------------------
console.log('\nPhase 4e: settings rows, drawer, notifications, journey');
for (const scheme of ['light', 'dark'] as ThemeScheme[]) {
  const c = palettes[scheme];
  const accent = solid(c.accentDisc, c.surface);
  check(`${scheme}: settings/drawer icon (primaryText) on the accent disc`, contrast(c.primaryText, accent) >= LARGE, contrast(c.primaryText, accent).toFixed(2));
  check(`${scheme}: row title (text) on the card`, contrast(c.text, c.surface) >= BODY);
  check(`${scheme}: row subtitle / section title (textMuted) on the screen`, contrast(c.textMuted, c.bg) >= BODY, contrast(c.textMuted, c.bg).toFixed(2));
  check(`${scheme}: row subtitle (textMuted) on the card`, contrast(c.textMuted, c.surface) >= BODY);
  check(`${scheme}: pressed row text (text) on surfaceMuted`, contrast(c.text, c.surfaceMuted) >= BODY, contrast(c.text, c.surfaceMuted).toFixed(2));
  check(`${scheme}: switch track off (inputBorder) on the card`, contrast(c.inputBorder, c.surface) >= LARGE, contrast(c.inputBorder, c.surface).toFixed(2));
  check(`${scheme}: switch track on (primary) on the card`, contrast(c.primary, c.surface) >= 2.5 || scheme === 'light', contrast(c.primary, c.surface).toFixed(2));
  check(`${scheme}: switch thumb on (onPrimary) on the on-track (primary)`, contrast(c.onPrimary, c.primary) >= LARGE, contrast(c.onPrimary, c.primary).toFixed(2));
  check(`${scheme}: switch thumb off (surface) on the off-track (inputBorder)`, contrast(c.surface, c.inputBorder) >= 1.5, contrast(c.surface, c.inputBorder).toFixed(2));
  check(`${scheme}: unread dot (danger) on the card`, contrast(c.danger, c.surface) >= LARGE, contrast(c.danger, c.surface).toFixed(2));
  check(`${scheme}: chevron (textMuted) on the card`, contrast(c.textMuted, c.surface) >= LARGE);
  check(`${scheme}: drawer title / items (text) on the drawer surface`, contrast(c.text, c.surface) >= BODY);
  check(`${scheme}: drawer selected row text (text) on surfaceMuted`, contrast(c.text, c.surfaceMuted) >= BODY);
  check(`${scheme}: drawer selected check (primaryText) on surfaceMuted`, contrast(c.primaryText, c.surfaceMuted) >= LARGE, contrast(c.primaryText, c.surfaceMuted).toFixed(2));
  check(`${scheme}: budget notification glyph (expense) on its disc`, contrast(c.expense, solid(c.expenseWash, c.surface)) >= LARGE, contrast(c.expense, solid(c.expenseWash, c.surface)).toFixed(2));
  check(`${scheme}: info notification glyph (netGlyph) on its disc`, contrast(c.netGlyph, solid(c.netDisc, c.surface)) >= LARGE, contrast(c.netGlyph, solid(c.netDisc, c.surface)).toFixed(2));
  check(`${scheme}: notification link (primaryText) on the card`, contrast(c.primaryText, c.surface) >= BODY, contrast(c.primaryText, c.surface).toFixed(2));
  check(`${scheme}: pressed notification (text) on the screen bg`, contrast(c.text, c.bg) >= BODY);
  const streak = solid(c.streakFill, c.bg);
  const flame = c.streakDisc === 'transparent' ? streak : solid(c.streakDisc, streak);
  check(`${scheme}: journey streak number (text) on the streak fill`, contrast(c.text, streak) >= BODY, contrast(c.text, streak).toFixed(2));
  check(`${scheme}: journey streak labels (streakMuted) on the streak fill`, contrast(c.streakMuted, streak) >= BODY, contrast(c.streakMuted, streak).toFixed(2));
  check(`${scheme}: journey flame (streakAccent) on its disc`, contrast(c.streakAccent, flame) >= LARGE, contrast(c.streakAccent, flame).toFixed(2));
  check(`${scheme}: journey income growth glyph (incomeGlyph) on its disc`, contrast(c.incomeGlyph, solid(c.incomeDisc, c.surface)) >= LARGE, contrast(c.incomeGlyph, solid(c.incomeDisc, c.surface)).toFixed(2));
  check(`${scheme}: journey income / expense / set-aside values on the card`, Math.min(contrast(c.income, c.surface), contrast(c.expense, c.surface), contrast(c.goals, c.surface)) >= BODY, Math.min(contrast(c.income, c.surface), contrast(c.expense, c.surface), contrast(c.goals, c.surface)).toFixed(2));
  check(`${scheme}: milestone bullet (primary) on the card (graphic)`, contrast(c.primary, c.surface) >= 2.5 || scheme === 'light', contrast(c.primary, c.surface).toFixed(2));
}

// ---- 1h. Recurring, Budgets, Categories, Exchange rates, Origin, Export / Restore (Phase 4f) -------------------------------------
// Every pair the migrated screens draw. Text is held to 4.5:1; glyphs and graphics (progress fills against their track, icons, edges) to 3:1.
console.log('\nPhase 4f: rules, budgets, categories, rates, origin, export');
for (const scheme of ['light', 'dark'] as ThemeScheme[]) {
  const c = palettes[scheme];
  const disc = (tint: string, base: string) => solid(tint, base);
  const text: [string, string, string][] = [
    // Recurring
    ['rule amount (income) on its card', c.income, c.surface],
    ['rule amount (expense) on its card', c.expense, c.surface],
    ['rule meta (textMuted) on its card', c.textMuted, c.surface],
    ['sheet label (textMuted) on the sheet', c.textMuted, c.surface],
    ['category dropdown text (text) on the field (bg)', c.text, c.bg],
    ['category dropdown placeholder (textMuted) on the field (bg)', c.textMuted, c.bg],
    ['selected category check (primaryText) on the list (bg)', c.primaryText, c.bg],
    ['pressed option text (text) on surfaceMuted', c.text, c.surfaceMuted],
    // Budgets: the figure, the status words and the over-limit text, each on the card and on its pressed fill
    ['budget percent / on-track status (income) on the card', c.income, c.surface],
    ['budget close-to-limit (primaryText) on the card', c.primaryText, c.surface],
    ['budget over-limit (expense) on the card', c.expense, c.surface],
    ['budget spent line (textMuted) on the card', c.textMuted, c.surface],
    // Errors in place: on the sheet / card surface, and on the screen (Origin)
    ['in-place error (expense) on the sheet or card', c.expense, c.surface],
    ['in-place error (expense) on the screen (Origin)', c.expense, c.bg],
    // Categories
    ['category name (text) on its card', c.text, c.surface],
    ['category usage (textMuted) on its card', c.textMuted, c.surface],
    ['category section title (textMuted) on the screen', c.textMuted, c.bg],
    ['pencil / row text (text) on the pressed row (surfaceMuted)', c.text, c.surfaceMuted],
    // Exchange rates
    ['rate success message (income) on its card', c.income, c.surface],
    ['rate label (text) on its card', c.text, c.surface],
    ['rate helper (textMuted) on its card', c.textMuted, c.surface],
    ['rate field text (text) on the field (bg)', c.text, c.bg],
    // Origin / Export
    ['origin question label (textMuted) on its card', c.textMuted, c.surface],
    ['origin intro (textMuted) on the screen', c.textMuted, c.bg],
    ['restore button label (onDanger) on the danger fill', c.onDanger, c.danger],
    ['CSV / secondary button label (text) on surfaceMuted', c.text, c.surfaceMuted],
    ['export description (textMuted) on its card', c.textMuted, c.surface],
  ];
  for (const [name, fg, bg] of text) {
    check(`${scheme}: ${name}`, contrast(fg, bg) >= BODY, contrast(fg, bg).toFixed(2));
  }
  const graphics: [string, string, string][] = [
    // Progress fills against their track (3:1): on track, close, over
    ['budget bar fill (income) on its track (surfaceMuted)', c.income, c.surfaceMuted],
    ['budget bar fill (primaryText) on its track (surfaceMuted)', c.primaryText, c.surfaceMuted],
    ['budget bar fill (expense) on its track (surfaceMuted)', c.expense, c.surfaceMuted],
    ['budget status icons (income) on the card', c.income, c.surface],
    ['budget status icon (primaryText) on the card', c.primaryText, c.surface],
    ['budget status icon (expense) on the card', c.expense, c.surface],
    ['over-limit card edge (expense) on the screen', c.expense, c.bg],
    ['delete icon (expense) on its card', c.expense, c.surface],
    ['delete icon (expense) on the pressed fill', c.expense, c.surfaceMuted],
    ['rule switch off-track (inputBorder) on its card', c.inputBorder, c.surface],
    ['rule switch on-thumb (onPrimary) on the on-track (primary)', c.onPrimary, c.primary],
    ['selected icon edge (text) on its fill (accentDisc over the sheet)', c.text, disc(c.accentDisc, c.surface)],
    ['icon check badge (surface) on the badge (text)', c.surface, c.text],
    ['sheet close icon (textMuted) on the sheet', c.textMuted, c.surface],
    ['success check (income) on its card', c.income, c.surface],
    ['restore warning glyph (expenseGlyph) on its pale disc', c.expenseGlyph, disc(c.expenseDisc, c.surface)],
    ['export glyph (primaryText) on its pale disc', c.primaryText, disc(c.accentDisc, c.surface)],
  ];
  for (const [name, fg, bg] of graphics) {
    check(`${scheme}: ${name}`, contrast(fg, bg) >= LARGE, contrast(fg, bg).toFixed(2));
  }
}

// ---- 2. chart palette -----------------------------------------------------------------------------------------------
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


// ---- 1g. Accounts (Phase 5B) -------------------------------------------------------------------------------------------------
// Account type colours (Cash gold, Wallet orange, Bank teal). The icon is a glyph on a pale disc (graphic, 3:1); the dot beside a name is
// decorative (the name says it all) but still held to 3:1 on the card; on the navy Total Balance card the dots use the lightened hero set.
// The "reserved for goals" pill is primaryText on the pale orange disc over the card. Account names, balances, the type label and the
// "Rate last updated" note are the ordinary text pairs checked at the top (text / textMuted on surface and bg).
console.log('\nAccounts: type glyph on its pale disc, type dots, hero dots, the reserved pill');
for (const scheme of ['light', 'dark'] as ThemeScheme[]) {
  const c = palettes[scheme];
  for (const type of ['cash', 'wallet', 'bank'] as const) {
    const tokens = accountColors(c, type);
    const disc = solid(tokens.disc, c.surface);
    const glyph = contrast(tokens.glyph, disc);
    console.log(`  ${scheme.padEnd(5)} ${(type + ' glyph on its disc').padEnd(28)} ${glyph.toFixed(2).padStart(6)}  (>= 3)${glyph >= 3 ? '' : '   <-- FAIL'}`);
    check(`${scheme}: ${type} glyph on its disc`, glyph >= LARGE, glyph.toFixed(2));
    for (const against of ['surface', 'bg'] as const) {
      const dot = contrast(tokens.dot, c[against]);
      console.log(`  ${scheme.padEnd(5)} ${(type + ' dot on ' + against).padEnd(28)} ${dot.toFixed(2).padStart(6)}  (>= 3)${dot >= 3 ? '' : '   <-- FAIL'}`);
      check(`${scheme}: ${type} dot on ${against}`, dot >= LARGE, dot.toFixed(2));
    }
    const heroDot = contrast(accountHeroDots[type], c.heroBg);
    console.log(`  ${scheme.padEnd(5)} ${(type + ' dot on the hero card').padEnd(28)} ${heroDot.toFixed(2).padStart(6)}  (>= 3)${heroDot >= 3 ? '' : '   <-- FAIL'}`);
    check(`${scheme}: ${type} dot on the hero card`, heroDot >= LARGE, heroDot.toFixed(2));
    check(`${scheme}: the stored ${type} colour is the brand fill`, accountFills[type] === accountColour(type));
  }
  const reservedPill = contrast(c.primaryText, solid(withAlpha('#F47C20', 0.14), c.surface));
  console.log(`  ${scheme.padEnd(5)} reserved pill text on its tint      ${reservedPill.toFixed(2).padStart(6)}  (>= ${BODY})${reservedPill >= BODY ? '' : '   <-- FAIL'}`);
  check(`${scheme}: "reserved for goals" pill text on its tint`, reservedPill >= BODY, reservedPill.toFixed(2));
}
check('the three account types have three different colours', new Set(Object.values(accountFills)).size === 3);
check('light and dark glyph colours differ per type (each tuned to its own surface)', (['cash', 'wallet', 'bank'] as const).every((t) => accountColors(palettes.light, t).glyph !== accountColors(palettes.dark, t).glyph));

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
