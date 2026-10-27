// Checks for "Save all that are clean" (bug fix round): the batch always ends with a result that lists every message not saved and why, shows
// progress, yields to the screen between messages, writes to the database per message but updates the screen ONCE, never throws, and stays
// fast against a long history. Every value below is SYNTHETIC. Run: npx tsx scripts/verify-sms-bulk.ts
import { UNCATEGORISED_NAME } from '../constants/categories';
import { AccountsState } from '../types/accounts';
import { SmsSuggestion } from '../types/sms';
import { Ctx } from '../utils/accounts/context';
import { AccountsError } from '../utils/accounts/errors';
import { planAddEntry } from '../utils/accounts/entries';
import { planCreateAccount } from '../utils/accounts/manage';
import { buildChains, chainTimestamps } from '../utils/sms/chain';
import { bulkSummary, runBulkSave } from '../utils/sms/bulkRun';
import { cleanOrder } from '../utils/sms/saveSuggestion';

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

let n = 0;
const ctx: Ctx = { now: () => new Date(2026, 10, 20, 9, 0, 0), newId: () => `id-${++n}` };
function ledger(opening = 5_000_000, history = 0) {
  let state: AccountsState = { accounts: [], entries: [], goals: [], allocations: [], notifications: [], rates: [], currencies: ['ETB'] };
  const created = planCreateAccount(state, { name: 'BOA', type: 'bank', currency: 'ETB', openingAmount: opening, smsSender: 'BOA', lastDigits: '64' }, ctx);
  state = { ...created.state, entries: created.state.entries.map((e) => (e.type === 'opening' ? { ...e, date: '2026-01-01' } : e)) };
  for (let i = 0; i < history; i += 1) {
    const day = new Date(2026, 0, 2 + Math.floor(i / 3));
    const key = `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, '0')}-${String(day.getDate()).padStart(2, '0')}`;
    state = planAddEntry(state, { type: i % 4 === 0 ? 'income' : 'expense', accountId: created.account.id, amount: 100 + i, currency: 'ETB', category: i % 4 === 0 ? 'Salary' : 'Food', date: key }, ctx).state;
  }
  return { state, account: created.account.id };
}
function sug(id: string, accountId: string | null, p: Partial<SmsSuggestion> = {}): SmsSuggestion {
  return {
    id, rawHash: `h-${id}`, status: 'pending', service: 'boa', direction: 'out', kind: 'debit', amount: 100, fee: null, vat: null, otherCharge: null, totalDeducted: null,
    counterpartyName: null, counterpartyPhoneTail: null, counterpartyBank: null, counterpartyAccountTail: null, counterpartyCode: null, accountTail: null, reference: null,
    occurredAt: null, balanceAfter: null, note: null, flags: [], accountId, category: UNCATEGORISED_NAME, feeAmount: null, date: '2026-11-14', dateSource: 'batch',
    createdAt: '2026-11-14T00:00:00Z', confirmedEntryId: null, ...p,
  };
}

// ======================================================= 1. the result lists every failure, with its reason =======================
console.log('The result of a batch');
{
  const { state, account } = ledger(1000);
  const ok1 = sug('ok1', account, { amount: 100, date: '2026-11-14' });
  const ok2 = sug('ok2', account, { amount: 50, date: '2026-11-15' });
  const noAccount = sug('noacct', null, { amount: 10 });
  const overdraw = sug('over', account, { amount: 5000, date: '2026-11-16' });
  const early = sug('early', account, { amount: 5, date: '2025-12-01' });
  const dupState = planAddEntry(state, { type: 'expense', accountId: account, amount: 77, currency: 'ETB', category: 'Food', date: '2026-11-14' }, ctx).state;
  const dup = sug('dup', account, { amount: 77, date: '2026-11-14' });
  const commits: string[] = [];
  const result = runBulkSave({
    state: dupState,
    suggestions: [ok2, noAccount, overdraw, early, dup, ok1, sug('skipped', account, { status: 'ignored' }), sug('done', account, { status: 'confirmed' })],
    commit: (plan) => { commits.push(plan.confirmation.suggestionId); },
  });
  void result.then((r) => {
    check('the messages that could be saved were saved, oldest first', r.saved.join() === 'ok1,ok2' && commits.join() === 'ok1,ok2', `${r.saved.join()} / ${commits.join()}`);
    check('every message NOT saved is listed with its id', r.failures.map((f) => f.id).sort().join() === 'dup,early,noacct,over');
    const why = (id: string) => r.failures.find((f) => f.id === id)?.reason ?? '';
    check('no account: the reason says to choose one', /account/i.test(why('noacct')), why('noacct'));
    check('an overdraw: the reason is the usual "not enough money" message', why('over').startsWith('Not enough money in BOA'), why('over'));
    check('dated before the opening balance: the specific message', why('early') === "This is dated before the account's opening balance on 2026-01-01.", why('early'));
    check('a possible duplicate: the reason says so', /duplicate/i.test(why('dup')), why('dup'));
    check('a skipped message and an already confirmed one are neither saved nor failures', !r.failures.some((f) => f.id === 'skipped' || f.id === 'done') && !r.saved.includes('skipped'));
    check('the total counts the messages that were waiting', r.total === 6, String(r.total));
    check('nothing stopped the batch', r.stopped === null);
    check('the ledger after the run has exactly the two saved entries more', r.state.entries.length === dupState.entries.length + 2);
  });
}

// ======================================================= 2. progress and yielding ===============================================
console.log('Progress and yielding');
const pendingChecks: Array<Promise<void>> = [];
{
  const { state, account } = ledger();
  const rows = Array.from({ length: 12 }, (_, i) => sug(`m${i}`, account, { amount: 10 + i, date: '2026-11-14' }));
  const seen: string[] = [];
  let yields = 0;
  let order = '';
  pendingChecks.push(
    runBulkSave({
      state,
      suggestions: rows,
      commit: () => { order += 'c'; },
      onProgress: (p) => { seen.push(`${p.done}/${p.total}`); order += 'p'; },
      yieldToUi: async () => { yields += 1; order += 'y'; },
    }).then((r) => {
      check('progress is reported once before the first message and after every one ("Saving 3 of 12")', seen.length === 13 && seen[0] === '0/12' && seen[3] === '3/12' && seen[12] === '12/12', seen.join());
      check('the loop yields to the screen between messages', yields >= 11 && yields <= 13, String(yields));
      check('each message: commit, then progress, then a yield (so the screen can paint)', order === 'p' + 'cpy'.repeat(12), order);
      check('all twelve were saved', r.saved.length === 12 && r.failures.length === 0);
    }),
  );
}

// ======================================================= 3. a failure mid-batch ================================================
console.log('A failure in the middle');
{
  const { state, account } = ledger();
  const rows = Array.from({ length: 6 }, (_, i) => sug(`m${i}`, account, { amount: 10 + i }));
  pendingChecks.push(
    runBulkSave({
      state,
      suggestions: rows,
      commit: (plan) => { if (plan.confirmation.suggestionId === 'm2') throw new AccountsError('INVALID_ENTRY', 'The ledger refused this one.'); },
    }).then((r) => {
      check('an AccountsError from one save fails that message only; the rest are still saved', r.saved.join() === 'm0,m1,m3,m4,m5' && r.failures.length === 1 && r.failures[0].id === 'm2' && r.failures[0].reason === 'The ledger refused this one.' && r.stopped === null);
      check('the state does not include the message whose save failed', r.state.entries.filter((e) => e.type === 'expense').length === 5);
    }),
  );
  pendingChecks.push(
    runBulkSave({
      state,
      suggestions: rows,
      commit: (plan) => { if (plan.confirmation.suggestionId === 'm2') throw new Error('disk full'); },
    }).then((r) => {
      check('any other error stops the batch but does NOT throw: the result says what happened', r.stopped !== null && /disk full/.test(r.stopped) && r.error instanceof Error);
      check('the messages saved before it stay saved, and the rest are listed as not tried', r.saved.join() === 'm0,m1' && r.failures.map((f) => f.id).join() === 'm2,m3,m4,m5');
      check('the failure that stopped it carries the error, the others say they were not tried', /disk full/.test(r.failures[0].reason) && r.failures.slice(1).every((f) => /not tried|stopped/i.test(f.reason)));
      check('the state is exactly what was saved (so the screen can be brought up to date)', r.state.entries.filter((e) => e.type === 'expense').length === 2);
    }),
  );
}

// ======================================================= 4. the screen is updated once ==========================================
console.log('Database per message, the screen once');
{
  const { state, account } = ledger();
  const rows = Array.from({ length: 8 }, (_, i) => sug(`m${i}`, account, { amount: 10 + i }));
  const before: number[] = [];
  pendingChecks.push(
    runBulkSave({
      state,
      suggestions: rows,
      commit: (_plan, base) => { before.push(base.entries.length); },
    }).then((r) => {
      check('each commit is given the ledger the previous ones left, so its database diff is right', before.join() === [0, 1, 2, 3, 4, 5, 6, 7].map((k) => state.entries.length + k).join(), before.join());
      check('the result carries the final ledger for ONE update of the screen', r.state.entries.length === state.entries.length + 8);
    }),
  );
}

// ======================================================= 5. the words ===========================================================
console.log('The message shown at the end');
{
  const label = (id: string) => `BOA ETB 100.00 on 2026-11-14 (${id})`;
  const all = bulkSummary({ saved: ['a', 'b', 'c'], failures: [], state: ledger().state, total: 3, stopped: null, error: null }, label);
  check('all saved: "Saved 3."', all.headline === 'Saved 3.' && all.lines.length === 0 && all.stayOnScreen === false);
  const some = bulkSummary({ saved: ['a'], failures: [{ id: 'x', reason: 'No account chosen yet.' }, { id: 'y', reason: 'Not enough money in BOA.' }], state: ledger().state, total: 3, stopped: null, error: null }, label);
  check('some not saved: "Saved 1. 2 not saved because:" and one line per failure with its reason', some.headline === 'Saved 1. 2 not saved because:' && some.lines.length === 2 && some.lines[0].includes('(x)') && some.lines[0].includes('No account chosen yet.') && some.lines[1].includes('Not enough money in BOA.'));
  check('...and the screen stays where it is', some.stayOnScreen === true);
  const one = bulkSummary({ saved: [], failures: [{ id: 'x', reason: 'Because.' }], state: ledger().state, total: 1, stopped: null, error: null }, label);
  check('one failure reads naturally ("1 not saved")', one.headline === 'Saved 0. 1 not saved because:');
  const stopped = bulkSummary({ saved: ['a'], failures: [{ id: 'x', reason: 'Could not save: disk full' }], state: ledger().state, total: 3, stopped: 'disk full', error: new Error('disk full') }, label);
  check('a batch that stopped on an error says so plainly', /stopped/i.test(stopped.headline) && /disk full/.test(stopped.headline) && stopped.stayOnScreen === true);
  const none = bulkSummary({ saved: [], failures: [], state: ledger().state, total: 0, stopped: null, error: null }, label);
  check('nothing to save: says so, never silent', none.headline === 'Nothing was waiting to be saved.' && none.stayOnScreen === false);
}

// ======================================================= 6. how long the logic takes ==============================================
console.log('Speed: 50 messages against a 500-entry history');
{
  const { state, account } = ledger(5_000_000, 500);
  let balance = 4_000_000;
  const rows: SmsSuggestion[] = [];
  for (let i = 0; i < 92; i += 1) {
    balance -= 100 + i;
    rows.push(sug(`s${i}`, account, { amount: 100 + i, balanceAfter: balance, date: `2026-11-${String(1 + (i % 28)).padStart(2, '0')}`, status: i < 42 ? 'ignored' : 'pending' }));
  }
  const times = chainTimestamps(buildChains(rows, state.accounts));
  const started = performance.now();
  pendingChecks.push(
    runBulkSave({ state, suggestions: rows, timestampFor: (s) => times.get(s.id) ?? null, commit: () => undefined }).then((r) => {
      const ms = performance.now() - started;
      console.log(`  (timing) pure save logic, 50 messages, 500-entry history, 42 skipped in the chain: ${ms.toFixed(0)} ms`);
      check('50 messages saved against 500 entries', r.saved.length === 50 && r.failures.length === 0 && cleanOrder(rows).length === 50);
      check('the pure logic is fast (well under a second here), so a slow screen is the screen\'s doing', ms < 2000, `${ms.toFixed(0)} ms`);
    }),
  );
}

void Promise.all(pendingChecks).then(() => {
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
});
