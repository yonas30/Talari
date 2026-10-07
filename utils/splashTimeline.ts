// Timeline of the in-app splash animation as pure functions of time, so the same numbers drive the UI-thread
// animation (Reanimated worklets) and the Node checks in scripts/verify-splash.ts. All offsets are in the 390 x 844
// design space; the component multiplies them by screenWidth / 390.
//
// Why one clock instead of many independent animations: a single `t` can be jumped (tap to skip), held (app not
// ready yet) and resumed without any animation getting out of step with the others.

// 'full' is the one timeline every cold start plays; 'reduced' is the still version for the OS Reduce Motion setting.
export type SplashMode = 'full' | 'reduced';

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
  /** Exit progress of the whole lockup: opacity is 1 - exit, scale is 1 + EXIT_SCALE * exit. */
  exit: number;
  /** Opacity of the orange overlay itself. */
  overlay: number;
};

export type SplashSchedule = {
  /** Time at which the animation waits for the app (everything is on screen, nothing has started to leave). */
  holdAt: number;
  /** End of the overlay fade-out. */
  end: number;
};

export const SCHEDULES: Record<SplashMode, SplashSchedule> = {
  full: { holdAt: 3.7, end: 4.5 },
  reduced: { holdAt: 0.8, end: 1.05 },
};

// Exit of the full timeline: the lockup fades and grows slightly (about the screen centre), then the orange follows.
export const EXIT_START = 3.7;
export const EXIT_END = 4.5;
export const OVERLAY_FADE_START = 3.9;
export const EXIT_SCALE = 0.06;

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

function easeOut(p: number): number {
  'worklet';
  return cubicBezier(0, 0, 0.58, 1, p);
}

// Standard "ease" used by the exit.
function easeExit(p: number): number {
  'worklet';
  return cubicBezier(0.4, 0, 0.2, 1, p);
}

export function splashFrame(t: number, mode: SplashMode): SplashFrame {
  'worklet';
  const full = mode === 'full';

  // Build-up. In the reduced version the finished symbol is simply there from the first frame.
  const stemP = full ? easeSoft(seg(t, 0.15, 0.6)) : 1;
  const leglP = full ? easeSoft(seg(t, 0.35, 0.8)) : 1;
  const bandP = full ? easeSoft(seg(t, 0.6, 1.05)) : 1;
  const legrP = full ? easeSoft(seg(t, 0.85, 1.3)) : 1;
  let dotScale = 1;
  if (full) {
    dotScale = t < 1.3 ? 1.25 * easeOut(seg(t, 1.15, 1.3)) : 1.25 - 0.25 * easeOut(seg(t, 1.3, 1.45));
  }

  const lock = full ? easeMove(seg(t, 1.6, 2.15)) : 0;
  const letters: number[] = [];
  for (let i = 0; i < 6; i += 1) {
    const start = 1.9 + 0.06 * i;
    letters.push(full ? easeSoft(seg(t, start, start + 0.45)) : 0);
  }

  return {
    stem: { o: stemP, dy: -26 * (1 - stemP) },
    legl: { o: leglP, dx: -18 * (1 - leglP), dy: 26 * (1 - leglP) },
    band: { o: bandP, dx: -46 * (1 - bandP) },
    legr: { o: legrP, dx: 18 * (1 - legrP), dy: 26 * (1 - legrP) },
    dotScale,
    lock,
    letters,
    exit: full ? easeExit(seg(t, EXIT_START, EXIT_END)) : 0,
    // Full: orange fades 3.90-4.50 (it starts once the lockup is already leaving). Reduced: a plain 0.25 s crossfade.
    overlay: full ? 1 - easeExit(seg(t, OVERLAY_FADE_START, EXIT_END)) : 1 - seg(t, SCHEDULES.reduced.holdAt, SCHEDULES.reduced.end),
  };
}

// Tagline: KNOW . CONTROL . GROW. Its own clock `c` (seconds since the tagline started) so that it can wait for the
// Inter font without the rest of the timeline waiting. c = 0 is 2.45 s on the timeline.
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

// Tap-to-skip. A tap must not cut: from whatever is on screen at time t0 the lockup fades out over SKIP_FADE seconds
// (as it is, frozen - nothing jumps), then the orange overlay fades over SKIP_OVERLAY.
// Together that is the 0.5 s compressed exit.
export const SKIP_FADE = 0.2;
export const SKIP_OVERLAY = 0.3;

export type SkipSnapshot = SplashFrame & { t0: number };

export function skipSchedule(t0: number): SplashSchedule {
  'worklet';
  return { holdAt: t0 + SKIP_FADE, end: t0 + SKIP_FADE + SKIP_OVERLAY };
}

export function skipFrame(t: number, from: SkipSnapshot): SplashFrame {
  'worklet';
  const c = t - from.t0;
  return {
    // Everything that was on screen stays exactly where it was and only leaves with the normal exit motion.
    ...from,
    exit: easeExit(seg(c, 0, SKIP_FADE)),
    overlay: 1 - easeExit(seg(c, SKIP_FADE, SKIP_FADE + SKIP_OVERLAY)),
  };
}
