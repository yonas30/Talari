import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AccessibilityInfo, BackHandler, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import Animated, {
  Easing,
  ReduceMotion,
  cancelAnimation,
  useAnimatedStyle,
  useDerivedValue,
  useSharedValue,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';
import * as SplashScreen from 'expo-splash-screen';
import Svg, { Circle, Path } from 'react-native-svg';

import {
  SYMBOL_ASPECT,
  SYMBOL_DOT,
  SYMBOL_PATHS,
  SYMBOL_VIEWBOX,
  WORDMARK_ASPECT,
  WORDMARK_DOTS,
  WORDMARK_LETTERS,
  WORDMARK_VIEWBOX,
} from '../assets/brand/talariPaths';
import {
  EXIT_SCALE,
  SCHEDULES,
  SplashFrame,
  SplashMode,
  SkipSnapshot,
  TAGLINE_DURATION,
  TAGLINE_START,
  TaglineFrame,
  skipFrame,
  skipSchedule,
  splashFrame,
  taglineFrame,
} from '../utils/splashTimeline';

const ORANGE = '#F47C20';
const WHITE = '#FFFFFF';
const PEACH = '#FFD9B8';

// Reanimated honours the OS "Reduce motion / Remove animations" setting by default: every withTiming then JUMPS to its
// end value. That is exactly what the reduced-motion version must not do (it is the one that has to show the still
// symbol for 0.8 s before fading), so the splash clock opts out explicitly.
const LINEAR = { easing: Easing.linear, reduceMotion: ReduceMotion.Never } as const;

type Props = {
  /** The app has finished initialising (database, migrations) and we know whether the lock screen comes first. */
  ready: boolean;
  /** Inter SemiBold is loaded. The tagline waits for it rather than showing a fallback font. */
  fontsLoaded: boolean;
  /** The exit has started: whatever comes next (lock screen, Home) is about to be revealed. */
  onFadeStart?: () => void;
  onFinish: () => void;
};

const SYMBOL_BOX = `${SYMBOL_VIEWBOX.x} ${SYMBOL_VIEWBOX.y} ${SYMBOL_VIEWBOX.width} ${SYMBOL_VIEWBOX.height}`;
const WORDMARK_BOX = `${WORDMARK_VIEWBOX.x} ${WORDMARK_VIEWBOX.y} ${WORDMARK_VIEWBOX.width} ${WORDMARK_VIEWBOX.height}`;
// Index of the wordmark letter (T A L A R I) each dot belongs to.
const DOT_LETTER = [1, 3];
const TAGLINE_WORDS = ['KNOW', 'CONTROL', 'GROW'];

// Tagline metrics (design units, scaled by k). Android adds letter spacing around every glyph, so each word's box is
// given a little extra room on the right - otherwise the last glyph (the wide W of KNOW and GROW) can be cut off by the
// word's mask - and the row is shifted back by half of that room so the tagline stays centred on screen.
function taglineMetrics(k: number) {
  const letterSpacing = 0.22 * 13.5 * k;
  const rightRoom = letterSpacing + 2 * k;
  // Half of the spacing sits on each side of a glyph, so the visual gaps to the dots are reduced by that half.
  const gap = 11 * k - letterSpacing / 2;
  return { letterSpacing, rightRoom, gap, dotMargin: gap - rightRoom };
}

export default function SplashOverlay({ ready, fontsLoaded, onFadeStart, onFinish }: Props) {
  const { width: screenWidth, height: screenHeight } = useWindowDimensions();
  const [mode, setMode] = useState<SplashMode | null>(null);
  const [animationDone, setAnimationDone] = useState(false);
  // Set when the user taps to skip: the time on the master clock at which the skip started.
  const [skipT0, setSkipT0] = useState<number | null>(null);

  const t = useSharedValue(0);
  const tagClock = useSharedValue(0);
  // null = normal timeline; otherwise the frame that was on screen when the user tapped (see skipFrame).
  const snapshot = useSharedValue<SkipSnapshot | null>(null);
  const finishingRef = useRef(false);
  const skippedRef = useRef(false);
  const startedAtRef = useRef(0);
  const skipRef = useRef<() => void>(() => undefined);

  // Everything is laid out from the 390 x 844 design: sizes scale with width, and the vertical centre keeps its
  // proportional position (400 / 844) so the lockup sits where the design puts it on taller or shorter phones.
  const geometry = useMemo(() => {
    const k = screenWidth / 390;
    const centreX = screenWidth / 2;
    const centreY = (screenHeight * 400) / 844;
    const x = (designX: number) => centreX + (designX - 195) * k;
    const symbolWidth = 150 * k;
    const symbolHeight = symbolWidth * SYMBOL_ASPECT;
    const wordmarkWidth = 200 * k;
    return {
      k,
      centreX,
      centreY,
      symbolWidth,
      symbolHeight,
      dockShift: x(86) - centreX,
      dockScale: 92 / 150,
      wordmarkLeft: x(150),
      wordmarkWidth,
      wordmarkHeight: wordmarkWidth * WORDMARK_ASPECT,
      taglineTop: centreY + 70 * k,
      dotOrigin: [
        ((SYMBOL_DOT.cx - SYMBOL_VIEWBOX.x) / SYMBOL_VIEWBOX.width) * symbolWidth,
        ((SYMBOL_DOT.cy - SYMBOL_VIEWBOX.y) / SYMBOL_VIEWBOX.height) * symbolHeight,
        0,
      ] as [number, number, number],
    };
  }, [screenWidth, screenHeight]);
  const { k } = geometry;

  // ---- decide which version to play: the full one, or the still one when the OS asks for reduced motion ---------------
  // (On Android "Remove animations" sets the transition animation scale to 0, which is what this reports.)
  useEffect(() => {
    let cancelled = false;
    AccessibilityInfo.isReduceMotionEnabled()
      .catch(() => false)
      .then((reduceMotion) => {
        if (!cancelled) {
          setMode(reduceMotion ? 'reduced' : 'full');
        }
      });
    // If the user switches reduced motion on while the splash is already playing, finish quickly rather than keep moving.
    const subscription = AccessibilityInfo.addEventListener('reduceMotionChanged', (enabled) => {
      if (enabled) {
        skipRef.current();
      }
    });
    return () => {
      cancelled = true;
      subscription.remove();
    };
  }, []);

  // Android Back / back gesture do nothing while the splash is up.
  useEffect(() => {
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => true);
    return () => subscription.remove();
  }, []);

  // The native splash stays up (plain orange) until the mode is known and the first overlay frame is drawn, so the
  // handover is orange -> orange. The timer is a safety net: never leave the native splash up forever.
  useEffect(() => {
    const safety = setTimeout(() => SplashScreen.hide(), 1500);
    if (mode) {
      const frame = requestAnimationFrame(() => SplashScreen.hide());
      return () => {
        clearTimeout(safety);
        cancelAnimationFrame(frame);
      };
    }
    return () => clearTimeout(safety);
  }, [mode]);

  const onHoldReached = useCallback(() => setAnimationDone(true), []);
  const onFinished = useCallback(() => onFinish(), [onFinish]);

  // Runs the master clock linearly to `to` over `seconds` and calls `onDone` (on the JS thread) when it gets there.
  const animateTo = useCallback(
    (to: number, seconds: number, onDone: () => void) => {
      t.set(
        withTiming(to, { duration: seconds * 1000, ...LINEAR }, (finished) => {
          'worklet';
          if (finished) {
            scheduleOnRN(onDone);
          }
        }),
      );
    },
    [t],
  );

  // ---- run the clock up to the hold point --------------------------------------------------------------------------
  useEffect(() => {
    if (!mode) {
      return;
    }
    const schedule = SCHEDULES[mode];
    startedAtRef.current = Date.now();
    animateTo(schedule.holdAt, schedule.holdAt, onHoldReached);
    return () => cancelAnimation(t);
  }, [mode, t, animateTo, onHoldReached]);

  // Hold point reached + app ready (store loaded, lock state known) -> run the exit. If the app is slower, the splash
  // simply stays on its last frame until it is, and the biometric prompt (see onFadeStart) waits for the same moment.
  useEffect(() => {
    if (!mode || !animationDone || !ready || finishingRef.current) {
      return;
    }
    finishingRef.current = true;
    const schedule = skipT0 === null ? SCHEDULES[mode] : skipSchedule(skipT0);
    onFadeStart?.();
    animateTo(schedule.end, schedule.end - schedule.holdAt, onFinished);
  }, [mode, animationDone, ready, skipT0, animateTo, onFinished, onFadeStart]);

  // ---- tagline clock: starts at 2.45 s, but never before Inter is loaded --------------------------------------------
  useEffect(() => {
    if (mode !== 'full' || !fontsLoaded || skippedRef.current) {
      return;
    }
    const wait = Math.max(0, TAGLINE_START * 1000 - (Date.now() - startedAtRef.current));
    const timer = setTimeout(() => {
      if (!skippedRef.current) {
        tagClock.set(withTiming(TAGLINE_DURATION, { duration: TAGLINE_DURATION * 1000, ...LINEAR }));
      }
    }, wait);
    return () => clearTimeout(timer);
  }, [mode, fontsLoaded, tagClock]);

  // ---- tap to skip -------------------------------------------------------------------------------------------------
  const skip = () => {
    if (!mode || skippedRef.current || finishingRef.current) {
      return;
    }
    const schedule = SCHEDULES[mode];
    const now = t.get();
    if (now >= schedule.holdAt) {
      return; // already at the end of the animation; the exit starts as soon as the app is ready
    }
    skippedRef.current = true;
    cancelAnimation(t);
    cancelAnimation(tagClock);
    if (mode === 'reduced') {
      // Nothing moves in this version: go straight to the point where it waits for the app, then crossfade.
      t.set(schedule.holdAt);
      setAnimationDone(true);
      return;
    }
    // Freeze what is on screen right now and continue from it (see skipFrame): no jump to a later point of the timeline.
    const skipPlan = skipSchedule(now);
    snapshot.set({ ...splashFrame(now, 'full'), t0: now });
    setSkipT0(now);
    animateTo(skipPlan.holdAt, skipPlan.holdAt - now, onHoldReached);
  };
  useEffect(() => {
    skipRef.current = skip;
  });

  // ---- per-frame values (UI thread) --------------------------------------------------------------------------------
  const activeMode: SplashMode = mode ?? 'full';
  const frame = useDerivedValue(() => {
    const from = snapshot.value;
    return from ? skipFrame(t.value, from) : splashFrame(t.value, activeMode);
  });
  const tagFrame = useDerivedValue(() => taglineFrame(tagClock.value));

  const overlayStyle = useAnimatedStyle(() => ({ opacity: frame.value.overlay }));
  // The whole lockup leaves together: it fades and grows slightly about the screen centre (the wrapper's own centre).
  const contentStyle = useAnimatedStyle(() => ({
    opacity: 1 - frame.value.exit,
    transform: [{ scale: 1 + EXIT_SCALE * frame.value.exit }],
  }));
  const lockStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: geometry.dockShift * frame.value.lock },
      { scale: 1 + (geometry.dockScale - 1) * frame.value.lock },
    ],
  }));
  const stemStyle = useAnimatedStyle(() => ({
    opacity: frame.value.stem.o,
    transform: [{ translateY: frame.value.stem.dy * k }],
  }));
  const bandStyle = useAnimatedStyle(() => ({
    opacity: frame.value.band.o,
    transform: [{ translateX: frame.value.band.dx * k }],
  }));
  const leglStyle = useAnimatedStyle(() => ({
    opacity: frame.value.legl.o,
    transform: [{ translateX: frame.value.legl.dx * k }, { translateY: frame.value.legl.dy * k }],
  }));
  const legrStyle = useAnimatedStyle(() => ({
    opacity: frame.value.legr.o,
    transform: [{ translateX: frame.value.legr.dx * k }, { translateY: frame.value.legr.dy * k }],
  }));
  const dotStyle = useAnimatedStyle(() => ({ transform: [{ scale: frame.value.dotScale }] }));

  const wordmarkHeight = geometry.wordmarkHeight;
  const taglineLine = Math.round(13.5 * k * 1.45);
  const symbolLeft = geometry.centreX - geometry.symbolWidth / 2;
  const symbolTop = geometry.centreY - geometry.symbolHeight / 2;

  return (
    <Animated.View
      style={[StyleSheet.absoluteFill, styles.overlay, overlayStyle]}
      onTouchStart={skip}
      // Swallow everything underneath for as long as the overlay exists.
      pointerEvents="auto"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      {mode && (
        <Animated.View style={[StyleSheet.absoluteFill, contentStyle]}>
          <Animated.View
            style={[
              styles.absolute,
              { left: symbolLeft, top: symbolTop, width: geometry.symbolWidth, height: geometry.symbolHeight },
              lockStyle,
            ]}
          >
            <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, stemStyle]}>
              <Svg width="100%" height="100%" viewBox={SYMBOL_BOX}>
                <Path d={SYMBOL_PATHS.stem} fill={WHITE} />
              </Svg>
            </Animated.View>
            <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, bandStyle]}>
              <Svg width="100%" height="100%" viewBox={SYMBOL_BOX}>
                <Path d={SYMBOL_PATHS.band} fill={WHITE} />
              </Svg>
            </Animated.View>
            <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, leglStyle]}>
              <Svg width="100%" height="100%" viewBox={SYMBOL_BOX}>
                <Path d={SYMBOL_PATHS.legl} fill={WHITE} />
              </Svg>
            </Animated.View>
            <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, legrStyle]}>
              <Svg width="100%" height="100%" viewBox={SYMBOL_BOX}>
                <Path d={SYMBOL_PATHS.legr} fill={WHITE} />
              </Svg>
            </Animated.View>
            <Animated.View
              pointerEvents="none"
              style={[StyleSheet.absoluteFill, { transformOrigin: geometry.dotOrigin }, dotStyle]}
            >
              <Svg width="100%" height="100%" viewBox={SYMBOL_BOX}>
                <Circle cx={SYMBOL_DOT.cx} cy={SYMBOL_DOT.cy} r={SYMBOL_DOT.r} fill={PEACH} />
              </Svg>
            </Animated.View>
          </Animated.View>

          {mode === 'full' && (
            <>
              <View
                pointerEvents="none"
                style={[
                  styles.absolute,
                  {
                    left: geometry.wordmarkLeft,
                    top: geometry.centreY - wordmarkHeight / 2,
                    width: geometry.wordmarkWidth,
                    height: wordmarkHeight,
                  },
                ]}
              >
                {WORDMARK_LETTERS.map((letterPath, index) => (
                  <RisingLetter key={index} frame={frame} index={index} path={letterPath} height={wordmarkHeight} />
                ))}
              </View>

              {fontsLoaded && (
                <View
                  pointerEvents="none"
                  style={[
                    styles.tagline,
                    { top: geometry.taglineTop, gap: taglineMetrics(k).gap, transform: [{ translateX: taglineMetrics(k).rightRoom / 2 }] },
                  ]}
                >
                  {TAGLINE_WORDS.map((word, index) => (
                    <TaglineItem
                      key={word}
                      tagFrame={tagFrame}
                      index={index}
                      word={word}
                      k={k}
                      line={taglineLine}
                      showDot={index < TAGLINE_WORDS.length - 1}
                    />
                  ))}
                </View>
              )}
            </>
          )}
        </Animated.View>
      )}
    </Animated.View>
  );
}

type FrameValue = SharedValue<SplashFrame>;

// One wordmark letter. It rises from below inside its own mask (overflow hidden) so it appears from an invisible line.
function RisingLetter({ frame, index, path, height }: { frame: FrameValue; index: number; path: string; height: number }) {
  const style = useAnimatedStyle(() => ({ transform: [{ translateY: (1 - frame.value.letters[index]) * height }] }));
  return (
    <View style={[StyleSheet.absoluteFill, styles.mask]}>
      <Animated.View style={[StyleSheet.absoluteFill, style]}>
        <Svg width="100%" height="100%" viewBox={WORDMARK_BOX}>
          {/* R has a counter (the hole in the bowl) - evenodd keeps it open. */}
          <Path d={path} fill={WHITE} fillRule="evenodd" />
          {DOT_LETTER.map((letterIndex, dotIndex) =>
            letterIndex === index ? (
              <Circle
                key={dotIndex}
                cx={WORDMARK_DOTS[dotIndex].cx}
                cy={WORDMARK_DOTS[dotIndex].cy}
                r={WORDMARK_DOTS[dotIndex].r}
                fill={PEACH}
              />
            ) : null,
          )}
        </Svg>
      </Animated.View>
    </View>
  );
}

function TaglineItem({
  tagFrame,
  index,
  word,
  k,
  line,
  showDot,
}: {
  tagFrame: SharedValue<TaglineFrame>;
  index: number;
  word: string;
  k: number;
  line: number;
  showDot: boolean;
}) {
  const { letterSpacing, rightRoom, dotMargin } = taglineMetrics(k);
  const wordStyle = useAnimatedStyle(() => ({ transform: [{ translateY: (1 - tagFrame.value.words[index]) * line }] }));
  const dotStyle = useAnimatedStyle(() => ({ transform: [{ scale: tagFrame.value.dots[Math.min(index, 1)] }] }));
  return (
    <View style={styles.taglineItem}>
      <View style={[styles.mask, { height: line }]}>
        <Animated.View style={wordStyle}>
          <Text
            // Fixed size on purpose: the splash is a logo, so system font scaling must not resize it.
            allowFontScaling={false}
            numberOfLines={1}
            style={[
              styles.taglineText,
              {
                fontSize: 13.5 * k,
                lineHeight: line,
                letterSpacing,
                paddingRight: rightRoom,
              },
            ]}
          >
            {word}
          </Text>
        </Animated.View>
      </View>
      {showDot && (
        <Animated.View
          style={[
            { width: 5 * k, height: 5 * k, borderRadius: 2.5 * k, backgroundColor: PEACH, marginLeft: dotMargin },
            dotStyle,
          ]}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    backgroundColor: ORANGE,
    // Above the router, the drawer and every modal-less screen.
    zIndex: 1000,
    elevation: 1000,
  },
  absolute: {
    position: 'absolute',
  },
  mask: {
    overflow: 'hidden',
  },
  tagline: {
    position: 'absolute',
    left: 0,
    right: 0,
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
  },
  taglineItem: {
    flexDirection: 'row',
    alignItems: 'center',
    // Never squeeze a word on a narrow screen: a squeezed word would clip its last glyph.
    flexShrink: 0,
  },
  taglineText: {
    color: WHITE,
    fontFamily: 'Inter_600SemiBold',
    includeFontPadding: false,
  },
});
