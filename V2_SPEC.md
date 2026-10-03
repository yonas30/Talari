# PERSONAL FINANCE APP — VERSION 2 IMPLEMENTATION SPECIFICATION

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

---

## PART B — VERSION 2 CORE ACCOUNTING MODEL

This is the most important part of the specification.

The app has one overall:

```
TOTAL BALANCE
```

Total Balance represents all money currently being tracked by the app.

Money can be organized between:
- Available Money
- Saved Money
- Goals

But Goals are not additional money. They represent allocations/purposes for money that already exists.

### 1. AVAILABLE MONEY

Money currently available for normal everyday spending.

```
Total Balance: 100,000
Available:      70,000
Saved:          30,000
```

Available Money can be used for normal expenses.

### 2. SAVED MONEY

Money the user has intentionally set aside. **Saved Money is a separate entity from Goals.**

**VERY IMPORTANT:** Do NOT assume every Saved Money amount belongs to a Goal. This is incorrect:

```
Saved
 ├── Goal A
 ├── Goal B
 └── Goal C
```

Instead:

```
Total Balance
 ├── Available Money
 ├── Saved Money
 └── Goals
```

Saved Money can exist independently without belonging to any Goal.

### 3. GOALS

Specific financial targets (Laptop, Vacation, Emergency Fund, Car, Education, etc.). Goals are not a separate source of additional money.

```
Total Balance = 100,000
Laptop Goal = 20,000
```

The user still has Total Balance = 100,000. NOT 100,000 + 20,000.

### 4. INCOME

New money entering the app's financial system that increases Total Balance.

Income can enter either:
- **Income → Available**: Total +10,000, Available +10,000
- **Income → Saved**: Total +10,000, Saved +10,000

Both are Income because new money entered the system and Total Balance increased.

### 5. EXPENSES

Money leaving the financial system. Total Balance ↓.

Default source: **Available Money**. User can explicitly choose **Saved Money**.

**Expense from Available:**
```
Total: 100,000 → 95,000
Available: 70,000 → 65,000
Saved: 30,000 → 30,000 (unchanged)
```

**Expense from Saved:**
```
Total: 100,000 → 95,000
Available: 70,000 → 70,000 (unchanged)
Saved: 30,000 → 25,000
```

### 6. GOALS CANNOT DIRECTLY PAY FOR EXPENSES

Strict V2 rule. The app must NOT allow `Expense → Goal`.

If the user wants to spend money allocated to a Goal, they must first move it out:

```
Laptop Goal → Transfer → Available → Expense
```

This makes spending Goal money intentional.

### 7. TRANSFERS

A dedicated `Transfer` transaction type. Transfer is NOT Income and NOT Expense.

Transfer means existing money moves between allocations. **Total Balance never changes** on a Transfer.

Supported transfers:
- Available → Saved
- Saved → Available
- Available → Goal
- Saved → Goal
- Goal → Available
- Goal → Saved

### 8. TRANSFER MUST NOT BE A NORMAL CATEGORY

Do NOT implement Transfer as `Type: Expense, Category: Transfer`. It must be its own distinct transaction type with `From` and `To` fields.

### 9. TRANSFER EXAMPLE

```
Start: Total 100,000 | Available 60,000 | Saved 40,000
Transfer: 5,000 Saved → Available
Result: Total 100,000 | Available 65,000 | Saved 35,000
```

Total Balance stays exactly the same.

### 10. GOAL CONTRIBUTION

When contributing to a Goal, ask where the money comes from: Available or Saved. Goal contributions are Transfers, not Income. There is **no "Unallocated Saved" concept** — do not create one.

---

## PART C — ACCOUNTING ARCHITECTURE: LEDGER-DERIVED BALANCES (CRITICAL)

**This section overrides any implication elsewhere in this spec that balances are stored, mutable fields.**

`Total Balance`, `Available`, `Saved`, and each `Goal`'s current amount must **NOT** be stored as fields that get incremented/decremented when a transaction happens. They must be **computed values**, derived at read-time by summing over the full transaction/transfer ledger:

```
Available = SUM(income → Available, amountETB)
          − SUM(expenses paid from Available, amountETB)
          − SUM(transfers out of Available)
          + SUM(transfers into Available)

Saved = SUM(income → Saved, amountETB)
      − SUM(expenses paid from Saved, amountETB)
      − SUM(transfers out of Saved)
      + SUM(transfers into Saved)

Goal[x].currentAmount = SUM(transfers into Goal[x])
                       − SUM(transfers out of Goal[x])

Total Balance = Available + Saved + SUM(all Goal.currentAmount)
```

**Why:** every transaction and transfer is treated as an immutable ledger entry. Editing a transaction means updating that one row — nothing else. There is no "reverse the old effect, apply the new effect" logic anywhere in this app. Deleting a transaction simply removes it from the sum. This eliminates an entire category of balance-drift bugs that come from incremental mutation.

**Performance note:** at this app's scale (personal use, single user, thousands of transactions over years) computing these sums live, with no caching layer, is the correct approach — the cost is negligible. Do not add a caching/materialized-balance layer in V2. If performance ever becomes a real issue at much larger scale, that is a future, separate optimization — not a V2 concern.

**This replaces the "reverse old effect / apply new effect" language that appears elsewhere in earlier drafts of this spec (see Part M).** Part M is superseded by this section.

---

## PART D — CURRENCY HANDLING

The app's single Total Balance, Available, Saved, and Goal amounts are **always in ETB**. There is no multi-currency balance splitting.

**Every transaction stores both:**
- `amount` + `currency` — the original value as entered (e.g., `50, USD`) — **display only, never used in calculations**
- `amountETB` — the converted value in ETB, calculated at entry using the exchange rate — **this is the only field ever used in balance calculations, Insights, category totals, or any math**

This means a transaction list can show "Coffee — 2,750 ETB *(originally $50)*" for context, while every calculation anywhere in the app — balances, Insights, reports — operates exclusively on `amountETB`. There is no risk of currency mixups in totals because non-ETB amounts never enter a sum directly.

**Exchange rate behavior:**
- The app maintains a stored default exchange rate table (already exists from V1 — `ExchangeRate` model).
- By default, any non-ETB transaction uses the current stored rate automatically.
- The user can override the rate for a single transaction at entry time. **This override applies only to that one transaction** — it does NOT update the stored default rate.
- To update the stored default rate going forward, the user does so explicitly on the Exchange Rate settings page (existing functionality from V1 — preserve it).

**Insights/Reports:** all reporting is ETB-only. Do not implement per-original-currency breakdowns in Insights.

---

## PART E — NEGATIVE BALANCES

If an action (Expense or Transfer) would cause Available or Saved to go negative, **block the action and show a warning.** Do not allow negative balances in V2.

---

## PART F — TRANSACTION MODEL

**Income:**
`Type: Income | Amount | Currency | amountETB | Category | Destination (Available/Saved) | Source | Date | Notes`

**Expense:**
`Type: Expense | Amount | Currency | amountETB | Category | Pay From (Available/Saved) | Date | Notes`

**Transfer:**
`Type: Transfer | Amount | Currency | amountETB | From (Available/Saved/Goal) | To (Available/Saved/Goal) | Date | Notes`

Do not allow the same source and destination. Do not allow `Goal → Expense`.

---

## PART G — EDIT TRANSACTION

Because balances are ledger-derived (Part C), editing a transaction is simple: **update the row's fields. That's it.** There is no separate "reverse then reapply" step — the balance is automatically correct the next time it's computed, because it was never stored as a mutated number in the first place.

---

## PART H — HOME SCREEN

Do not redesign the entire Home screen from scratch. Preserve the existing visual language but update the financial hierarchy to reflect the new accounting model.

Home should answer: (1) How much money do I have? → Total Balance. (2) How much can I use? → Available. (3) How much have I saved? → Saved. (4) What happened this period? → Income/Expenses/Net.

```
Total Balance 👁

Available        Saved
  amount         amount

This Month
Income           Expenses
amount           amount

Net (Income - Expenses)

Streak

Recent Transactions
```

Do not add Goals as another balance on top of Total Balance — Goals remain accessible through the Goals section. Do not call Net "Available" — they are different concepts.

---

## PART I — HIDE BALANCES BY DEFAULT

Keep the existing eye button. Total Balance, Available, and Saved are hidden (`••••••••••`) by default; the eye button reveals them. Do not remove this functionality.

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

**V2 rule:** any legitimate financial activity counts for that calendar day — Income, Expense, Saving, Transfer, Goal contribution. Opening the app, viewing Insights, or opening Settings does NOT count. The user must actually record a financial action.

---

## PART O — CATEGORIES

Keep centralized under Settings → Categories. Support Add/Edit/Delete, category type, descriptive icon. Do not put Categories back into bottom navigation. New categories should auto-receive an appropriate icon when possible.

---

## PART P — BUDGET

Redesign to match the clean/elegant design language while keeping functionality: category dropdown, currency dropdown, monthly limit, budget tracking, over-budget warning (surfaced on Home + notification).

---

## PART Q — RECURRING

Redesign using the established visual language as a management/list-based UI (not just a form). Support Upcoming / All views, amount, frequency, date, enable/disable toggle, add/edit. Keep existing working functionality.

---

## PART R — SAVINGS GOALS

Keep Goals distinct from Saved Money. Active / Completed sections. Three-dot menu (Edit/Delete) — not large permanent buttons. Contribute action should be subtle and elegant, not a loud blue CTA. Contribute flow: Amount → Contribute from (Available/Saved) → selected Goal. Never allow Goal → Expense directly.

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

**No migration from existing/old data.** This is a clean-slate rebuild of the data layer. Existing test data on-device does not need to be preserved or migrated. Implement the new schema (ledger-based, per Part C) from scratch.

(This differs from earlier drafts of this spec which required preserving old data — that requirement is explicitly dropped per the project owner's decision.)

---

## PART W — ACCOUNTING TEST CASES

Verify these exact scenarios before considering V2 complete. All balances computed per Part C (ledger-derived).

**Test 1 — Income to Available:** Start Total 100,000 / Available 70,000 / Saved 30,000. Add Income 10,000 → Available. Expect Total 110,000 / Available 80,000 / Saved 30,000.

**Test 2 — Income to Saved:** Same start. Add Income 10,000 → Saved. Expect Total 110,000 / Available 70,000 / Saved 40,000.

**Test 3 — Available → Saved:** Same start. Transfer 10,000 Available→Saved. Expect Total 100,000 / Available 60,000 / Saved 40,000.

**Test 4 — Saved → Available:** Start Available 60,000 / Saved 40,000. Transfer 10,000 Saved→Available. Expect Available 70,000 / Saved 30,000.

**Test 5 — Expense from Available:** Start Available 70,000 / Saved 30,000. Expense 5,000 from Available. Expect Total 95,000 / Available 65,000 / Saved 30,000.

**Test 6 — Expense from Saved:** Same start. Expense 5,000 from Saved. Expect Total 95,000 / Available 70,000 / Saved 25,000.

**Test 7 — Available → Goal:** Start Available 70,000 / Saved 30,000 / Laptop Goal 0. Contribute 10,000 Available→Laptop. Expect Available 60,000 / Saved 30,000 / Laptop Goal 10,000 / Total 100,000.

**Test 8 — Saved → Goal:** Same start. Contribute 10,000 Saved→Laptop. Expect Available 70,000 / Saved 20,000 / Laptop Goal 10,000 / Total 100,000.

**Test 9 — Goal → Available:** Start Available 60,000 / Saved 30,000 / Laptop Goal 10,000. Transfer 5,000 Laptop→Available. Expect Available 65,000 / Saved 30,000 / Laptop Goal 5,000 / Total 100,000.

**Test 10 — Goal cannot pay expense:** Attempt Expense 5,000 Pay from Laptop Goal. Expect: not allowed — UI must not offer Goal as an Expense source.

**Test 11 — Edit transaction (ledger model):** Create Expense 5,000 Pay from Available. Edit it to 7,000 Pay from Saved. Expect: recomputed balances reflect ONLY the updated row — Available should show as if the original 5,000-from-Available expense never existed, and Saved should show as if a 7,000-from-Saved expense has always existed. No "double subtraction" from both.

**Test 12 — Currency conversion:** Log an Expense of $50 USD with exchange rate 55 ETB/USD. Expect: `amount=50, currency=USD, amountETB=2,750`. Available decreases by exactly 2,750, not 50. Transaction list displays both the ETB amount and "(originally $50)".

**Test 13 — Negative balance blocked:** Attempt an Expense from Available greater than current Available balance. Expect: blocked, warning shown, no transaction created.

---

## PART X — IMPLEMENTATION ORDER

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
