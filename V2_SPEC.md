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
Do NOT implement: SMS transaction reading, bank/payment-company SMS parsing, automatic transaction creation, automatic financial-app detection, automatic classification, automatic confirmation/review, bank-specific parsing architecture.

**Automatic transaction editing/classification — V3**
Depends on automatic capture, so not part of V2.

**Phase 5 exception (explicit owner request):** accounts carry two nullable fields, `smsSender` and `lastDigits`, so V3's SMS work has somewhere to attach. They are stored only. No SMS reading, parsing, reconcile banner or automatic capture exists in V2 or Phase 5.

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
- A new account is created with a starting amount. If it is above zero it is saved as an `opening` entry dated the day the account is created (section 4).
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

- `opening`: an account's starting balance, dated the day the account is created. The amount is greater than zero.
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

An `opening` entry is created with its account and is not edited afterwards (a change to the starting balance is an `adjustment`); an adjustment stays an adjustment.

**Validation:**
- Income and expense need an account that exists and is not archived and an amount above zero. In a foreign-currency account the currency must equal the account's; in an ETB account any listed currency is converted to ETB (a missing rate blocks the entry).
- A transfer's two accounts must differ. A transfer with the same currency on both sides has `fromAmount = toAmount`. A transfer cannot involve a goal.
- No entry can be added while no account exists.
- No expense or transfer out may take an account below zero (Part E).

**Tables** (Phase 5): `accounts`, `transactions` (with `account_id`, `from_account_id`, `to_account_id`, `to_amount`, `to_amount_etb`, `linked_transfer_id`), `goals` (with `held_in_account_id`), `goal_allocations`, `notifications` (for `goal_reserve_used`), and `recurring_transactions` (with `account_id`). `categories`, `budgets`, `currencies` and `exchange_rates` are unchanged. A `Fees` expense category is part of the default seed.

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

**Test 24 — Backup round trip (version 3):** Export then import gives identical accounts, balances, goal amounts, reserved amounts and notifications.

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

**Backup.** Version 3 holds accounts, transactions (every entry type, transfers with their fee rows), goals, goal allocations, notifications with their read flags, categories, budgets and exchange rates. Restore validates the ledger first (no negative balance, no goal holding more than its account) and changes nothing if it fails; it drops notifications older than 30 days, clears recurring rules (they point at accounts and are not in a backup) and adds any currency the restored data needs. A version 2 backup restores as described in Test 25.

**Checks.** `scripts/verify-accounts.ts` (the ledger, Part W, names, currencies, backup round trip, retention, migration), `verify-accounting.ts` (Insights, goals, streak, budgets, notifications page rules, search), `verify-home.ts` (Home and hidden-balances rules), plus the existing contrast, splash, fonts, greeting, budget-alert and appearance scripts.

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
