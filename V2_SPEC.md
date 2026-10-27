# PERSONAL FINANCE APP — VERSION 2 IMPLEMENTATION SPECIFICATION

> **PHASE 5 AMENDMENT — ACCOUNTS MODEL.** At the owner's explicit request, Parts B, C, D, E, F, H, I, N, Q, R, V and W were rewritten. Available and Saved no longer exist: money lives in named **accounts**, and a **goal** is money reserved inside one account. Where older wording elsewhere in this file still says Available, Saved, or "goals cannot pay expenses", this amendment wins. The rule "do not change the accounting rules without discussing" was met by the owner's request and by the decisions recorded below.
>
> **Owner decisions recorded for Phase 5:**
> 1. Goal amounts come from an append-only `goal_allocations` table (goal, account, signed amount, date). A goal's amount is a sum; the automatic reduction on overspend adds negative rows.
> 2. The reserved check runs after every write, against the account's current balance. Overdraft blocking stays day-granular.
> 3. Cross-currency transfer: each leg is converted at the rate on the transfer date; the ETB total may move; that is the exchange cost, not income or expense. Same-currency transfers never move Total.
> 4. The monthly "savings" figure is the net change in reserved goal money for the period.
> 5. Old (version 2) backups restore into one account called "Cash"; each goal becomes a reservation held in Cash; the restore fails with a clear message if goals exceed the total.
> 6. Streak: a manual "add to goal" allocation counts as activity. `opening`, `adjustment`, automatic reductions and recurring-generated rows do not.
> 7. `goal_reserve_used` notifications are stored in their own table. Budget alerts stay computed as before.
> 8. Backup version goes from 2 to 3 and covers only what the design needs.
> 9. Entry currency: a foreign-currency account takes entries in its own currency only. An ETB account keeps today's behaviour: a foreign amount can be entered, it is converted to ETB at the stored rate (or a per-entry override), and the original amount, currency and rate are stored on the entry. The ETB account's balance uses the ETB amount.
> 10. The schema 3 → 4 reset also clears milestones and monthly snapshots. `user_origin`, categories, budgets, currencies and exchange rates are kept.

## IMPORTANT — READ THIS FIRST

We are upgrading the existing Personal Finance app to Version 2.

**Do not rebuild the application from scratch** (architecturally — note Part V below on data: we ARE starting with a clean/empty database, but the app's code, screens, and navigation should be upgraded in place, not rewritten from zero).

First inspect the existing project, understand the current architecture, screens, navigation, database/storage, and existing functionality. Then make the changes below while preserving functionality that already works and isn't being explicitly changed here.

**Critical instruction:** Do not invent a different financial/accounting model. The accounting rules below are the source of truth for Version 2.

Before implementing, inspect the current code and identify where the existing balance, income, expense, savings, goals, transactions, budget, recurring transactions, insights, and streak logic are implemented.

---

## PART A — FEATURES EXPLICITLY NOT INCLUDED IN VERSION 2

Do NOT implement these in Version 2. They belong to Version 3.

**App identity / first-time experience — V3**
Do NOT work on: app name/branding, new logo/icon, splash/loading redesign, lock screen redesign, dark mode, first-install name setup, personalized greetings, other major branding/onboarding work.

**Automatic transaction capture — V3**
Do NOT implement (except the pasted-text work the Phase 6 exception below allows): SMS transaction reading, bank/payment-company SMS parsing, automatic transaction creation, automatic financial-app detection, automatic classification, automatic confirmation/review, bank-specific parsing architecture.

**Automatic transaction editing/classification — V3**
Depends on automatic capture, so not part of V2.

**Phase 5 exception (explicit owner request):** accounts carry two nullable fields, `smsSender` and `lastDigits`, so V3's SMS work has somewhere to attach. They are stored only. No SMS reading, parsing, reconcile banner or automatic capture exists in V2 or Phase 5.

**Phase 6 exception (explicit owner request):** parsing SMS text that the owner pastes into the app is in scope, together with the review queue, pairing and reconcile work built on it. Pasted text is processed on the phone and is never sent anywhere. Automatic inbox reading (SMS permission, notification access, scanning the inbox, share-to-app capture) remains out of scope until the owner separately requests it and it has been checked against Google Play policy. Nothing is created from a message without the owner confirming it.

---

## PART B — CORE ACCOUNTING MODEL (Phase 5: accounts)

The app tracks **accounts**: the places where the owner's money actually is. Total Balance is the sum of those accounts. Goals are not extra money and not a separate pool; a goal is a **reservation** inside one account.

```
Total Balance 100,000   (this is true even while goals reserve some of it)
 ├── Cash        30,000
 ├── CBE         70,000   ← Laptop goal reserves 20,000 of this
 └── ...
```

### 1. ACCOUNTS

A named place that holds money, for example Cash, Telebirr, CBE, BOA, Awash Bank, Payoneer.

- `type`: `cash` | `wallet` | `bank`. The type decides the grouping on Home and the colour (Cash gold, Wallet orange, Bank teal). The colour is set from the type when the account is created.
- `currency`: `ETB`, or a foreign currency code that is on the Currencies & Exchange Rates screen **and has a stored rate**. An account in a currency with no stored rate cannot be created, because it could not be valued. The currency cannot be changed once the account has any entry.
- `smsSender`, `lastDigits`: optional, stored only (see Part A).
- A new account is created with a starting amount. If it is above zero it is saved as an `opening` entry dated the day the account is created (section 4). An account may also have NO opening entry (a starting amount of zero, or "Get it from my messages", Part Z): its balance is then zero until something is recorded, and every screen works with it.
- **Archive** hides an account and keeps its history. It is only allowed when the account's balance is exactly zero and no goal is held in it (move the goal to another account, or delete it, first). **Delete** is only allowed when the account has no entries at all.
- At least one account must exist before any transaction can be added.

### 2. TOTAL BALANCE

```
Total Balance = SUM over non-archived accounts of (account balance × today's rate to ETB)
```

ETB accounts count at 1. A foreign-currency account counts at the rate currently stored on the Exchange rates screen, so Total moves when that rate is updated; no ledger entry is created by a rate change.

Reserved goal money is already inside its account's balance. It is never added to Total a second time.

### 3. INCOME AND EXPENSES

Income increases one account. An expense decreases one account. Every income and expense has a required account ("Received in" / "Paid from"). A foreign-currency account takes entries in its own currency only. An ETB account also accepts a foreign amount: it is converted to ETB at the stored rate and the account changes by the ETB amount, with the original amount, currency and rate kept on the entry (Part D).

```
Cash 30,000 | CBE 70,000 | Total 100,000
Expense 5,000 paid from CBE  →  CBE 65,000 | Cash 30,000 | Total 95,000
```

### 4. SYSTEM ENTRIES

- `opening`: an account's starting balance, dated the day the account is created (or, when it is worked out from bank messages, the day before the oldest message; Part Z). The amount is greater than zero, and an account has at most one. An account with no `opening` entry is normal.
- `adjustment`: a signed, non-zero correction to an account's balance.

Both count in the account's balance. Neither is income, an expense, a category amount or an Insights figure, and neither counts for the streak.

### 5. TRANSFERS

A dedicated `transfer` kind, never "Type: Expense, Category: Transfer".

- Between two different accounts. Fields: `fromAccount`, `toAccount`, `fromAmount` (in the from-account's currency) and `toAmount` (in the to-account's currency). The same account on both sides is not allowed.
- **Same currency:** the two amounts are equal and Total does not change.
- **Different currency:** the owner types both amounts. Each leg is converted to ETB for the record at the rate on the transfer date (`fromAmountETB`, `toAmountETB`). Total can move; the difference is the exchange cost and is **not** income or expense.
- **Optional fee:** stored as its own `expense` entry in the from-account, category `Fees`, with `linkedTransferId` pointing at the transfer. The fee is recorded in the from-account's currency (a fee typed in ETB for a foreign account is converted at the stored rate for that date). The fee counts as an expense; the transfer itself does not. Editing or deleting the transfer edits or deletes its fee entry; a fee entry cannot be edited or deleted on its own.
- A transfer leg is always in its own account's currency; a foreign amount cannot be entered on a transfer into or out of an ETB account.
- Transfers are never income and never spending.
- A transfer saved from imported messages (Part Z, pairing) is the same transfer: one row, an optional linked Fees expense, and the usual validation. It may also carry a `dateSource` and a printed time as its timestamp (Part F).

```
CBE 60,000 | Telebirr 40,000 | Total 100,000
Transfer 10,000 CBE → Telebirr, fee 15  →  CBE 49,985 | Telebirr 50,000 | Total 99,985 (the 15 is an expense)
```

### 6. GOALS ARE RESERVED MONEY

- A goal has a target and a `heldInAccountId`. Goals can only be held in **ETB** accounts.
- **Adding money to a goal only reserves it inside that account.** It creates no ledger entry, so the account's balance is unchanged and still matches the bank. Withdrawing frees it again.
- Each add or withdraw is one row in `goal_allocations` (Part C). A goal's amount is the sum of its rows.
- Per account: `reserved` = the sum of the goal amounts held there; `free to spend` = balance − reserved. Total includes reserved money.
- A goal cannot reserve more than its account's free-to-spend amount at the time it is added, and cannot be withdrawn below zero.
- A goal's account can only be changed while the goal's amount is zero. A goal can only be deleted while its amount is zero.

### 7. SPENDING RESERVED MONEY (replaces "goals cannot pay for expenses")

Goals are not an expense source and not a transfer endpoint. Spending money that is reserved for goals is allowed, with a warning, and the goals shrink to match (Part E):

- If an expense, a transfer out, or an edit or delete of any entry makes an account's balance fall below its reserved amount, the shortfall is taken from the goals held in that account, **most recently contributed goal first**, by adding negative `auto_reduce` rows to `goal_allocations`.
- One `goal_reserve_used` notification is created per goal that was reduced.
- Nothing is restored if the entry is later edited back. The reduction is a record of what happened.

---

## PART C — ACCOUNTING ARCHITECTURE: LEDGER-DERIVED BALANCES (CRITICAL)

**This section overrides any implication elsewhere in this spec that balances are stored, mutable fields.**

Account balances, reserved amounts and each goal's amount must **NOT** be stored as fields that get incremented or decremented. They are **computed values**, derived at read time by summing the ledger and the allocation table:

```
Account.balance        = SUM(opening) + SUM(adjustment, signed)
                       + SUM(income received in the account)
                       − SUM(expenses paid from the account)
                       − SUM(transfer fromAmount out of the account)
                       + SUM(transfer toAmount into the account)
                         (all in the account's own currency)

Account.valueETB       = Account.balance × today's rate to ETB      (ETB accounts: × 1)
Total Balance          = SUM(Account.valueETB) over non-archived accounts

Goal[g].amount         = SUM(goal_allocations.amount where goal = g)
Account.reserved       = SUM(goal_allocations.amount where account = the account)
Account.freeToSpend    = Account.balance − Account.reserved
```

**Why:** every transaction and allocation is an immutable record. Editing a transaction means updating that one row; deleting removes it from the sum. There is no "reverse the old effect, apply the new effect" logic anywhere. Balances cannot drift.

`goal_allocations` is append-only in normal use: adding money, withdrawing and the automatic reduction each add a row (signed amount, positive to reserve, negative to free or reduce) with a `kind` of `manual` or `auto_reduce`. Rows are only removed when their goal is deleted, which requires the goal's amount to be zero.

**Performance:** at this app's scale, computing these sums live with no caching layer is correct. Do not add a materialized-balance layer.

---

## PART D — CURRENCY HANDLING

Accounts hold money in their own currency (ETB or one foreign currency). Total Balance, goals and all reports are in ETB.

**Every income and expense entry stores:**
- `amount` + `currency` — the amount as entered.
  - In a **foreign-currency account** the currency **must equal the account's currency**, and the account changes by `amount`.
  - In an **ETB account** the currency can be ETB or any currency on the Currencies list; the account changes by `amountETB`, and `amount` + `currency` are the original, for display.
- `amountETB` — the ETB value, converted at entry time with the rate on the entry date (ETB amounts: rate 1).
- `exchangeRate` — the rate used. A per-entry override replaces the stored rate for that one entry only and never updates the stored default rate.

**Which field is used for what (this amends the old "only `amountETB` is used in maths"):**
- **Reports and income/expense maths** (Insights, category totals, budgets, monthly income and expenses) use `amountETB` only.
- **Account balances** use the native `amount` (a USD account keeps its balance in USD).
- **The ETB value of an account** (Home, Total) is its native balance × **today's stored rate**. When the rate changes the totals change; no ledger entry is created.
- If the stored rate for a foreign account is more than 7 days old, the UI shows "Rate last updated X days ago" near the total. The age comes from the rate row's `updatedAt`.
- If a foreign account has no stored rate, it cannot be valued: it is left out of Total and the UI says so. It must never be valued silently at 1:1.

**Transfers** store `amountETB` for the from leg and `toAmountETB` for the to leg, each at the rate on the transfer date (Part B section 5).

**Rates** are still managed on the Currencies & Exchange Rates screen (one current rate per currency). A rate change applies going forward and to today's valuation; it never rewrites an entry.

**Goals** are always ETB, held only in ETB accounts.

---

## PART E — NEGATIVE BALANCES AND RESERVED MONEY

**An account can never go below zero.** If an expense, a transfer out, an adjustment, or an edit or delete of any entry would take an account's balance below zero (checked against that account, in its own currency, in date order, with the check made at the end of each calendar day), **block the action and show a warning.** Nothing is written. The other accounts' balances are irrelevant to this check.

**Reserved goal money does not block.** After every write the app compares each account's balance with its reserved amount:

- In the Add form, when the entry would leave `balance < reserved`, show a warning under the amount: "This uses ETB X of the ETB Y reserved for goals." The user can still save.
- On save, the shortfall is taken from the goals held in that account, most recently contributed goal first (Part B section 7). A goal's "most recent contribution" is the latest `manual` positive allocation row it has in that account.
- One `goal_reserve_used` notification per reduced goal: "ETB X reserved for <goal> was used. <goal> is now ETB A of B."
- The same check runs after an edit or delete of any transaction, and handles it the same way. Invariant after every write: for every account, `0 ≤ reserved ≤ balance`, and every goal's amount is `≥ 0`.

---

## PART F — TRANSACTION MODEL

Entry kinds: `income`, `expense`, `transfer`, plus the system kinds `opening` and `adjustment`.

**Income:**
`Type: Income | Account (Received in) | Amount | Currency (= account's) | amountETB | Category | Source | Date | Notes`

**Expense:**
`Type: Expense | Account (Paid from) | Amount | Currency (= account's) | amountETB | Category | Date | Notes | linkedTransferId (fee entries only)`

**Transfer:**
`Type: Transfer | From account | To account | fromAmount | toAmount | amountETB (from leg) | toAmountETB | Date | Notes`

**Opening / Adjustment:**
`Type: Opening or Adjustment | Account | Amount (opening > 0, adjustment signed and non-zero) | Date | Notes`

An `opening` entry is created with its account and is not edited as a transaction (a small correction to the starting balance is an `adjustment`); an adjustment stays an adjustment. The one way to change the opening itself is the previewed "Opening balance" change of Part Z (Phase 6C-3), which moves or replaces that one entry and nothing else.

**Date and timestamp.** Every entry has a `date` (a calendar day: every balance rule uses it) and a `timestamp` that only orders entries within a day. The timestamp is normally the moment the entry was saved; an entry imported from an SMS that prints a time uses that time instead (Part Z), so same-day entries sit in the order they happened. Entries without a time are ordered within the day by the balance chain where it can be worked out. The timestamp never changes a balance.

**Date source.** An entry imported from an SMS also carries an optional `dateSource`: `message` (printed in the message), `paired` (taken from the other side of an own-account transfer), `receipt` (decoded from a CBE receipt reference), `batch` (the date chosen on the paste screen) or `manual` (set by the owner). It is empty for entries that did not come from an SMS and for entries whose date the owner has confirmed. It is a label only: it never affects a balance, a total or the streak. Editing an entry's date, or confirming it, clears the estimate.

**Validation:**
- Income and expense need an account that exists and is not archived and an amount above zero. In a foreign-currency account the currency must equal the account's; in an ETB account any listed currency is converted to ETB (a missing rate blocks the entry).
- A transfer's two accounts must differ. A transfer with the same currency on both sides has `fromAmount = toAmount`. A transfer cannot involve a goal.
- No entry can be added while no account exists.
- No expense or transfer out may take an account below zero (Part E).

**Tables** (Phase 5): `accounts`, `transactions` (with `account_id`, `from_account_id`, `to_account_id`, `to_amount`, `to_amount_etb`, `linked_transfer_id`, `date_source`), `goals` (with `held_in_account_id`), `goal_allocations`, `notifications` (for `goal_reserve_used`), and `recurring_transactions` (with `account_id`). `categories`, `budgets`, `currencies` and `exchange_rates` are unchanged. A `Fees` expense category is part of the default seed.

---

## PART G — EDIT TRANSACTION

Because balances are ledger-derived (Part C), editing a transaction is simple: **update the row's fields. That's it.** There is no separate "reverse then reapply" step — the balance is automatically correct the next time it's computed, because it was never stored as a mutated number in the first place.

A transfer's fee entry is the one exception to "one row": it is its own expense row, linked to the transfer, and it is updated, created or removed whenever the transfer is edited or deleted. Still no reversal logic: the balance is recomputed from the rows.

---

## PART H — HOME SCREEN

Do not redesign the entire Home screen from scratch. Preserve the existing visual language but update the financial hierarchy to reflect the accounts model.

Home should answer: (1) How much money do I have? → Total Balance. (2) Where is it? → accounts. (3) What happened this period? → Income/Expenses/Net.

```
Total Balance 👁
(Rate last updated X days ago — only when a foreign rate is more than 7 days old)

[ Cash ]  [ Wallet ]  [ Bank ]      one tile per type that has accounts, each with its ETB subtotal
Includes ETB X reserved for goals   (only when goals reserve money and balances are shown)

This Month
Income           Expenses
amount           amount

Net (Income - Expenses)

Streak

Recent Transactions
```

Home has no separate list of accounts. Each tile opens the Accounts screen on that type, and the side menu has an "Accounts" link. The Accounts screen groups Cash / Wallet / Bank, each account showing its balance (in its own currency, with the ETB value for foreign accounts). Do not show reserved goal money as an extra figure on top of Total (a short "includes … reserved" line is fine); the account detail screen shows "Reserved for goals / Free to spend". Do not call Net "Available".

---

## PART I — HIDE BALANCES BY DEFAULT

Keep the existing eye button. Total Balance and every account balance are hidden (`••••••••••`) by default; the eye button reveals them. Do not remove this functionality.

---

## PART J — INSIGHTS FUNCTIONALITY

Fix existing Insights:
- Weekly / Monthly / Custom period selector must actually work, and the chart title must match the selected period ("Weekly Trend" / "Monthly Trend" / "Custom Period").
- Month navigation (←/→) must actually change the displayed month and update all data/charts.
- Custom period: implement start date / end date selection, and update Income, Expenses, Net, spending categories, income sources, and charts to reflect it.
- Top metrics: Income, Expenses, Net — all ETB, no per-currency breakdown (see Part D).

---

## PART K — RECENT TRANSACTIONS RESPONSIVENESS

Fix Home → Recent Transactions layout. Long amounts (e.g. `ETB 1,000,000`) must never overflow cards. Handle long merchant names, long categories, smaller Android screens, and larger accessibility font sizes. Use responsive layout, not hard-coded widths.

---

## PART L — ANDROID SYSTEM NAVIGATION & BACK BUTTON

- Bottom navigation must not conflict with Android's gesture area or 3-button navigation.
- Android Back must follow proper navigation stack behavior (pop one level at a time), not force-return to Home. Handle modal-close, form-editing-return, and nested-page-pop cases appropriately.

---

## PART M — ANDROID STATUS BAR

Time/signal/Wi-Fi/battery icons must always remain visible. Status bar icon contrast should adapt to light/dark backgrounds (dark icons on light backgrounds, light icons on dark backgrounds). Content must not overlap the status bar.

---

## PART N — STREAK

Audit and correct the existing Streak feature.

**Rule:** any legitimate financial activity the user records counts for that calendar day: an income, an expense, a transfer, or a manual add to (or withdraw from) a goal. Opening the app, viewing Insights, or opening Settings does NOT count.

**Does not count:** `opening` entries, `adjustment` entries, the automatic reductions that happen when reserved money is spent, and rows generated by recurring rules.

---

## PART O — CATEGORIES

Keep centralized under Settings → Categories. Support Add/Edit/Delete, category type, descriptive icon. Do not put Categories back into bottom navigation. New categories should auto-receive an appropriate icon when possible.

---

## PART P — BUDGET

Redesign to match the clean/elegant design language while keeping functionality: category dropdown, currency dropdown, monthly limit, budget tracking, over-budget warning (surfaced on Home + notification).

---

## PART Q — RECURRING

Redesign using the established visual language as a management/list-based UI (not just a form). Support Upcoming / All views, amount, frequency, date, enable/disable toggle, add/edit. Keep existing working functionality.

Each recurring rule belongs to one account (`accountId`) and is recorded in that account's currency. The generator posts income or an expense into that account, and is blocked by the same rules as any entry (Part E); a skipped occurrence still raises the existing "Recurring transaction skipped" notification.

---

## PART R — SAVINGS GOALS

Goals are reservations inside an ETB account (Part B section 6), not separate money. Active / Completed sections. Three-dot menu (Edit/Delete) — not large permanent buttons. "Add money" and "Withdraw" are subtle, not a loud blue CTA.

- A goal shows a "Held in" account chip and a short explanation that the money is still in that account.
- **Add money:** Amount → the goal. It reserves the amount inside the goal's account (no ledger entry).
- **Withdraw:** frees reserved money. The account balance does not change.
- There is no source account to choose: the money is already in the goal's account.

Spending reserved money is handled by Part E, not by a goal action. The monthly "savings" figure on Home and in snapshots is the **net change in reserved goal money for the period** (adds minus withdrawals, including automatic reductions).

---

## PART S — SETTINGS

Redesign using existing reference/design direction. Include Categories, App Lock (clean toggle), About, other existing settings. Categories live in Settings, not bottom nav.

---

## PART T — JOURNEY

Journey functionality already works — do NOT redesign its behavior. Only update visual design to match V2's design language. Only change underlying behavior to fix an actual bug.

---

## PART U — DESIGN LANGUAGE

Target: clean, elegant, modern personal-finance app.

**Avoid:** overly saturated colors, excessive cards, huge buttons, screaming blue CTAs, inconsistent icons, different UI styles per page, excessive borders, clutter.

**Use:** clear hierarchy, soft backgrounds, clean cards, dark navy/neutral typography, orange accent where appropriate, subtle secondary actions, consistent spacing/corner radius/iconography, responsive layouts.

The existing orange accent should remain visually recognizable and consistent.

---

## PART V — DATA: STARTING FRESH

**No migration from existing/old data.** This is a clean-slate rebuild of the data layer; existing test data on-device does not need to be preserved or migrated.

**Phase 5 reset (schema 3 → 4):** the `transactions`, `goals` and `recurring_transactions` tables are dropped and recreated, and the new `accounts`, `goal_allocations` and `notifications` tables are created. `categories`, `budgets`, `currencies`, `exchange_rates` and `user_origin` are kept, and a `Fees` expense category is added if it is missing. `milestones` and `monthly_snapshots` are cleared (they described the old goal and savings model). The stored notification read ids are left untouched. After the reset there are no accounts: the app shows an "Add your first account" setup and blocks adding transactions until one exists.

---

## PART W — ACCOUNTING TEST CASES

Verify these scenarios before considering Phase 5 accounting complete. All values come from the ledger and allocations (Part C). Unless stated, accounts are ETB and the USD rate is 55 ETB/USD. "Total" is Total Balance in ETB.

**Test 1 — Opening balance:** Create CBE with a starting amount of 100,000. Expect CBE 100,000 / Total 100,000, an `opening` entry dated today, and Income 0 / Expenses 0 for the month.

**Test 2 — Income into an account:** Cash 30,000 and CBE 70,000 (openings). Add Income 10,000 into CBE. Expect CBE 80,000 / Cash 30,000 / Total 110,000 / month Income 10,000.

**Test 3 — Expense from an account:** Same start. Expense 5,000 paid from CBE. Expect CBE 65,000 / Cash 30,000 / Total 95,000 / month Expenses 5,000.

**Test 4 — Transfer between accounts:** CBE 60,000, Telebirr 40,000. Transfer 10,000 CBE → Telebirr. Expect CBE 50,000 / Telebirr 50,000 / Total 100,000, and Income and Expenses unchanged.

**Test 5 — Transfer with a fee:** CBE 60,000, Telebirr 40,000. Transfer 10,000 CBE → Telebirr with fee 15. Expect CBE 49,985 / Telebirr 50,000 / Total 99,985. The fee is its own expense entry (category Fees, in CBE, linked to the transfer); month Expenses 15; the transfer is not counted as income or expense.

**Test 6 — Fee follows the transfer:** Continue Test 5. Edit the fee to 20: CBE 49,980, still exactly one fee entry (20). Delete the transfer: both entries are gone and CBE is 60,000 / Telebirr 40,000.

**Test 7 — Cross-currency transfer:** CBE 100,000, Payoneer (USD) 0. Transfer 11,000 ETB out of CBE into Payoneer, `toAmount` 195 USD. Expect CBE 89,000 / Payoneer 195 USD / Total 99,725 (89,000 + 195 × 55). The legs' `amountETB` are 11,000 and 10,725. The 275 difference is not income or expense.

**Test 8 — Foreign account follows the rate:** Payoneer 200 USD at rate 55 → valued 11,000. Update the rate to 60 → valued 12,000 and Total rises by 1,000, with no new ledger entry. A rate last updated 6 days ago is not flagged; 8 days ago is flagged ("Rate last updated 8 days ago").

**Test 9 — Foreign expense in a foreign account:** Payoneer 200 USD. Expense 50 USD at rate 55. Expect Payoneer 150 USD, entry `amount=50, currency=USD, amountETB=2,750`, month Expenses 2,750 (not 50), Total valued with the current rate.

**Test 10 — Currency rules by account type:** (a) Cash (ETB) 10,000: an expense of 50 USD at rate 55 is accepted; it is stored as `amount=50, currency=USD, exchangeRate=55, amountETB=2,750`, Cash becomes 7,250, and month Expenses rise by 2,750 (a per-entry override rate of 60 gives 3,000 and does not change the stored rate). (b) With no stored USD rate that entry is rejected. (c) An expense entered in ETB, or in EUR, against Payoneer (USD) is rejected and nothing is written.

**Test 11 — Negative balance blocked per account:** Cash 1,000, CBE 100,000. Expense 1,500 from Cash: blocked with a warning, no entry created (CBE's balance does not help). A transfer out of Cash above its balance is blocked the same way. Income 2,000 followed by an expense of 2,500 on Cash on the same day (start 1,000) is allowed, because the day ends at 500; the expense on its own, before the income exists, is blocked.

**Test 12 — Edit a transaction (ledger model):** Expense 5,000 from CBE; edit it to 7,000 from Cash. Expect balances to reflect only the updated row, with no double effect.

**Test 13 — System entries excluded:** Opening 50,000 and an adjustment of −2,000 on Cash. Expect Cash 48,000, and Income, Expenses and every category total unchanged by both.

**Test 14 — Adding to a goal reserves, it does not move money:** CBE 100,000, a Laptop goal held in CBE. Add 10,000. Expect CBE balance 100,000, reserved 10,000, free to spend 90,000, Total 100,000, Laptop 10,000, no transaction created, one allocation row.

**Test 15 — Withdraw frees reserved money:** Continue Test 14. Withdraw 4,000. Expect Laptop 6,000, reserved 6,000, balance unchanged.

**Test 16 — Goals only in ETB accounts:** Creating a goal held in Payoneer (USD) is rejected.

**Test 17 — Reserved overspend warns, then reduces the most recent goal first:** CBE 100,000. Laptop 30,000 reserved first, Car 20,000 reserved second. The Add form warns for an expense of 60,000: "This uses ETB 10,000 of the ETB 50,000 reserved for goals." Saving it leaves CBE 40,000 / Total 40,000, Car 10,000, Laptop 30,000, one `auto_reduce` row (−10,000, Car), one notification (Car, amount 10,000, now 10,000), and reserved 40,000 ≤ balance 40,000.

**Test 18 — Several goals touched:** Same start, expense 80,000. CBE 20,000; Car 0 (−20,000), then Laptop 20,000 (−10,000). Two notifications, one per goal.

**Test 19 — Edit and delete re-check reserved:** CBE has opening 30,000 and income 70,000; Laptop 60,000 reserved. Edit the income to 20,000: balance 50,000 < 60,000, so Laptop is reduced by 10,000 and one notification is created. Deleting an entry has the same effect.

**Test 20 — Reductions are not ledger activity:** After Test 17 the ledger still holds only the openings and the one expense; the `auto_reduce` row appears in no income, expense or category total.

**Test 21 — Streak:** A manual add to a goal counts for its day. `opening`, `adjustment`, an automatic reduction and a recurring-generated row do not.

**Test 22 — Savings figure:** In one month: goal adds of 10,000 and 5,000, a withdraw of 3,000, and an automatic reduction of 1,000. The monthly savings figure is 11,000.

**Test 23 — Accounts rules:** Archiving an account with a non-zero balance or a goal held in it is refused; with zero balance and no goal it succeeds. An account with entries cannot be deleted. Its currency cannot be changed once it has an entry. With no accounts, adding any transaction is rejected.

**Test 24 — Backup round trip (version 3, and version 4):** Export then import gives identical accounts, balances, goal amounts, reserved amounts and notifications; a version 4 export also gives back the same handled messages.

**Test 25 — Restoring a version 2 backup:** Everything goes into one ETB account named "Cash" (balance = the old total). Each old goal is restored as a reservation held in Cash for the amount it held. Old transfers between Available and Saved are dropped (they never changed the total). Foreign-currency rows keep their original amount, currency and rate and are valued in Cash at their old `amountETB` (an ETB account accepts these). The result message says all of this. If the goals hold more than the backup's total, the restore fails with a message and changes nothing.

---

## PART X — IMPLEMENTATION ORDER

*Historical: this is the original V2 build order, written for the Available / Saved model that Phase 5 replaced. It is kept as a record; the amended Parts above (and Part Y) are the current rules.*

**Step 1 — Inspect.** Project structure, frontend architecture, storage/database, transaction model, current balance calculation approach, Income/Expense/Savings/Goal logic, navigation, Streak logic, Insights logic, Settings, Budget, Recurring, Categories. Do not start making UI changes before this is done and reported back.

**Step 2 — Rebuild the accounting architecture.** Implement ledger-derived Total Balance, Available, Saved, Goals (Part C). Implement Income, Expenses, Transfers, Goal contributions/withdrawals, expense source restrictions, currency handling (Part D), negative balance blocking (Part E). Run Test Cases 1–13 before moving on.

**Step 3 — Update Transactions.** Income destination, Expense source, Transfer type with From/To, Goal restrictions, simplified edit (Part G). Test thoroughly.

**Step 4 — Update Home.** Hidden balances, Total/Available/Saved, Income/Expenses/Net, responsive Recent Transactions, Streak.

**Step 5 — Update Insights.** Weekly/Monthly/Custom, month navigation, dynamic chart labels, all metrics, charts.

**Step 6 — Fix Android behavior.** Back stack, system navigation/gesture area, status bar contrast, safe-area insets.

**Step 7 — Update Goals.** All transfer directions, no Goal→Expense, Active/Completed UI, three-dot actions, elegant Contribute.

**Step 8 — Update Settings/Categories/Budget/Recurring/Journey.** Apply V2 design system while preserving working functionality (Journey: visual only, per Part T).

**Step 9 — Final regression testing.** All 13 test cases, new transactions, editing, deleting, navigation, Android Back, different screen sizes, hidden balances.

---

## PART Y — PHASE 5 ADDITIONS (built after the accounts model)

Rules added while the accounts model was built. They are part of the spec.

**Account names are unique.** Creating or renaming an account is refused if another account — archived ones included — has the same name, ignoring case and leading, trailing and repeated spaces. The message names the existing account and suggests the first free "<name> 2", "<name> 3", … (error code `DUPLICATE_ACCOUNT_NAME`). The forms show it live under the name field and keep the button off until it is fixed. Names are stored tidied. Accounts that were already duplicates still load and work; a rename must not *create* a new collision, so renaming one of them to a free name, or to its own name, is allowed.

**Currencies.** A currency cannot be removed from the Currencies list while a non-archived account is held in it; the message names the account. An archived account does not block it (it is empty, hidden and kept only for history; its entries keep their own currency and the stored rate stays). A foreign account cannot be created without a stored rate: choosing a currency with no rate sends the owner to the Exchange rates screen and back, with their choices kept.

**Hidden balances.** One flag, `isBalanceHidden`, in the shared UI store: it starts hidden on every launch, is not saved, and only the eye buttons (Home and the Accounts header) change it. Every screen that shows a balance — Home, Accounts, account detail — reads that flag and masks through one shared helper. Opening an account from a Home tile does not change it. Amounts in transaction lists are unchanged by it.

**Notifications.**
- Two kinds share one page and one badge: budget alerts (recomputed from the data every launch) and goal notifications (saved, kind `goal_reserve_used`: "ETB X reserved for <goal> was used. <goal> is now ETB A of B."). Newest first.
- Opening the page marks nothing. Unread items show a dot, a slightly stronger background and a spoken "Unread." A tap marks that item read; whatever is left is marked read when the owner leaves the page, so the badge drops then.
- Tapping a goal notification opens the Goals tab with the goal in a route param: the tab scrolls to it and highlights it. If the goal does not exist (for example from a restored backup) the tab says "That goal no longer exists."
- Deleting a goal deletes its saved notifications and their read records. Saved goal notifications are removed 30 days after they were created, read or unread, when the app loads (`RESERVE_NOTIFICATION_RETENTION_DAYS`; exactly 30 days old is kept). "Clear all" (with a confirmation) deletes the saved goal notifications and marks the current budget alerts read, since those cannot be deleted.

**Backup.** Version 3 holds accounts, transactions (every entry type, transfers with their fee rows; each may carry an optional `dateSource`, and a backup without it restores with none), goals, goal allocations, notifications with their read flags, categories, budgets and exchange rates. Restore validates the ledger first (no negative balance, no goal holding more than its account) and changes nothing if it fails; it drops notifications older than 30 days, clears recurring rules (they point at accounts and are not in a backup) and adds any currency the restored data needs. From Phase 6D-1 an export is **version 4**: version 3 plus the handled messages (Part Z, "Backup of handled messages"). A version 3 backup restores as before, leaving the device's handled messages untouched. A version 2 backup restores as described in Test 25.

**Checks.** `scripts/verify-accounts.ts` (the ledger, Part W, names, currencies, backup round trip, retention, migration), `verify-accounting.ts` (Insights, goals, streak, budgets, notifications page rules, search), `verify-home.ts` (Home and hidden-balances rules), plus the existing contrast, splash, fonts, greeting, budget-alert and appearance scripts.

---

## PART Z — PHASE 6: IMPORT FROM SMS (paste, staging, review, pairing, balances, opening balance, backup, your names)

Built on the Phase 6 exception in Part A. Messages are pasted by the owner, read on the phone, and never sent anywhere. Pasting is the only way in; nothing reads the inbox.

**Entry points.** "Import from SMS" in the side menu, and a small button on the Add transaction screen. The paste screen has a large text box and a Paste button (clipboard). If the clipboard is empty or access is refused the screen says so and the box can still be pasted into by long-press.

**What is saved from a message.** The parsed fields (service, direction, amount, charges, counterparty name / bank / tails, reference, date, balance, package name) and the hash of the normalised text. The message text itself is never stored. A message that could not be read is shown while the owner is on the paste screen and is not kept.

**Staging.** One row per recognised message in `sms_suggestions`, status `pending`, `confirmed` or `ignored` (the owner sees "ignored" as **Skipped**). `rawHash` is unique: a message whose hash is already in the table in any status (pending, confirmed or skipped) is never suggested again, and the same message pasted twice in one block counts once. The paste screen ends with a summary: new, already handled, **not transactions** (one-time codes, promotions, airtime-received notices, anything with no amount), and could not read (the only group that shows the original text, and each of those has an "Add manually" button that opens Add transaction). "Not transactions" is folded away until opened and shows only a hidden version of each message (see the hidden copy below). Every card in those two groups offers the hidden copy.

**Dates.** Each suggestion's date has a source, in this order of priority:
1. `message`: a date and time printed in the message (Telebirr, Awash);
2. `paired`: the date and time of the other side of an own-account transfer, once the owner accepts the pair (Phase 6C-1);
3. `receipt`: for CBE, the date decoded from the receipt reference in the receipt link (below). A date only, no time;
4. `batch`: the one date chosen on the paste screen, default today.

The batch date is asked only when some new message has neither a printed date nor a usable receipt date. Each card's date can then be edited, which makes its source `manual`.

**Receipt dates.** A CBE receipt reference looks like `FT` + a 2-digit year + a 3-digit day of the year + more characters. The year is 2000 plus the two digits and the day must exist in that year (366 only in a leap year); the date is checked to be real, not after today, and not older than 1,827 days (`RECEIPT_MAX_AGE_DAYS`, five years). Anything else (a short or garbled reference, an empty link, a future or very old date) is ignored and the message falls to the batch date. Receipt dates are exact to the day and carry no mark.

**Estimated dates.** A date that came only from the batch default is estimated. The review card says so, and the saved entry keeps `dateSource: batch`, which shows a quiet "date estimated" mark on the Transactions list and a "Date is right" button on the entry's edit screen, until the owner edits the date or confirms it. A date printed in a message, taken from a paired message or decoded from a receipt shows no mark.

**Times.** An entry saved from a message that prints a time stores that time as its timestamp.

**Direction.** An outgoing message is an expense and an incoming one is income, including money sent to or received from a person. Importing a single message never creates a transfer between the owner's own accounts; a transfer only comes from an accepted pair (below).

**Accounts.** An account can store an SMS sender and its last digits (both optional, edited with the account). New accounts pre-fill the sender from the quick pick: Telebirr 127, CBE CBE, BOA BOA, Awash Awash Bank. A message is matched to an account whose sender maps to the message's service, preferring one whose last digits equal the digits the message printed; if only one non-archived ETB account fits the service it is used; otherwise the card asks the owner to choose and offers to link that account. Messages are ETB, so only non-archived ETB accounts are offered.

**Review.** One card per pending suggestion: direction, amount, account, date, counterparty, category, a "Remember for this recipient" switch (on by default), an editable fee line, and Save / Skip / Edit. The category starts as **Uncategorised** unless a remembered recipient or a hint names one the owner has: package payments and airtime suggest a category named like Phone, Internet, Airtime or Data, and bill payments one named like Bills, Utilities, Electric or Water.
- Recipient memory (`recipient_rules`: key, category, last used). The key is the merchant, bill or payment code when the message has one (a merchant's name changes with its branch, its code does not); otherwise the normalised name (lower case, single spaces, no punctuation); with no name it is the phone tail, or the bank and account tail. A remembered category is used only if it still exists for that direction. Nothing is remembered for Uncategorised.
- Warnings: a possible duplicate (an existing income or expense in the same account with the same amount on the same date); the entry would use money reserved for goals (a warning, never a block, as in Part E); the entry would take the account below zero (blocked, nothing written). A message of either direction dated before the account's opening balance is blocked with "This is dated before the account's opening balance on <date>." (an expense would also fail the balance check; an income would otherwise be counted twice, because the opening balance the owner typed already includes it). This applies to messages only: manual entries are unchanged.
- "Save all that are clean" saves, oldest first, every card that has an account and no warning or block (a category is not required), and reports what it did: while it runs the screen shows "Saving 3 of 12" and nothing else is redrawn per message; when it ends it says "Saved N." or "Saved N. M not saved because:" with one line for each message that was not saved and the reason (no account chosen, a warning, a block, a possible transfer waiting for an answer, a note that a message seems to be missing before it, or an error), and in the second case the owner stays on the review page with those messages still waiting. Each message is written to the database in its own transaction as it goes; the screens are brought up to date once at the end. A batch never ends silently and never throws: an unexpected error stops it, is shown, and lists what was not tried.

**Uncategorised.** Two built-in categories named "Uncategorised", one for income and one for expense, are added by schema 6 (and seeded on a fresh install). They cannot be deleted, renamed or re-typed. A card that has no category is saved as Uncategorised, and Transactions shows an "Uncategorised (N)" shortcut that lists only those entries so they can be fixed one by one.

**Skipped.** "Skip" moves a card out of the queue; the review screen lists them under "Skipped (N)", each with a Restore button that returns it to pending with the choices it had. A skipped message is not suggested again unless restored.

**Message formats.** Telebirr merchant payments ("for Service Fee from <code> - <name>" and "to <name> with Payment number <n>", fee and VAT may be zero, the balance may be on a new line), airtime recharges, bill payments (balance worded "Your telebirr account balance is"), and CBE "has been debited for <NAME> with ETB x" (no fee). The notice that airtime arrived on a number ("received ETB x airtime from <number>") is not money and prints no balance: it is a "not a transaction", and shares its transaction number with the recharge, which is the one transaction. Pasted text is tolerated as it comes from a chat export: a leading "[date time] Name:" (or "date, time - Name:") is removed and starts a new message, and Telebirr's support footer (Send SMS to 126, Telegram, Facebook, website) is dropped, so the same message hashes the same however it was copied.

**Boilerplate pieces are not "Not transactions".** When a paste is cut into messages, a piece that is only known boilerplate is dropped silently and counts nowhere: Telebirr's "Thank you for using telebirr" with "Ethio telecom", a lone "Dear <name>" greeting (the name is at most three words, so a sentence is never taken for one), the Awash "Alert: ... will never ask for your PIN" paragraph, the CBE "Thank you for Banking with CBE" and "For feedback <link>" tails, and the Bank of Abyssinia "Link your Fayda" and "For help, call" lines. They are dropped, not attached to the message above, so no message's text or its hash changes and a message already saved is still recognised as handled. Only a whole piece that matches counts as boilerplate: the same words inside a message, or a piece with anything else in it, are kept, so a code, a promotion or a fragment Talari does not recognise still shows under "Not transactions". Parsed amounts, dates and balances never change.

**Text from links.** A name that came through a link can be percent-encoded ("A%26B" for "A&B"). Every name read from a message (the counterparty, a bank, a package) is decoded, each run on its own and only once; a run that is not valid is left exactly as it was, and an encoded control character becomes a space. The only value read from a receipt link is the CBE reference, which may have its slash encoded (%2F), stops before an "&" or its encoding, and is kept in upper case. Names stored by an earlier version read back decoded; the stored text is not changed.

**Amount, charges and total.** For money that goes out, a message's figures are read by one rule for every bank:
- **Amount** is the money that went to the other party, WITHOUT charges. **Fee** is every charge added together (service charge, VAT, any other charge). **Total debited** is the amount plus the fee, and it is what leaves the account.
- When a message prints charges and a total, amount + fee must equal the total to the cent. If the figure that would be read as the amount is the TOTAL itself (a message can print the total where another prints the transferred amount), the amount is the total minus the charges, never the total; otherwise the charges would be saved on top of a total that already holds them, and the fee would be counted twice. The card says when it did this.
- If a message prints a total and the charges are all zero or not itemised, the fee is the total minus the amount.
- If the figures do not add up in any of these ways, nothing is guessed: the card says the amount, the charges and the total do not agree, and it is not "clean", so "Save all that are clean" leaves it for the owner.
- A message that prints only one figure for what was debited (BOA, Awash, a CBE "debited for" message) has that figure as the amount and no fee, unless the owner adds one.
- The printed balance after is the check that no figure was misread: it must equal the balance before minus the total debited (Phase 6C-2). A difference equal to the message's own fee means that balance dropped by only the amount.
- A suggestion that is still waiting when this is corrected is shown with the corrected figures. Entries already saved are never changed silently.

**Repairing a fee counted twice.** Entries saved by an earlier version from a message that printed the total debited as its amount carry the TOTAL as their amount AND a separate Fees expense for the charges, so the account is lower than the bank by the fee. A quiet card "Fee counted twice (N)" lists them, at the top of Transactions and on the affected account's screen, and only while N is above zero.
- **When an entry is listed.** All of these hold: it was saved from a message that is confirmed, whose amount equals its printed total and whose charges are above zero; the entry still exists as an expense whose amount is still that total; the fee entry saved with it (same account and date, category Fees, created at the same time, amount equal to the fee that was saved) still exists; and neither entry has been edited since it was saved. A transfer, a deleted entry, an entry or fee row changed by hand, and an entry that is already right are never listed.
- **The row.** Date, account, and what will change: "ETB 3,001.20 → ETB 3,000.00; your CBE balance goes up by ETB 1.20". Amounts are hidden while balances are hidden.
- **Fix.** After a confirmation it changes ONLY the entry's amount, to the total minus the fee entry's amount, through the normal edit: the fee entry, the date, the date source, the category, the source and the time are untouched. "Fix all" asks once and says the total effect on each account. Each fix, and Fix all as a whole, is all or nothing, and is checked again against the ledger as it is at that moment (a list shown earlier may be out of date).
- **Safety.** Making an expense smaller never takes an account below zero and never touches money reserved for goals. After a fix the entry does not match any more, so it is not listed again, including after the app restarts.

**Fees.** The fee, VAT and any other charge printed in a message are added up into one editable fee. If it is above zero it is saved as its own expense in the Fees category, in the same account and on the same date, with the note "Fee for <counterparty>". It is not linked to the main entry (a link is only for transfer fees, Part B section 5), so deleting one later does not delete the other.

**Saving is all or nothing.** The main entry, the fee entry, marking the suggestion `confirmed` with the id of the main entry, and the recipient rule update are validated together as one set and written in one database transaction. If any step fails, none of them is kept and the suggestion stays pending; a retry produces exactly one main entry. Goals that shrink because reserved money was used behave as in Part E.

**Streak.** A confirmed message counts for the streak like a manual entry (`isAutomatic` stays false), because the owner confirmed it.

**Schemas 5, 6, 7, 8 and 9.** All are additive only. Schema 5 creates `sms_suggestions` and `recipient_rules`. Schema 6 adds a nullable `counterparty_code` column to `sms_suggestions` and the two Uncategorised categories (only on a device that already has categories; a fresh install seeds them). Schema 7 adds nullable `date_source` columns to `transactions` and `sms_suggestions`, a nullable `paired_with_id` column to `sms_suggestions`, and a `reconcile_dismissals` table (the last two are used from 6C-1 and 6C-2). Schema 8 adds a `pair_rejections` table (a key for the two messages, the reason "not a pair" or "keep separate", and when), which is how a rejected pair is remembered. Schema 9 adds an `own_names` table (Phase 6D-3). None changes or deletes any existing row; an old row's empty `date_source` is read as no estimate (an entry) or as "message if it has a printed time, otherwise batch" (a suggestion). Each is all-or-nothing, can run twice safely, and leaves `user_version` where it was if it fails.

**Pairing own-account transfers (Phase 6C-1).** Two messages that describe one movement between two of the owner's own accounts are offered as ONE transfer, never as an expense plus an income. A pair is only ever a suggestion: nothing is merged unless the owner accepts it.
- **When two sides are a pair.** One side is outgoing from one of the owner's accounts and the other is incoming into a different one, both accounts are in ETB, the amounts are equal, and at least one rule holds:
  1. *Same number:* both messages carry the same transaction or receipt number (a Telebirr transaction number that the receiving bank prints as its reference, for example). The messages may be on different days.
  2. *Naming the other side:* both are on the same day and one message names the other side's bank or wallet (a Telebirr "received from Commercial Bank of Ethiopia" and a CBE debit of the same amount).
  3. *Your own name (Phase 6D-3):* both are on the same day, and either the sending message names one of the owner's names as the person it went to, or the receiving message names one of the owner's names as the person it came from (see "Your name as banks write it" below). It is the weakest rule, so it is used only for a pair that rules 1 and 2 do not offer, and never for a message that rules 1 or 2 already offer in another pair. It is offered only when it is unambiguous: if a message could be matched by this rule with more than one other movement (another message, or one of the owner's entries), none is offered and a note says why ("Your own name is on a message of ETB X on <date>, which could be a transfer between your accounts, but more than one other movement fits it (...). Nothing is offered. Skip or fix one of them and the offer will appear."), and "Save all that are clean" leaves those messages alone. Rejecting a pair ("Not a pair") removes it from the count, so the remaining one is then offered.

  Near misses are not offered: a different amount, a different day under rule 2, the same amount where neither side names the other or the owner, a foreign-currency account, two outgoing or two incoming sides, or the same account twice.
- **One card, three answers.** A pair is shown as one card with both sides (account, amount, date and where each date came from), the date the transfer will take, and the fee. **Accept** saves one transfer. **Not a pair** says the two are unrelated; **Keep separate** says they are related but should be saved as separate entries. Both are remembered, so the same two messages are not offered again, and each side goes back to being an ordinary card.
- **What Accept saves.** One `transfer` from the outgoing account to the incoming one. If the outgoing message printed a fee (fee, VAT and any other charge, editable), it becomes the transfer's linked Fees expense as in Part B section 5. The transfer, its fee, both suggestions marked confirmed (each pointing at the transfer) and any goal that shrinks are written in one database transaction: all or nothing. Recipient memory is not touched. Balances change only through the saved transfer.
- **The transfer's date.** It takes the best-sourced side, in the order a date the owner set, `message`, `paired`, `receipt`, `batch`; on a tie the side with a printed time, then the outgoing side. A side that had only a receipt or batch date is recorded as `paired` with the other side's date. If a receipt date differs from the transfer's date by more than a day the card says "The dates disagree" and keeps the transfer's date (a warning only). A printed time becomes the transfer's timestamp.
- **Opening dates.** The block on a message dated before an account's opening balance applies to each side: a transfer dated before either account's opening day cannot be saved.
- **An existing entry for one side.** If one side is already in the ledger as an ordinary income or expense (the same account, amount and day, as a manual entry), the owner is offered to convert that entry into the transfer instead of adding a new one, so the same movement is never recorded twice. The card shows what will change (the entry becomes a transfer between the two accounts; its date, amount and balance effect stay), and the conversion is refused, with the reason, if the resulting ledger would be invalid (an account below zero) or would use money reserved for goals. Pairing a pending message with an existing entry that has no message of its own works the same way (rule 2).
- **An entry that includes the fee.** The owner often records the sending side by hand as ONE expense for what actually left the account (the amount plus the fee), while the receiving message shows only the amount. So besides an entry of exactly the transfer amount, a single expense on the sending account, on the same day, that is LARGER than the transfer amount by a small difference is also offered for conversion, with the difference as the transfer's linked Fees expense:
  - If the sending message is pasted too and prints a fee, the entry must be exactly the amount plus that printed fee.
  - Otherwise (only the receiving message, or a sending message that prints no fee) the difference may be at most the larger of 2% of the transfer amount and ETB 100 (`PAIR_FEE_TOLERANCE_PERCENT`, `PAIR_FEE_TOLERANCE_MIN`). A bigger difference is not offered.
  - The card says it plainly: "Your entry is ETB X. The transfer is ETB Y. The difference ETB Z becomes the fee." The fee stays editable, and as it is typed the card says what saving does to the sending account ("Your CBE balance will go up by ETB 7.00.", "...go down by...", "...will not change."); Accept saves exactly the fee shown, and a fee that would overdraw the account or use reserved goal money is refused on the card with the reason.
  - The converted entry keeps its id and becomes the transfer with the sending amount Y; the difference becomes a new linked Fees expense in the sending account, so that account's balance does not change by the conversion (unless the owner edits the fee). Converting still needs the owner's confirm and is still refused if it would overdraw an account or use money reserved for goals.
  - Only one entry may qualify. If two or more entries could be the same movement (exact or with a fee), none is offered and the card or notice says why: the owner removes or fixes the extra one first.
  - An entry that is already a transfer, a Fees row, a recurring row, in a foreign currency, an income, or on another day is never offered.
- **Never twice.** A message that is already confirmed is never offered again, a pair is checked again at the moment of saving, and saving the same pair a second time is refused.

**The balance chain, same-day order and the fee suggestion (Phase 6C-2).** Most messages print the balance after the transaction, which lets them check each other.
- **Order.** For one account, messages are ordered by date; within a day by the printed time, and where there is none by the balance chain: the message whose balance equals the previous balance plus or minus its own amount (and fees) comes next. A message with no balance and no time goes last. A message whose date is only the batch date is a guess (it was imported on that day, not necessarily sent on it), so a run of such messages that follow each other is placed where the balances fit, even on another day; messages with a firm date (printed, from a receipt, set by the owner) are never reordered. So a missing message pasted later falls between its neighbours and the note goes away.
- **The check.** Each message's balance must equal the previous one's, plus the message's amount if money came in, minus its amount and any fees if money went out, to the cent. If not, the message shows "Something is missing between this and the message before it" naming the message it follows ("after the ETB X message of <date>") with the difference (money that arrived or left without a message) and saying this is expected when only some messages were imported; when the difference is exactly the message's own fee it adds that the balance it printed dropped by only its amount, so the amount may already include the fee (setting the fee to 0 then saves the whole amount as one expense, which is what left the account). It never blocks saving: it is a note, not a rule, but tapping **Save** on a card that shows it first asks once "A message seems to be missing before this one. Save anyway?" with **Save anyway** and **Go back** (after Save anyway the card does not ask again). "Save all that are clean" leaves such a card alone and lists it in its result with that reason. A message with no printed balance is skipped, so it breaks nothing.
- **Same-day order of saved entries.** An entry saved from a message with a printed time uses that time. One without a time gets a time inside its day from the chain position (after the entry before it, a second at a time), so entries of one day sit in the order the bank recorded them. The time never changes a balance.
- **A fee the message did not print.** For an outgoing message that prints no charges (BOA, Awash, some others), if the balance dropped by MORE than its amount since the message before it, the card proposes the difference as the fee, with "Use as fee". The fee is only added when the owner taps it, and stays editable; nothing is ever applied silently. No proposal is made if there is no message before it, if the drop is smaller than the amount, or if the owner already set a fee.
- **"Your balance doesn't match your bank".** For an ETB account that has imported messages, the newest message that prints a balance is compared with what Talari has for that account as of that message's day. It is only compared when that newest message has been imported (a newer message still waiting, or skipped, means the comparison would be unfair). If they differ, the account screen shows an orange banner: the date, the bank's balance, Talari's balance and the difference, then where the difference most likely comes from (below), with **Add adjustment** and **Dismiss**. Add adjustment opens a small sheet with the amount (the difference), a **date** (default: the newest message's day; any day up to today) and an optional short **note** for what it was (for example "failed ATM withdrawal, refund pending"); Confirm creates one `adjustment` entry for the difference on that day, noted with the owner's text followed by the message it matches (or only the message when no text was typed), subject to the usual rules (it cannot take an account below zero on any day, it cannot be dated before the account's opening balance, and it cannot be dated in the future); after it the banner is gone. Dismiss is remembered for that message and the banner returns only when a newer message arrives and the balances still differ. The comparison is by day, so entries made later the same day count, which can show a small difference that is not a real one: the date is shown so the owner can judge.

**Where a difference likely comes from.** When the banner or an opening refusal reports a difference between Talari and the bank, it also names the gaps the balance chain found for that account, at most the two largest by amount: "ETB 201.04 left between your 12 June message and your 21 July message that no message explains." ("came in" for money that arrived). They are worked out from the same messages as the chain (everything in the message list: waiting, confirmed and skipped; never texts that were not transactions or could not be read), so a missing message pasted later makes the line go away. Nothing is said when the chain has no gap. While balances are hidden the figures are hidden, the words stay.

**The opening balance from messages (Phase 6C-3).** The starting amount of an account can be worked out from the messages instead of typed. Only ETB accounts have messages, so only they get this. Nothing in it is ever applied without a preview and an explicit confirm.
- **An account with no opening entry.** Its balance is zero. Home, Accounts, Transactions, Insights, search, the account screen, the review screen and every total work with it, with their empty states, and nothing crashes. The "dated before the opening balance" block (above) applies only once an opening exists.
- **Get it from my messages (new account).** On the New account form a switch "Get it from my messages" turns the amount field off and creates the account with NO opening entry, exactly as if the amount were left at zero; nothing else is stored. From then on the offer below appears for any ETB account that has no opening entry and has messages, so the first import is what creates the opening.
- **Where it is offered.** A card "Opening balance" at the top of the review screen and on the account's screen, for an account with no opening entry that has messages; the same card ("Move the opening back") when messages dated BEFORE the account's opening day are waiting; and on the account's screen an "Opening balance" row with **Get it from my messages** and **Type it**, which work for any ETB account, with or without entries, to replace the opening either way. The quiet card shows an offer, or a refusal that asks the owner to type the opening instead; any other refusal (a conflict, a mismatch) appears when the owner asks. While an account has no opening entry and the card is showing, the "balance doesn't match" banner is not shown for it (the opening is the explanation, and an adjustment must not stand in for it).
- **The derivation.** The oldest message of the account (every status counts, as in the chain) that prints a balance after the transaction gives the opening: the printed balance minus the amount for money that came in, or plus the TOTAL debited for money that went out, which is the amount plus every fee (the amount, charges and total rule above; a fee the owner typed on the card is used). It is dated the day BEFORE that message (date only, no time), and that oldest message is then saved normally on top of it, in the same step. If the result is zero no opening entry is made (the account started empty) and nothing but the message is saved; below zero is refused ("the message's figures are impossible").
- **Which message is the oldest.** Decided by the order of the balance chain (6C-2), and only when it is certain: every other run of linked messages must provably come later (a later firm date, or the same day with later printed times, or linked after it by the balance chain). If an unlinked run could be older (the same day without times, or a run whose date is only the batch date), the chain cannot decide and nothing is derived.
- **Refused, with the reason, and the owner is asked to type the opening instead.** The oldest message prints no balance; the chain cannot decide which message is oldest; the oldest message was skipped (restore it first); its amount, charges and total do not add up; or the derived figure is below zero.
- **A card blocked by the opening.** A review card blocked with "dated before the account's opening balance" shows what to do next: a button **Move the opening back**, which opens the same before-and-after preview as **Get it from my messages**; or, when that is refused, the refusal's reason right on the card, in words such as "Talari is ETB X away from your bank's balance on <date> (it would show A, your <bank> message says B), so the opening cannot be moved safely." followed by the likely gaps above.
- **Estimated dates.** If the oldest message's date is only an estimate (the batch date), the preview says in a warning: "This message's date is only a guess (the day it was imported). The opening would be dated <day>, and entries before it are refused. Set the message's real date first if you know it."; the owner can still confirm.
- **Moving the opening back.** When messages older than the account's current opening are waiting, the card offers to move the opening back: the new opening is derived from the OLDEST message as above, and it replaces the old one (the same entry moves; its id stays). Existing entries are never changed. Because later entries may rely on the money of the older messages, the waiting messages dated before the current opening day are saved in the same step, in the same way as the oldest one (Uncategorised unless a remembered recipient says otherwise; no recipient is remembered); they are listed in the preview ("N messages are saved too"). A message in that set that is held for a pair answer, does not add up, or has no account is a refusal naming it ("answer its pair card first").
- **Replacing a typed opening with one from messages, or the reverse.** On the account's screen, with the same preview and confirm, and also for accounts that already have entries. **Type it** asks for an amount and a day; zero removes the opening. A typed opening saves no messages; one from messages saves the oldest one (when it is waiting) plus any waiting before the opening it replaces.
- **The preview.** Before and after: the opening's date and amount (or "none"), the account's balance now, its balance after the change (the whole change included), the messages saved with it, the estimated-date warning when it applies, and a line saying what the newest message's balance is compared with. Confirm and Cancel; nothing is written before Confirm. The change is worked out again at the moment of confirming, and refused ("things changed since you looked") if it is no longer the same.
- **Refusals for a change.** (1) Any existing entry of the account that is not the opening and is dated BEFORE the proposed opening day: refused, naming it (its date, kind and amount); a transfer leg counts. (2) The balance must still agree with the bank: when the account has an opening or any entry, then after the change and after every message waiting for the account is saved (skipped messages are not), Talari's balance as of the newest non-skipped message that prints a balance must equal that message's printed balance to the cent; if not, nothing is offered and the text says "Talari is ETB D away from your bank's balance on <day> (it would show ETB A, your <bank> message says ETB B), so the opening cannot be moved safely.", then the likely gaps. A brand-new account with no entries at all is not checked: its opening comes from the messages, and a later difference shows on the banner. (3) The whole resulting ledger must be valid (no day below zero). (4) The change may not use money reserved for goals (no goal is shrunk by it). Refusal 1 does not apply when the new opening is zero or removed.
- **Atomic.** The opening change, the messages' entries (and their fees) and the messages marked confirmed are ONE database transaction. Any failure keeps none of it: the opening is as it was, the messages are still waiting, and a retry makes exactly one opening and one entry per message. A message that is no longer waiting at that moment refuses the whole change.
- **Agreement.** After the change the "balance doesn't match" banner (6C-2) compares against the new opening, so it shows nothing when the messages and the ledger agree, and the chain notes are unchanged (they compare messages with each other). Opening entries stay out of income, expenses, categories, Insights and the streak, whatever their origin.
- **Hidden balances.** While balances are hidden, every figure in the card, the preview, the confirm and the refusals is hidden (the same masking as elsewhere); the words stay.
- **What the opening says.** A derived opening is noted "From the <service> message of <date>"; a typed one has no note. It cannot be edited as a transaction (the edit screen says how to change it).

**Backup of handled messages (Phase 6D-1).** A backup (version 4) remembers which messages were already handled, so after a restore the same messages are not offered again and the one-time repairs keep working.
- **What is in it.** One record per handled message, confirmed or skipped: its hash (the FNV-1a 64 of the normalised text), its status, for a confirmed one the id of the entry it became, its date and date source, and the few figures the app needs later: the service, the direction, the kind, the amount, the fee, VAT and other charge, the printed total and the fee typed on the card. The figures are what the "Fee counted twice" repair finds its entries from and what the Skipped list shows. **Never** in it: the message text, names (the person, bank or business a message named), phone or account tails, references, notes, the printed balance, categories or recipient rules. Messages still waiting are not in it (paste them again).
- **A hash is not strictly anonymous.** It cannot be reversed, but a short or predictable message could be guessed and checked against it. The backup file also holds the whole ledger, with the names and notes of the entries, so it must be treated as private. The same holds for the owner's own names, which a version 4 backup may also carry (see "Your name as banks write it").
- **Restore, version 4.** After the same ledger checks as version 3, the device's confirmed and skipped messages are replaced by the backup's; messages still waiting stay, except one whose hash is in the backup (it was handled, so it is dropped). A restored confirmed message whose entry id is not among the restored entries (or has none) becomes a skipped message, so it can never hide a message that has no entry. A restored message has no account and no names; it takes no part in the balance chain or the banner, and shows in Skipped with its service, direction, amount and date.
- **Restore, versions 3 and 2.** As before, and the device's handled messages are left exactly as they are.
- **Refused, with nothing written.** A version 4 file whose handled list is not a list, or has a record with no hash, a status other than confirmed or skipped, a bad date, an amount that is not a number above zero, a figure that is not a number, or a hash that appears twice. Any other field in a record is ignored and never kept, so a hand-edited file cannot bring message text in.
- **Atomic.** The whole restore (ledger, categories, budgets, rates, handled messages) is one database transaction: a failure anywhere keeps none of it.

**Copy a message with names and numbers hidden (Phase 6D-2).** When a message cannot be read, the owner may want to show it to someone (for example to get the reader fixed) without handing over who they pay or which account it is. Every card in "Couldn't read these" and in "Not transactions" (an empty piece has no card) has a button **Copy hidden version** that puts a hidden copy of that one message on the clipboard and then says **Copied**. Next to it the app says, in these words: "Hidden as far as possible: names, numbers and links are replaced with XXXX, but this is not guaranteed. Check it before you share it." It never says or implies the copy is anonymous.
- **Kept.** Amounts (any figure after ETB or Birr, any figure with decimals, and the figure after the word "balance"), so balances too; dates and times in any of the usual forms; percentages; and all other wording.
- **Replaced with XXXX.** Names after "to", "from", "by", "at" and after "Dear" (a bank's own name, such as Commercial Bank of Ethiopia, Awash or Telebirr, is not a person and stays); a name in brackets after an account, a name after a dash, and a name a bank already half-hid (such as "Hxxxxx"); the name in a chat export's prefix; phone numbers and account numbers with their tails, in whatever way the bank masked them (digits, stars, x's); reference, transaction and receipt ids; web links, including a receipt link; and any other run of digits that is not clearly an amount, a date or a time (so a package size or a call-centre number also goes).
- **Not guaranteed.** The rules are best effort. A name written in an unexpected way can be missed, which is why the line above asks the owner to check the copy first. The hidden text is shown on the card (under the original on an unreadable card) so the owner can check exactly what is copied; a "Not transactions" card shows only the hidden version, never the original, because it may hold a code, and that group is folded away until the owner opens it.
- **Private.** The copy is made on the phone from the pasted text, which is still not stored; nothing is sent anywhere by the app.

**Your name as banks write it (Phase 6D-3).** A list of names under Settings, "Your name as banks write it", used only by pairing rule 3. It is separate from "Your name" (the greeting).
- **The list.** Any number of names, added, edited and removed by the owner; stored on the phone in a table `own_names(id, name, created_at)` (schema 9, additive and all-or-nothing like the earlier steps). The owner writes each name the way a bank prints it, including a half-hidden form such as "Hxxxxx Nxxxxx"; Talari never guesses a name from the messages.
- **How a name matches.** The name a message prints for the other person is cleaned the way every name read from a message is (percent-codes decoded, spaces tidied), then compared with each name on the list ignoring case, spacing, punctuation and a leading title (Mr, Mrs, Ms, Dr, Ato, Wro). The WHOLE name must match: a short name never matches inside a longer different name ("Abe" is not "Abebe", and "Abebe Kebede" is not "Abebe Kebede Girma"), so the owner lists each spelling that appears. A message with no name never matches.
- **Removing a name** takes its pairs away: an offer that depended on it is no longer made, and a card that is open for it disappears (nothing was saved by it).
- **Personal data.** The names are personal data. They are in a backup (an optional list `ownNames` in a version 4 backup: no version change, a backup without it restores with the device's names left as they are, and one with the list replaces them), so the backup file must be treated as private.

**Not in Phase 6.** Opening balance from a message is Phase 6C-3 (above); backing up handled messages is Phase 6D-1, the hidden copy Phase 6D-2 and your own names Phase 6D-3 (above); the calendar setting is its own later phase. A restored backup does not contain recipient rules, so those are left as they are; a suggestion whose account no longer exists asks for an account again.

---

## FINAL SCOPE RULE

Do not implement Version 3 features (Part A) during this task. For V2, focus on making the existing app financially correct, responsive, consistent, and reliable.

**Do not change the accounting rules in this document without discussing the change first.**

---

## ONE FINAL INSTRUCTION FOR CLAUDE

Before coding, give a short implementation assessment of the existing project:
- Current architecture
- Where transaction/balance logic currently lives
- Where database/storage is handled
- Which screens need modification
- What existing functionality can be preserved
- What database/model changes are required (note: this is a clean data rebuild per Part V — no migration needed)
- Any risks or conflicts found

Then implement Version 2 step by step (Part X), testing each major accounting change (Part W) before moving to the next one.
