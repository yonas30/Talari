// Pure-function checks for the greeting, the name rules and the onboarding / prompt state machine.
// Run: npx tsx scripts/verify-greeting.ts
import {
  decideFirstScreen,
  finishWelcome,
  formatGreeting,
  getGreeting,
  INITIAL_PROMPT,
  isPromptDue,
  NAME_MAX_LENGTH,
  promptAfterClear,
  promptAfterNotNow,
  promptAfterSave,
  PromptState,
  REMIND_AFTER_MS,
  sanitiseName,
  StoredProfile,
} from '../utils/profile';

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

// ---- greeting boundaries (LOCAL time) -------------------------------------------------------------------------------
const at = (h: number, m: number) => new Date(2026, 5, 15, h, m, 0);
check('04:59 -> Hello', getGreeting(at(4, 59)) === 'Hello');
check('05:00 -> Good morning', getGreeting(at(5, 0)) === 'Good morning');
check('11:59 -> Good morning', getGreeting(at(11, 59)) === 'Good morning');
check('12:00 -> Good afternoon', getGreeting(at(12, 0)) === 'Good afternoon');
check('16:59 -> Good afternoon', getGreeting(at(16, 59)) === 'Good afternoon');
check('17:00 -> Good evening', getGreeting(at(17, 0)) === 'Good evening');
check('20:59 -> Good evening', getGreeting(at(20, 59)) === 'Good evening');
check('21:00 -> Hello', getGreeting(at(21, 0)) === 'Hello');
check('00:00 -> Hello', getGreeting(at(0, 0)) === 'Hello');
check('23:59 -> Hello', getGreeting(at(23, 59)) === 'Hello');
check('uses getHours() (local time), not UTC', getGreeting(new Date(2026, 5, 15, 18, 30, 0)) === 'Good evening');

// ---- greeting line --------------------------------------------------------------------------------------------------
check('with a name: "Good evening, Yonas 👋"', formatGreeting(at(18, 0), 'Yonas') === 'Good evening, Yonas 👋');
check('no name: no trailing comma or gap', formatGreeting(at(18, 0), null) === 'Good evening 👋' && formatGreeting(at(18, 0), undefined) === 'Good evening 👋');
check('blank / whitespace name counts as no name', formatGreeting(at(9, 0), '   ') === 'Good morning 👋' && formatGreeting(at(9, 0), '') === 'Good morning 👋');
check('never ", 👋" or a double space', !formatGreeting(at(9, 0), '').includes(', ') && !formatGreeting(at(9, 0), '').includes('  '));
check('Hello with a name', formatGreeting(at(23, 0), 'Sara') === 'Hello, Sara 👋');

// ---- name sanitising ------------------------------------------------------------------------------------------------
check('trims', sanitiseName('  Yonas  ') === 'Yonas');
check('collapses repeated spaces', sanitiseName('Anna    Maria') === 'Anna Maria');
check('tabs and newlines collapse to one space', sanitiseName('Anna\t\nMaria') === 'Anna Maria');
check('empty -> null', sanitiseName('') === null);
check('spaces only -> null', sanitiseName('     ') === null);
check('exactly 30 characters kept', sanitiseName('a'.repeat(30)) === 'a'.repeat(30) && NAME_MAX_LENGTH === 30);
check('31 characters cut to 30', sanitiseName('a'.repeat(31)) === 'a'.repeat(30));
check('cut never leaves a trailing space', sanitiseName('a'.repeat(29) + ' bbbb') === 'a'.repeat(29));
check('Amharic is kept as it is', sanitiseName('  ዮናስ   ከበደ ') === 'ዮናስ ከበደ');
check('30 Amharic letters are fine (characters, not bytes)', sanitiseName('ዮ'.repeat(30)) === 'ዮ'.repeat(30));
check('31 Amharic letters cut to 30', Array.from(sanitiseName('ዮ'.repeat(31)) ?? '').length === 30);
check('other scripts and emoji are allowed', sanitiseName('محمد') === 'محمد' && sanitiseName('李小龍') === '李小龍' && sanitiseName('Zoë 🌱') === 'Zoë 🌱');
check('an emoji is never split in half by the cut', (() => {
  const out = sanitiseName('😀'.repeat(31)) ?? '';
  return Array.from(out).length === 30 && !/[\uD800-\uDBFF]$/.test(out);
})());
check('apostrophes and hyphens are allowed', sanitiseName("O'Brien-Smith") === "O'Brien-Smith");

// ---- name prompt state machine (existing data) ----------------------------------------------------------------------
const T0 = Date.UTC(2026, 0, 10, 12, 0, 0);
check('fresh state is due', isPromptDue(INITIAL_PROMPT, T0));
check('Save -> set, never due again', !isPromptDue(promptAfterSave, T0 + 100 * REMIND_AFTER_MS));
const skipped1 = promptAfterNotNow(INITIAL_PROMPT, T0);
check('Not now -> skipped-once, remembers when', skipped1.status === 'skipped-once' && skipped1.skippedAt === T0);
check('not due immediately after Not now', !isPromptDue(skipped1, T0));
check('not due after 6 days 23 h', !isPromptDue(skipped1, T0 + REMIND_AFTER_MS - 3_600_000));
check('due exactly at 7 days', isPromptDue(skipped1, T0 + REMIND_AFTER_MS));
check('due long after 7 days', isPromptDue(skipped1, T0 + 40 * REMIND_AFTER_MS));
const skipped2 = promptAfterNotNow(skipped1, T0 + REMIND_AFTER_MS);
check('second Not now -> done', skipped2.status === 'done');
check('done is never due again', !isPromptDue(skipped2, T0 + 1000 * REMIND_AFTER_MS));
check('clearing a name ends the prompt story (done)', promptAfterClear.status === 'done' && !isPromptDue(promptAfterClear, T0));
check('Not now on set / done changes nothing', promptAfterNotNow(promptAfterSave, T0).status === 'set' && promptAfterNotNow(skipped2, T0).status === 'done');
const broken: PromptState = { status: 'skipped-once' };
check('skipped-once without a timestamp is never due (no crash, no nag)', !isPromptDue(broken, T0 + 1000 * REMIND_AFTER_MS));

// ---- first screen decision ------------------------------------------------------------------------------------------
const fresh = decideFirstScreen(null, false);
check('nothing stored + no data -> Welcome', fresh.screen === 'welcome' && fresh.profile.welcome === 'pending' && !fresh.persist);
const existing = decideFirstScreen(null, true);
check(
  'nothing stored + existing data -> app, silently marked done, name prompt pending',
  existing.screen === 'app' && existing.profile.welcome === 'done' && existing.profile.prompt.status === 'unset' && existing.persist,
);
const pending: StoredProfile = { welcome: 'pending', name: null, prompt: INITIAL_PROMPT };
check('stored pending -> Welcome even if data exists (dev reset)', decideFirstScreen(pending, true).screen === 'welcome');
const done: StoredProfile = { welcome: 'done', name: 'Yonas', prompt: promptAfterSave };
const decided = decideFirstScreen(done, false);
check('stored done -> app, nothing rewritten', decided.screen === 'app' && !decided.persist && decided.profile === done);
check('Welcome with a name -> done + set', finishWelcome('Yonas').name === 'Yonas' && finishWelcome('Yonas').prompt.status === 'set' && finishWelcome('Yonas').welcome === 'done');
check('Welcome skipped -> done, no name, never nagged', finishWelcome(null).name === null && finishWelcome(null).prompt.status === 'done' && finishWelcome(null).welcome === 'done');

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
