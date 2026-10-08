// Checks the fontWeight -> font family mapping used by the shared Text helper. Run: npx tsx scripts/verify-fonts.ts
import { fontFamilyFor, INTER, JAKARTA, normaliseWeight } from '../theme/fontFamilies';

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

const body = (weight: string | number | undefined) => fontFamilyFor('body', weight);
const heading = (weight: string | number | undefined) => fontFamilyFor('heading', weight);

check('no weight / normal / 400 -> Inter Regular', body(undefined) === INTER[400] && body('normal') === INTER[400] && body('400') === INTER[400] && body(400) === INTER[400]);
check('100-300 fall back to Inter Regular', body('100') === INTER[400] && body('300') === INTER[400]);
check('500 -> Inter Medium', body('500') === INTER[500]);
check('600 -> Inter SemiBold', body('600') === INTER[600]);
check('700 / bold -> Inter Bold', body('700') === INTER[700] && body('bold') === INTER[700]);
check('800 and 900 use Inter Bold (no heavier Inter is loaded)', body('800') === INTER[700] && body('900') === INTER[700]);
check('heading 700 -> Plus Jakarta Sans Bold', heading('700') === JAKARTA[700] && heading('bold') === JAKARTA[700]);
check('heading 800 / 900 -> Plus Jakarta Sans ExtraBold', heading('800') === JAKARTA[800] && heading('900') === JAKARTA[800]);
check('heading lighter than 700 still uses Bold (only 700/800 are loaded)', heading('400') === JAKARTA[700] && heading(undefined) === JAKARTA[700]);
check('numeric and string weights agree', body(600) === body('600') && heading(800) === heading('800'));
check('garbage weight falls back to Regular', normaliseWeight('heavy') === 400);
check('every family name matches the @expo-google-fonts export names', Object.values(INTER).every((name) => /^Inter_\d{3}[A-Za-z]+$/.test(name)) && Object.values(JAKARTA).every((name) => /^PlusJakartaSans_\d{3}[A-Za-z]+$/.test(name)));

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
