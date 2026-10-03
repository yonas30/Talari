// expo-status-bar's `style` is the colour of the ICONS, not the bar: 'dark' = dark icons (for a light
// background), 'light' = light icons (for a dark one). Deriving it from the background colour keeps
// the icons legible if the background ever changes (e.g. the V3 dark mode).

function relativeLuminance(hex: string): number {
  const value = hex.replace('#', '');
  const full = value.length === 3 ? value.split('').map((c) => c + c).join('') : value;
  const channel = (offset: number) => {
    const srgb = parseInt(full.slice(offset, offset + 2), 16) / 255;
    return srgb <= 0.03928 ? srgb / 12.92 : ((srgb + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(0) + 0.7152 * channel(2) + 0.0722 * channel(4);
}

export function statusBarStyleForBackground(backgroundHex: string): 'light' | 'dark' {
  // 0.179 is where black and white icons give equal WCAG contrast; darker backgrounds need light icons.
  return relativeLuminance(backgroundHex) < 0.179 ? 'light' : 'dark';
}
