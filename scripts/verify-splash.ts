// Checks the splash timeline against the spec (build-up 0-3.70 s unchanged; calm exit 3.70-4.50 s; reduced motion;
// compressed skip). Run: npx tsx scripts/verify-splash.ts
import {
  EXIT_SCALE,
  SCHEDULES,
  cubicBezier,
  skipFrame,
  skipSchedule,
  splashFrame,
  taglineFrame,
} from '../utils/splashTimeline';

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
const near = (a: number, b: number, eps = 1e-3) => Math.abs(a - b) < eps;

// cubic-bezier endpoints and monotonic shape
const CURVES: [number, number, number, number][] = [
  [0.2, 0.8, 0.2, 1],
  [0.65, 0, 0.25, 1],
  [0.4, 0, 0.2, 1],
];
for (const curve of CURVES) {
  check(`bezier ${curve.join(',')} starts at 0 and ends at 1`, cubicBezier(...curve, 0) === 0 && cubicBezier(...curve, 1) === 1);
  let previous = -1;
  let monotonic = true;
  for (let i = 0; i <= 100; i += 1) {
    const value = cubicBezier(...curve, i / 100);
    monotonic = monotonic && value >= previous - 1e-9;
    previous = value;
  }
  check(`bezier ${curve.join(',')} is monotonic`, monotonic);
}
check('bezier matches the CSS ease-in-out midpoint', near(cubicBezier(0.42, 0, 0.58, 1, 0.5), 0.5));

// Full timeline
const f = (t: number) => splashFrame(t, 'full');
check('0.00-0.15 is plain orange (nothing visible)', f(0).stem.o === 0 && f(0.1).stem.o === 0 && f(0.1).band.o === 0 && f(0.1).dotScale === 0);
check('stem starts at 0.15 and is complete by 0.60', f(0.3).stem.o > 0 && near(f(0.6).stem.o, 1) && near(f(0.6).stem.dy, 0) && near(f(0.15).stem.dy, -26));
check('left leg 0.35-0.80 from 18 left / 26 below', near(f(0.35).legl.dx, -18) && near(f(0.35).legl.dy, 26) && near(f(0.8).legl.o, 1));
check('band 0.60-1.05 from 46 left', near(f(0.6).band.dx, -46) && near(f(1.05).band.o, 1) && f(0.6).band.o === 0);
check('right leg 0.85-1.30 from 18 right / 26 below', near(f(0.85).legr.dx, 18) && near(f(0.85).legr.dy, 26) && near(f(1.3).legr.o, 1));
check('dot: 0 -> 1.25 at 1.30 -> 1 at 1.45', f(1.15).dotScale === 0 && near(f(1.3).dotScale, 1.25) && near(f(1.45).dotScale, 1) && f(1.375).dotScale < 1.25 && f(1.375).dotScale > 1);
check('hold 1.45-1.60: symbol still centred at full size', f(1.5).lock === 0 && f(1.6).lock === 0);
check('symbol docks 1.60-2.15', f(1.8).lock > 0 && f(1.8).lock < 1 && near(f(2.15).lock, 1));
check('letters start 1.90 + 0.06 x index, 0.45 long', f(1.9).letters[0] === 0 && f(1.95).letters[0] > 0 && f(1.95).letters[5] === 0 && near(f(1.9 + 0.3 + 0.45).letters[5], 1) && near(f(2.35).letters[0], 1));

const tg = (t: number) => taglineFrame(t - 2.45);
check('tagline words: KNOW 2.45-2.85, CONTROL 2.65-3.05, GROW 2.85-3.25', tg(2.45).words[0] === 0 && near(tg(2.85).words[0], 1) && tg(2.65).words[1] === 0 && near(tg(3.05).words[1], 1) && tg(2.85).words[2] === 0 && near(tg(3.25).words[2], 1));
check('tagline dots: 2.70-2.95 and 2.90-3.15', tg(2.7).dots[0] === 0 && near(tg(2.95).dots[0], 1) && tg(2.9).dots[1] === 0 && near(tg(3.15).dots[1], 1));

// Everything is on screen and untouched from the end of the tagline to the start of the exit (3.25-3.70 hold)
check('hold 3.25-3.70: nothing is leaving yet', f(3.3).exit === 0 && f(3.7).exit === 0 && f(3.7).overlay === 1 && f(3.7).lock === 1);

// Calm exit
check('exit: lockup fades and grows 3.70-4.50 together', f(3.7).exit === 0 && f(4.1).exit > 0.3 && f(4.1).exit < 0.9 && near(f(4.5).exit, 1));
check('exit: scale goes 1 -> 1.06', near(1 + EXIT_SCALE * f(3.7).exit, 1) && near(1 + EXIT_SCALE * f(4.5).exit, 1.06));
check('exit: opacity goes 1 -> 0', near(1 - f(3.7).exit, 1) && near(1 - f(4.5).exit, 0));
check('exit: orange overlay holds until 3.90, then fades to 0 by 4.50', f(3.7).overlay === 1 && f(3.9).overlay === 1 && f(4.2).overlay > 0 && f(4.2).overlay < 1 && near(f(4.5).overlay, 0));
check('exit: the lockup is already leaving when the orange starts to fade', f(3.9).exit > 0);
check('no zoom, tween or cover left in the frame', !('zoom' in f(4)) && !('bandMix' in f(4)) && !('cover' in f(4)));
check('schedule: hold at 3.70, finished at 4.50 (about 4.5 s total, down from 5.25)', SCHEDULES.full.holdAt === 3.7 && SCHEDULES.full.end === 4.5);

// Tap to skip: from any moment, the lockup fades over 0.2 s, then the overlay over 0.3 s - 0.5 s in all, never a cut
for (const tap of [0.05, 0.5, 0.9, 1.7, 2.0, 2.6, 3.4]) {
  const from = { ...splashFrame(tap, 'full'), t0: tap };
  const s = (dt: number) => skipFrame(tap + dt, from);
  const plan = skipSchedule(tap);
  const same = (a: number, b: number) => near(a, b, 1e-9);
  check(`skip @${tap}: first frame is identical to what was on screen (no cut)`, same(s(0).stem.o, from.stem.o) && same(s(0).lock, from.lock) && same(s(0).band.o, from.band.o) && same(s(0).band.dx, from.band.dx) && same(s(0).dotScale, from.dotScale) && s(0).letters.every((v, i) => same(v, from.letters[i])) && s(0).exit === 0 && s(0).overlay === 1);
  check(`skip @${tap}: lockup gone after 0.2 s while the orange is still fully there`, near(s(0.2).exit, 1, 1e-9) && near(s(0.2).overlay, 1, 1e-9));
  check(`skip @${tap}: orange fully gone after 0.5 s`, near(s(0.5).overlay, 0, 1e-9) && near(plan.end - tap, 0.5) && near(plan.holdAt - tap, 0.2));
  check(`skip @${tap}: nothing jumps (exit and overlay only ever move one way)`, s(0.05).exit > 0 && s(0.05).exit < s(0.1).exit && s(0.3).overlay < 1 && s(0.3).overlay > s(0.4).overlay);
}

// Reduce motion: the finished symbol from the very first frame, held 0.8 s, then a 0.25 s crossfade
const m = (t: number) => splashFrame(t, 'reduced');
check('reduced: finished symbol on screen at t = 0 (no build-up)', m(0).stem.o === 1 && m(0).band.o === 1 && m(0).legl.o === 1 && m(0).legr.o === 1 && m(0).dotScale === 1 && m(0).band.dx === 0 && m(0).lock === 0);
check('reduced: no wordmark, no exit motion', m(0.5).letters.every((v) => v === 0) && m(0.5).exit === 0 && m(1.0).exit === 0);
check('reduced: fully opaque for 0.8 s', m(0).overlay === 1 && m(0.4).overlay === 1 && m(0.8).overlay === 1);
check('reduced: 0.25 s crossfade 0.80-1.05', near(m(0.925).overlay, 0.5) && near(m(1.05).overlay, 0));
check('reduced: schedule hold 0.8, end 1.05', SCHEDULES.reduced.holdAt === 0.8 && near(SCHEDULES.reduced.end, 1.05));

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
