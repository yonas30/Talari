// Timeline of the in-app splash animation as pure functions of time, so the same numbers drive the UI-thread
// animation (Reanimated worklets) and the Node checks in scripts/verify-splash.ts. All offsets are in the 390 x 844
// design space; the component multiplies them by screenWidth / 390.
//
// Why one clock instead of many independent animations: a single `t` can be jumped (tap to skip), held (app not
// ready yet) and resumed without any animation getting out of step with the others.

export type SplashMode = 'first' | 'repeat' | 'reduced';

export type SplashFrame = {
  stem: { o: number; dy: number };
  legl: { o: number; dx: number; dy: number };
  band: { o: number; dx: number };
  legr: { o: number; dx: number; dy: number };
  dotScale: number;
  /** 0 = symbol centred at 150 wide, 1 = docked left at 92 wide. */
  lock: number;
  /** Rise progress of the six wordmark letters, 0 = hidden below its mask. */
  letters: number[];
  /** Opacity of everything except the band. */
  others: number;
  /** Scale of the zoom into the band. */
  zoom: number;
  /** 0 = white band, 1 = band in the app background colour. */
  bandMix: number;
  /** Opacity of the full-screen app-background layer. */
  cover: number;
  /** Opacity of the whole overlay. */
  overlay: number;
};

export type SplashSchedule = {
  /** Time at which the animation is complete and waits for the app (the cover layer is fully opaque here). */
  holdAt: number;
  /** End of the overlay fade-out. */
  end: number;
  /** When the zoom starts (first launch: also where tap-to-skip jumps to). */
  zoomStart: number;
};

export const SCHEDULES: Record<SplashMode, SplashSchedule> = {
  first: { holdAt: 4.9, end: 5.25, zoomStart: 3.7 },
  repeat: { holdAt: 1.3, end: 1.55, zoomStart: 0.4 },
  reduced: { holdAt: 0.6, end: 0.85, zoomStart: 0.6 },
};

// The full zoom is ~150x. Scaling that far is heavy and gains nothing: by ~60x the band already fills the screen
// and the app-background cover layer takes over, so the zoom is capped here.
export const ZOOM_CAP = 60;

function clamp01(value: number): number {
  'worklet';
  return value < 0 ? 0 : value > 1 ? 1 : value;
}

// Linear 0..1 progress of t between a and b.
function seg(t: number, a: number, b: number): number {
  'worklet';
  return clamp01((t - a) / (b - a));
}

// CSS-style cubic-bezier(x1, y1, x2, y2) evaluated at x (time fraction), found by bisection on the x curve.
export function cubicBezier(x1: number, y1: number, x2: number, y2: number, x: number): number {
  'worklet';
  if (x <= 0) {
    return 0;
  }
  if (x >= 1) {
    return 1;
  }
  let lo = 0;
  let hi = 1;
  let s = x;
  for (let i = 0; i < 32; i += 1) {
    const inv = 1 - s;
    const cx = 3 * inv * inv * s * x1 + 3 * inv * s * s * x2 + s * s * s;
    if (Math.abs(cx - x) < 1e-6) {
      break;
    }
    if (cx < x) {
      lo = s;
    } else {
      hi = s;
    }
    s = (lo + hi) / 2;
  }
  const inv = 1 - s;
  return 3 * inv * inv * s * y1 + 3 * inv * s * s * y2 + s * s * s;
}

function easeSoft(p: number): number {
  'worklet';
  return cubicBezier(0.2, 0.8, 0.2, 1, p);
}

function easeMove(p: number): number {
  'worklet';
  return cubicBezier(0.65, 0, 0.25, 1, p);
}

function easeZoom(p: number): number {
  'worklet';
  return cubicBezier(0.55, 0.05, 0.9, 0.5, p);
}

function easeOut(p: number): number {
  'worklet';
  return cubicBezier(0, 0, 0.58, 1, p);
}

// Start/end times (seconds) of the zoom-out phase fades, per mode.
function exitTimes(mode: SplashMode) {
  'worklet';
  if (mode === 'first') {
    return { fade: [3.7, 4.15], zoom: [3.7, 4.9], tween: [4.1, 4.9], cover: [4.5, 4.9], overlay: [4.9, 5.25] };
  }
  if (mode === 'repeat') {
    return { fade: [0.4, 0.75], zoom: [0.4, 1.3], tween: [0.5, 1.2], cover: [0.9, 1.3], overlay: [1.3, 1.55] };
  }
  // Reduced motion: no zoom, no fade of parts - only the final crossfade into the app.
  return { fade: [9, 10], zoom: [9, 10], tween: [9, 10], cover: [9, 10], overlay: [0.6, 0.85] };
}

export function splashFrame(t: number, mode: SplashMode): SplashFrame {
  'worklet';
  const exit = exitTimes(mode);
  const built = mode !== 'first';

  // Build-up (first launch only). In the other modes the symbol is simply there from the first frame.
  const stemP = built ? 1 : easeSoft(seg(t, 0.15, 0.6));
  const leglP = built ? 1 : easeSoft(seg(t, 0.35, 0.8));
  const bandP = built ? 1 : easeSoft(seg(t, 0.6, 1.05));
  const legrP = built ? 1 : easeSoft(seg(t, 0.85, 1.3));
  let dotScale = 1;
  if (!built) {
    dotScale = t < 1.3 ? 1.25 * easeOut(seg(t, 1.15, 1.3)) : 1.25 - 0.25 * easeOut(seg(t, 1.3, 1.45));
  }

  const lock = mode === 'first' ? easeMove(seg(t, 1.6, 2.15)) : 0;
  const letters: number[] = [];
  for (let i = 0; i < 6; i += 1) {
    const start = 1.9 + 0.06 * i;
    letters.push(mode === 'first' ? easeSoft(seg(t, start, start + 0.45)) : 0);
  }

  const zoomP = easeZoom(seg(t, exit.zoom[0], exit.zoom[1]));

  return {
    stem: { o: stemP, dy: -26 * (1 - stemP) },
    legl: { o: leglP, dx: -18 * (1 - leglP), dy: 26 * (1 - leglP) },
    band: { o: bandP, dx: -46 * (1 - bandP) },
    legr: { o: legrP, dx: 18 * (1 - legrP), dy: 26 * (1 - legrP) },
    dotScale,
    lock,
    letters,
    others: 1 - seg(t, exit.fade[0], exit.fade[1]),
    // Geometric interpolation: equal time steps give equal zoom *ratios*, which is how a camera push-in reads.
    zoom: Math.exp(Math.log(ZOOM_CAP) * zoomP),
    bandMix: seg(t, exit.tween[0], exit.tween[1]),
    cover: seg(t, exit.cover[0], exit.cover[1]),
    overlay: 1 - seg(t, exit.overlay[0], exit.overlay[1]),
  };
}

// Tagline: KNOW . CONTROL . GROW. Its own clock `c` (seconds since the tagline started) so that it can wait for the
// Inter font without the rest of the timeline waiting. c = 0 is 2.45 s on the first-launch timeline.
export const TAGLINE_DURATION = 0.8;
export const TAGLINE_START = 2.45;

export type TaglineFrame = { words: number[]; dots: number[] };

export function taglineFrame(c: number): TaglineFrame {
  'worklet';
  return {
    words: [easeSoft(seg(c, 0, 0.4)), easeSoft(seg(c, 0.2, 0.6)), easeSoft(seg(c, 0.4, 0.8))],
    dots: [easeSoft(seg(c, 0.25, 0.5)), easeSoft(seg(c, 0.45, 0.7))],
  };
}

// Tap-to-skip. A tap must not cut: from whatever is on screen at time t0 the parts fade out over SKIP_FADE seconds
// (a band that has not appeared yet fades in over the same time), then the zoom and reveal run compressed to
// SKIP_ZOOM seconds - half the speed of the normal 1.2 s zoom, with every sub-phase scaled by the same factor.
export const SKIP_FADE = 0.2;
export const SKIP_ZOOM = 0.6;
const SKIP_OVERLAY_FADE = 0.175;

export type SkipSnapshot = SplashFrame & { t0: number };

export function skipSchedule(t0: number): SplashSchedule {
  'worklet';
  return { holdAt: t0 + SKIP_FADE + SKIP_ZOOM, end: t0 + SKIP_FADE + SKIP_ZOOM + SKIP_OVERLAY_FADE, zoomStart: t0 };
}

export function skipFrame(t: number, from: SkipSnapshot): SplashFrame {
  'worklet';
  const c = t - from.t0;
  const fade = seg(c, 0, SKIP_FADE);
  const z = c - SKIP_FADE;
  return {
    // Everything that was on screen stays exactly where it was and only fades.
    stem: from.stem,
    legl: from.legl,
    legr: from.legr,
    dotScale: from.dotScale,
    lock: from.lock,
    letters: from.letters,
    others: from.others * (1 - fade),
    band: { o: from.band.o + (1 - from.band.o) * fade, dx: from.band.dx * (1 - fade) },
    zoom: Math.exp(Math.log(ZOOM_CAP) * easeZoom(seg(z, 0, SKIP_ZOOM))),
    // Same proportions as the normal 3.70-4.90 zoom: tween over its last two thirds, cover over its last third.
    bandMix: seg(z, SKIP_ZOOM / 3, SKIP_ZOOM),
    cover: seg(z, (2 * SKIP_ZOOM) / 3, SKIP_ZOOM),
    overlay: 1 - seg(c, SKIP_FADE + SKIP_ZOOM, SKIP_FADE + SKIP_ZOOM + SKIP_OVERLAY_FADE),
  };
}
