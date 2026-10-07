import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AccessibilityInfo, BackHandler, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import Animated, {
  Easing,
  cancelAnimation,
  interpolateColor,
  useAnimatedProps,
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
  BAND_CENTER,
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
import { hasSeenIntroSplash, markIntroSplashSeen } from '../utils/splashFlag';

const ORANGE = '#F47C20';
const WHITE = '#FFFFFF';
const PEACH = '#FFD9B8';

// react-native-svg on Android draws an <Svg> into a bitmap the size of the view and then scales THAT bitmap when the
// view is transformed. Zooming a normally-sized band 60x would therefore be a blurry bitmap. The band is drawn at
// this multiple of its on-screen size and shrunk back with a transform, so the first few x of the zoom are sharp.
const BAND_OVERSAMPLE = 1.6;

const AnimatedPath = Animated.createAnimatedComponent(Path);

type Props = {
  /** The colour behind the splash (the screen the user lands on). The band turns into this colour as it grows. */
  appBackground: string;
  /** The app has finished initialising (database, migrations). The overlay holds on its last frame until then. */
  ready: boolean;
  /** Inter SemiBold is loaded. The tagline waits for it rather than showing a fallback font. */
  fontsLoaded: boolean;
  /** The overlay has started its final fade-out: whatever comes next (lock screen, Home) is about to be revealed. */
  onFadeStart?: () => void;
  onFinish: () => void;
};

const SYMBOL_BOX = `${SYMBOL_VIEWBOX.x} ${SYMBOL_VIEWBOX.y} ${SYMBOL_VIEWBOX.width} ${SYMBOL_VIEWBOX.height}`;
const WORDMARK_BOX = `${WORDMARK_VIEWBOX.x} ${WORDMARK_VIEWBOX.y} ${WORDMARK_VIEWBOX.width} ${WORDMARK_VIEWBOX.height}`;
// Index of the wordmark letter (T A L A R I) each dot belongs to.
const DOT_LETTER = [1, 3];
const TAGLINE_WORDS = ['KNOW', 'CONTROL', 'GROW'];

export default function SplashOverlay({ appBackground, ready, fontsLoaded, onFadeStart, onFinish }: Props) {
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
    const wordmarkHeight = wordmarkWidth * WORDMARK_ASPECT;
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
      wordmarkHeight,
      taglineTop: centreY + 70 * k,
      dotOrigin: [
        ((SYMBOL_DOT.cx - SYMBOL_VIEWBOX.x) / SYMBOL_VIEWBOX.width) * symbolWidth,
        ((SYMBOL_DOT.cy - SYMBOL_VIEWBOX.y) / SYMBOL_VIEWBOX.height) * symbolHeight,
        0,
      ] as [number, number, number],
    };
  }, [screenWidth, screenHeight]);
  const { k } = geometry;

  // ---- decide which version to play -------------------------------------------------------------------------------
  useEffect(() => {
    let cancelled = false;
    void Promise.all([hasSeenIntroSplash(), AccessibilityInfo.isReduceMotionEnabled().catch(() => false)]).then(
      ([seen, reduceMotion]) => {
        if (cancelled) {
          return;
        }
        if (reduceMotion) {
          void markIntroSplashSeen();
          setMode('reduced');
        } else {
          setMode(seen ? 'repeat' : 'first');
        }
      },
    );
    return () => {
      cancelled = true;
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
        withTiming(to, { duration: seconds * 1000, easing: Easing.linear }, (finished) => {
          'worklet';
          if (finished) {
            scheduleOnRN(onDone);
          }
        }),
      );
    },
    [t],
  );

  // ---- run the clock ---------------------------------------------------------------------------------------------
  useEffect(() => {
    if (!mode) {
      return;
    }
    const schedule = SCHEDULES[mode];
    startedAtRef.current = Date.now();
    animateTo(schedule.holdAt, schedule.holdAt, onHoldReached);

    // The first-launch flag is set when the zoom begins (or on skip), so quitting mid-intro replays it.
    let flagTimer: ReturnType<typeof setTimeout> | undefined;
    if (mode === 'first') {
      flagTimer = setTimeout(() => void markIntroSplashSeen(), schedule.zoomStart * 1000);
    }
    return () => {
      if (flagTimer) {
        clearTimeout(flagTimer);
      }
      cancelAnimation(t);
    };
  }, [mode, t, animateTo, onHoldReached]);

  // Animation complete + app ready -> fade the overlay away. If the app is slower, the last frame (the app's own
  // background colour) simply stays up until it is.
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
    if (mode !== 'first' || !fontsLoaded || skippedRef.current) {
      return;
    }
    const wait = Math.max(0, TAGLINE_START * 1000 - (Date.now() - startedAtRef.current));
    const timer = setTimeout(() => {
      if (!skippedRef.current) {
        tagClock.set(withTiming(TAGLINE_DURATION, { duration: TAGLINE_DURATION * 1000, easing: Easing.linear }));
      }
    }, wait);
    return () => clearTimeout(timer);
  }, [mode, fontsLoaded, tagClock]);

  // ---- tap to skip (first launch only) -----------------------------------------------------------------------------
  const skip = () => {
    if (mode !== 'first' || skippedRef.current || finishingRef.current) {
      return;
    }
    if (t.get() >= SCHEDULES.first.zoomStart) {
      return;
    }
    skippedRef.current = true;
    void markIntroSplashSeen();
    cancelAnimation(t);
    cancelAnimation(tagClock);
    // Freeze what is on screen right now and continue from it (see skipFrame): no jump to a later point of the timeline.
    const now = t.get();
    const schedule = skipSchedule(now);
    snapshot.set({ ...splashFrame(now, 'first'), t0: now });
    setSkipT0(now);
    animateTo(schedule.holdAt, schedule.holdAt - now, onHoldReached);
  };

  // ---- per-frame values (UI thread) --------------------------------------------------------------------------------
  const activeMode: SplashMode = mode ?? 'repeat';
  const frame = useDerivedValue(() => {
    const from = snapshot.value;
    return from ? skipFrame(t.value, from) : splashFrame(t.value, activeMode);
  });
  const tagFrame = useDerivedValue(() => taglineFrame(tagClock.value));

  const overlayStyle = useAnimatedStyle(() => ({ opacity: frame.value.overlay }));
  // Zoom about the centre of the band wherever it currently is (docked at 92 wide, centred at 150 wide, or anywhere in
  // between when the user skips). A scale about point P with the view's default centre origin C is
  // translate((P - C)(1 - s)) then scale(s).
  const zoomStyle = useAnimatedStyle(() => {
    const { zoom, lock } = frame.value;
    const scale = 1 + (geometry.dockScale - 1) * lock;
    const originX = geometry.centreX + geometry.dockShift * lock + (BAND_CENTER.x - 0.5) * geometry.symbolWidth * scale;
    const originY = geometry.centreY + (BAND_CENTER.y - 0.5) * geometry.symbolHeight * scale;
    return {
      transform: [
        { translateX: (originX - screenWidth / 2) * (1 - zoom) },
        { translateY: (originY - screenHeight / 2) * (1 - zoom) },
        { scale: zoom },
      ],
    };
  });
  const coverStyle = useAnimatedStyle(() => ({ opacity: frame.value.cover }));
  const othersStyle = useAnimatedStyle(() => ({ opacity: frame.value.others }));
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
  const leglStyle = useAnimatedStyle(() => ({
    opacity: frame.value.legl.o,
    transform: [{ translateX: frame.value.legl.dx * k }, { translateY: frame.value.legl.dy * k }],
  }));
  const legrStyle = useAnimatedStyle(() => ({
    opacity: frame.value.legr.o,
    transform: [{ translateX: frame.value.legr.dx * k }, { translateY: frame.value.legr.dy * k }],
  }));
  const dotStyle = useAnimatedStyle(() => ({ transform: [{ scale: frame.value.dotScale }] }));
  const bandStyle = useAnimatedStyle(() => ({
    opacity: frame.value.band.o,
    // Translation is in on-screen design units, but this layer is drawn BAND_OVERSAMPLE times larger and shrunk back.
    transform: [{ translateX: frame.value.band.dx * k * BAND_OVERSAMPLE }],
  }));
  const bandProps = useAnimatedProps(() => ({
    fill: interpolateColor(frame.value.bandMix, [0, 1], [WHITE, appBackground]),
  }));

  const wordmarkHeight = geometry.wordmarkHeight;
  const taglineLine = Math.round(13.5 * k * 1.45);

  const symbolLeft = geometry.centreX - geometry.symbolWidth / 2;
  const symbolTop = geometry.centreY - geometry.symbolHeight / 2;
  const overscan = (BAND_OVERSAMPLE - 1) / 2;

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
        <Animated.View style={[StyleSheet.absoluteFill, zoomStyle]}>
          <Animated.View
            style={[
              styles.absolute,
              { left: symbolLeft, top: symbolTop, width: geometry.symbolWidth, height: geometry.symbolHeight },
              lockStyle,
            ]}
          >
            {/* The band: drawn oversampled (see BAND_OVERSAMPLE), and NOT part of the group that fades out. */}
            <View
              pointerEvents="none"
              style={[
                styles.absolute,
                {
                  left: -geometry.symbolWidth * overscan,
                  top: -geometry.symbolHeight * overscan,
                  width: geometry.symbolWidth * BAND_OVERSAMPLE,
                  height: geometry.symbolHeight * BAND_OVERSAMPLE,
                  transform: [{ scale: 1 / BAND_OVERSAMPLE }],
                },
              ]}
            >
              <Animated.View style={[StyleSheet.absoluteFill, bandStyle]}>
                <Svg width="100%" height="100%" viewBox={SYMBOL_BOX}>
                  <AnimatedPath d={SYMBOL_PATHS.band} animatedProps={bandProps} fill={WHITE} />
                </Svg>
              </Animated.View>
            </View>

            <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, othersStyle]}>
              <Animated.View style={[StyleSheet.absoluteFill, stemStyle]}>
                <Svg width="100%" height="100%" viewBox={SYMBOL_BOX}>
                  <Path d={SYMBOL_PATHS.stem} fill={WHITE} />
                </Svg>
              </Animated.View>
              <Animated.View style={[StyleSheet.absoluteFill, leglStyle]}>
                <Svg width="100%" height="100%" viewBox={SYMBOL_BOX}>
                  <Path d={SYMBOL_PATHS.legl} fill={WHITE} />
                </Svg>
              </Animated.View>
              <Animated.View style={[StyleSheet.absoluteFill, legrStyle]}>
                <Svg width="100%" height="100%" viewBox={SYMBOL_BOX}>
                  <Path d={SYMBOL_PATHS.legr} fill={WHITE} />
                </Svg>
              </Animated.View>
              <Animated.View style={[StyleSheet.absoluteFill, { transformOrigin: geometry.dotOrigin }, dotStyle]}>
                <Svg width="100%" height="100%" viewBox={SYMBOL_BOX}>
                  <Circle cx={SYMBOL_DOT.cx} cy={SYMBOL_DOT.cy} r={SYMBOL_DOT.r} fill={PEACH} />
                </Svg>
              </Animated.View>
            </Animated.View>
          </Animated.View>

          {mode === 'first' && (
            <>
              <Animated.View
                pointerEvents="none"
                style={[
                  styles.absolute,
                  {
                    left: geometry.wordmarkLeft,
                    top: geometry.centreY - wordmarkHeight / 2,
                    width: geometry.wordmarkWidth,
                    height: wordmarkHeight,
                  },
                  othersStyle,
                ]}
              >
                {WORDMARK_LETTERS.map((letterPath, index) => (
                  <RisingLetter key={index} frame={frame} index={index} path={letterPath} height={wordmarkHeight} />
                ))}
              </Animated.View>

              {fontsLoaded && (
                <Animated.View
                  pointerEvents="none"
                  style={[styles.tagline, { top: geometry.taglineTop, gap: 11 * k }, othersStyle]}
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
                </Animated.View>
              )}
            </>
          )}
        </Animated.View>
      )}
      <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: appBackground }, coverStyle]} />
    </Animated.View>
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
  },
  taglineText: {
    color: WHITE,
    fontFamily: 'Inter_600SemiBold',
    includeFontPadding: false,
  },
});

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
                letterSpacing: 0.22 * 13.5 * k,
                // RN adds letter spacing after the last glyph too; pull it back so the line stays centred.
                marginRight: -0.22 * 13.5 * k,
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
            { width: 5 * k, height: 5 * k, borderRadius: 2.5 * k, backgroundColor: PEACH, marginLeft: 11 * k },
            dotStyle,
          ]}
        />
      )}
    </View>
  );
}
