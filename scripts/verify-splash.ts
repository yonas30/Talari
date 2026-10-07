// Checks the splash timeline against the table in TALARI_STEP1_INSTRUCTIONS.md.
// Run: npx tsx scripts/verify-splash.ts
import { SCHEDULES, ZOOM_CAP, cubicBezier, skipFrame, skipSchedule, splashFrame, taglineFrame } from '../utils/splashTimeline';

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
  [0.55, 0.05, 0.9, 0.5],
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
// CSS ease-in-out reference value: cubic-bezier(.42,0,.58,1) at 0.5 is exactly 0.5
check('bezier matches the CSS ease-in-out midpoint', near(cubicBezier(0.42, 0, 0.58, 1, 0.5), 0.5));
// "Slow start, fast end" for the zoom curve
check('zoom curve is slow at the start and fast at the end', cubicBezier(0.55, 0.05, 0.9, 0.5, 0.25) < 0.1 && cubicBezier(0.55, 0.05, 0.9, 0.5, 0.9) > 0.6);

// First launch
const f = (t: number) => splashFrame(t, 'first');
check('0.00-0.15 is plain orange (nothing visible)', f(0).stem.o === 0 && f(0.1).stem.o === 0 && f(0.1).band.o === 0 && f(0.1).dotScale === 0);
check('stem starts at 0.15 and is complete by 0.60', f(0.3).stem.o > 0 && near(f(0.6).stem.o, 1) && near(f(0.6).stem.dy, 0) && near(f(0.15).stem.dy, -26));
check('left leg 0.35-0.80 from 18 left / 26 below', near(f(0.35).legl.dx, -18) && near(f(0.35).legl.dy, 26) && near(f(0.8).legl.o, 1));
check('band 0.60-1.05 from 46 left', near(f(0.6).band.dx, -46) && near(f(1.05).band.o, 1) && f(0.6).band.o === 0);
check('right leg 0.85-1.30 from 18 right / 26 below', near(f(0.85).legr.dx, 18) && near(f(0.85).legr.dy, 26) && near(f(1.3).legr.o, 1));
check('dot: 0 -> 1.25 at 1.30 -> 1 at 1.45', f(1.15).dotScale === 0 && near(f(1.3).dotScale, 1.25) && near(f(1.45).dotScale, 1) && f(1.375).dotScale < 1.25 && f(1.375).dotScale > 1);
check('hold 1.45-1.60: symbol still centred at full size', f(1.5).lock === 0 && f(1.6).lock === 0);
check('symbol docks 1.60-2.15', f(1.8).lock > 0 && f(1.8).lock < 1 && near(f(2.15).lock, 1));
check('letters start 1.90 + 0.06 x index, 0.45 long', f(1.9).letters[0] === 0 && f(1.95).letters[0] > 0 && f(1.95).letters[5] === 0 && near(f(1.9 + 0.3 + 0.45).letters[5], 1) && near(f(2.35).letters[0], 1));
check('nothing fades before 3.70; others fully gone at 4.15', f(3.69).others === 1 && f(3.7).others === 1 && near(f(3.925).others, 0.5) && f(4.15).others === 0);
check('zoom 3.70-4.90 reaches the cap, starts at 1x', f(3.7).zoom === 1 && near(f(4.9).zoom, ZOOM_CAP, 1e-6) && f(4.2).zoom < 3);
check('band colour tween 4.10-4.90', f(4.1).bandMix === 0 && near(f(4.5).bandMix, 0.5) && f(4.9).bandMix === 1);
check('cover 4.50-4.90 fully opaque at the hold point', f(4.5).cover === 0 && near(f(4.7).cover, 0.5) && f(4.9).cover === 1);
check('overlay fade 4.90-5.25', f(4.9).overlay === 1 && near(f(5.075).overlay, 0.5) && f(5.25).overlay === 0);
check('hold point is 4.90, end 5.25 for the first launch', SCHEDULES.first.holdAt === 4.9 && SCHEDULES.first.end === 5.25);

// Tagline (clock starts at 2.45)
const tg = (t: number) => taglineFrame(t - 2.45);
check('tagline words: KNOW 2.45-2.85, CONTROL 2.65-3.05, GROW 2.85-3.25', tg(2.45).words[0] === 0 && near(tg(2.85).words[0], 1) && tg(2.65).words[1] === 0 && near(tg(3.05).words[1], 1) && tg(2.85).words[2] === 0 && near(tg(3.25).words[2], 1));
check('tagline dots: 2.70-2.95 and 2.90-3.15', tg(2.7).dots[0] === 0 && near(tg(2.95).dots[0], 1) && tg(2.9).dots[1] === 0 && near(tg(3.15).dots[1], 1));


// Tap to skip: from any moment, fade the parts out over 0.2 s, then zoom + reveal in 0.6 s - never a cut
for (const tap of [0.05, 0.5, 0.9, 1.7, 2.0, 2.6, 3.4]) {
  const from = { ...splashFrame(tap, 'first'), t0: tap };
  const s = (dt: number) => skipFrame(tap + dt, from);
  const sched = skipSchedule(tap);
  const same = (a: number, b: number) => near(a, b, 1e-9);
  check(`skip @${tap}: first frame is identical to what was on screen (no cut)`, same(s(0).stem.o, from.stem.o) && same(s(0).lock, from.lock) && same(s(0).band.o, from.band.o) && same(s(0).band.dx, from.band.dx) && same(s(0).dotScale, from.dotScale) && s(0).letters.every((v, i) => same(v, from.letters[i])) && same(s(0).others, from.others) && s(0).zoom === 1 && s(0).bandMix === 0 && s(0).cover === 0 && s(0).overlay === 1);
  check(`skip @${tap}: everything but the band is gone after 0.2 s, the band is fully visible`, near(s(0.2).others, 0, 1e-9) && near(s(0.2).band.o, 1) && near(s(0.2).band.dx, 0) && near(s(0.2).zoom, 1, 1e-9));
  check(`skip @${tap}: halfway through the fade the others are at half and nothing jumps`, near(s(0.1).others, from.others * 0.5) && s(0.1).band.o >= from.band.o && s(0.1).band.o <= 1);
  check(`skip @${tap}: zoom + reveal complete 0.6 s later (cover opaque, band recoloured, zoom at cap)`, near(s(0.8).zoom, ZOOM_CAP, 1e-6) && near(s(0.8).bandMix, 1, 1e-9) && near(s(0.8).cover, 1, 1e-9) && near(s(0.8).overlay, 1, 1e-9));
  check(`skip @${tap}: schedule hold at +0.8 s, overlay gone 0.175 s after`, near(sched.holdAt - tap, 0.8) && near(sched.end - sched.holdAt, 0.175) && near(s(0.975).overlay, 0, 1e-9));
}
{
  const from = { ...splashFrame(0.05, 'first'), t0: 0.05 };
  check('skip before the band exists: band was invisible and is faded in (not popped in)', from.band.o === 0 && skipFrame(0.05 + 0.1, from).band.o > 0 && skipFrame(0.05 + 0.1, from).band.o < 1);
}

// Every other launch
const r = (t: number) => splashFrame(t, 'repeat');
check('repeat: symbol fully built from the first frame, no wordmark', r(0).stem.o === 1 && r(0).band.o === 1 && r(0).legl.o === 1 && r(0).legr.o === 1 && r(0).dotScale === 1 && r(0).lock === 0 && r(0).letters.every((v) => v === 0));
check('repeat: others fade 0.40-0.75', r(0.4).others === 1 && near(r(0.575).others, 0.5) && r(0.75).others === 0);
check('repeat: zoom 0.40-1.30, band tween 0.50-1.20, cover 0.90-1.30, overlay 1.30-1.55', r(0.4).zoom === 1 && near(r(1.3).zoom, ZOOM_CAP, 1e-6) && r(0.5).bandMix === 0 && r(1.2).bandMix === 1 && r(0.9).cover === 0 && r(1.3).cover === 1 && r(1.3).overlay === 1 && r(1.55).overlay === 0);
check('repeat: hold 1.30, end 1.55', SCHEDULES.repeat.holdAt === 1.3 && SCHEDULES.repeat.end === 1.55);

// Reduce motion: nothing moves, only the final crossfade
const m = (t: number) => splashFrame(t, 'reduced');
check('reduced: finished symbol, no zoom/tween/cover; crossfade 0.6-0.85 (0.25 s)', m(0).band.o === 1 && m(0.3).zoom === 1 && m(0.3).others === 1 && m(0.3).bandMix === 0 && m(0.3).cover === 0 && m(0.6).overlay === 1 && near(m(0.725).overlay, 0.5) && m(0.85).overlay === 0);

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
