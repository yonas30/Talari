// Pure-logic checks for the Appearance setting: which scheme is drawn for each saved mode and phone setting, what is told to the native
// side, and how the saved choice is read (default, every valid value, corrupt / missing / failing storage).
// Run: npx tsx scripts/verify-appearance.ts
import { DEFAULT_THEME_MODE, nativeSchemeRequest, parseThemeMode, resolveScheme, ThemeMode } from '../utils/themeResolve';

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

// ---- the default ------------------------------------------------------------------------------------------------------------------
check('the default is System', DEFAULT_THEME_MODE === 'system');

// ---- resolving the scheme (mode x phone setting) -------------------------------------------------------------------------------------
const SYSTEMS: (string | null | undefined)[] = ['light', 'dark', 'unspecified', null, undefined];
for (const system of SYSTEMS) {
  check(`Light always draws Light (phone: ${String(system)})`, resolveScheme('light', system) === 'light');
  check(`Dark always draws Dark (phone: ${String(system)})`, resolveScheme('dark', system) === 'dark');
}
check('System follows a Dark phone', resolveScheme('system', 'dark') === 'dark');
check('System follows a Light phone', resolveScheme('system', 'light') === 'light');
check('System with an unspecified phone setting is Light', resolveScheme('system', 'unspecified') === 'light');
check('System with no phone setting is Light', resolveScheme('system', null) === 'light' && resolveScheme('system', undefined) === 'light');
check('System with an unexpected value is Light', resolveScheme('system', 'DARK') === 'light' && resolveScheme('system', '') === 'light');
// "System follows the phone live": the same mode gives a different scheme as the phone changes, with nothing else needed.
{
  const timeline = ['light', 'dark', 'light', 'dark'].map((phone) => resolveScheme('system', phone));
  check('System tracks every change of the phone while the app is open', timeline.join(',') === 'light,dark,light,dark');
}
// A fixed choice ignores the phone completely.
check('a fixed Light stays Light when the phone goes Dark', resolveScheme('light', 'light') === resolveScheme('light', 'dark'));
check('a fixed Dark stays Dark when the phone goes Light', resolveScheme('dark', 'light') === resolveScheme('dark', 'dark'));

// ---- what the native side is told -----------------------------------------------------------------------------------------------------
check('System hands control back to the phone (unspecified)', nativeSchemeRequest('system') === 'unspecified');
check('Light forces Light', nativeSchemeRequest('light') === 'light');
check('Dark forces Dark', nativeSchemeRequest('dark') === 'dark');

// ---- parsing a saved value ----------------------------------------------------------------------------------------------------------------
for (const mode of ['system', 'light', 'dark'] as ThemeMode[]) {
  check(`a saved "${mode}" is kept`, parseThemeMode(mode) === mode);
}
const corrupt: unknown[] = [null, undefined, '', ' ', 'Dark', 'LIGHT', 'auto', 'automatic', 'dark ', 'true', '0', 0, 1, true, {}, [], ['dark']];
for (const value of corrupt) {
  check(`a corrupt saved value falls back to System (${JSON.stringify(value)})`, parseThemeMode(value) === 'system');
}

// ---- the stored preference, through the real functions with a stand-in keystore ----------------------------------------------------------------
type Store = { value: string | null; failRead: boolean; failWrite: boolean; writes: string[] };
const store: Store = { value: null, failRead: false, failWrite: false, writes: [] };
const fakeSecureStore = {
  getItemAsync: async (key: string) => {
    if (key !== 'theme-mode') throw new Error('unexpected key ' + key);
    if (store.failRead) throw new Error('keystore unavailable');
    return store.value;
  },
  setItemAsync: async (key: string, value: string) => {
    if (key !== 'theme-mode') throw new Error('unexpected key ' + key);
    if (store.failWrite) throw new Error('keystore unavailable');
    store.value = value;
    store.writes.push(value);
  },
};
// eslint-disable-next-line @typescript-eslint/no-require-imports
const moduleInternals = require('module') as { _load: (request: string, ...rest: unknown[]) => unknown };
const originalLoad = moduleInternals._load;
moduleInternals._load = function (request: string, ...rest: unknown[]) {
  return request === 'expo-secure-store' ? fakeSecureStore : originalLoad.call(this, request, ...rest);
};
// eslint-disable-next-line @typescript-eslint/no-require-imports
const preference = require('../utils/themePreference') as typeof import('../utils/themePreference');
moduleInternals._load = originalLoad;

async function run() {
  store.value = null;
  check('nothing saved yet -> System', (await preference.getThemeMode()) === 'system');
  for (const mode of ['dark', 'light', 'system'] as ThemeMode[]) {
    await preference.setThemeMode(mode);
    check(`saving "${mode}" and reading it back (a later launch)`, store.value === mode && (await preference.getThemeMode()) === mode);
  }
  store.value = 'purple';
  check('a corrupt stored value -> System', (await preference.getThemeMode()) === 'system');
  store.value = '';
  check('an empty stored value -> System', (await preference.getThemeMode()) === 'system');
  store.value = 'dark';
  store.failRead = true;
  check('an unreadable keystore never blocks launch -> System', (await preference.getThemeMode()) === 'system');
  store.failRead = false;
  store.failWrite = true;
  let threw = false;
  try {
    await preference.setThemeMode('light');
  } catch {
    threw = true;
  }
  check('a keystore that cannot be written does not throw (the choice still applies for the session)', !threw);
  store.failWrite = false;
  check('the key is "theme-mode" (the existing preference store; nothing new is stored)', store.writes.length === 3);

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
}
void run();
