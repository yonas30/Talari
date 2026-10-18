# Talari

Know where your money is. Control where it goes. Watch it grow.

Talari is a local-first personal finance app for Android (built with Expo and React Native). Your data stays on your phone: there is no sign-up and there are no servers, and the app makes no network requests of its own.

Built by Yonas Kiros with Claude Code as an AI pair-programming assistant.

## Features

- Accounts: the places your money actually is - Cash, wallets like Telebirr, banks - each in ETB or one foreign currency (a foreign account is valued at today's exchange rate). Your Total Balance is the sum of them. Names are unique, accounts can be archived, and Home's Cash / Wallet / Bank tiles open the Accounts screen.
- Transactions: income, expense and transfer between accounts (with an optional fee), with categories, merchants, notes and dates. Each one is recorded in an account.
- Ledger-derived balances: every balance (each account, the reserved goal money, the total) is calculated from the ledger rather than stored, so the numbers always add up.
- Goals: set money aside toward a target inside an account (it stays in the account, so the balance still matches your bank), add to it, withdraw from it, and see progress. If you spend reserved money the goal shrinks to match, and you are told.
- Budgets: monthly limits per category, with an alert in the in-app notification list at 80% of the limit and another when a budget goes over.
- Notifications: budget alerts and goal notifications ("reserved money was used") in one list with an unread badge; goal notifications are kept for 30 days.
- Recurring transactions: daily, weekly or monthly rules that post entries automatically.
- Multi-currency: your own list of currencies with manual exchange rates; every amount is converted to ETB for balances and reports.
- Insights: spending breakdown by category, income and expense totals, and a trend chart.
- Streaks and Journey: a daily tracking streak, monthly history and milestones.
- Backup and export: a full JSON backup (accounts, transactions, goals, notifications, categories, budgets, exchange rates) you can restore, and a CSV export of your transactions. Backups from before accounts existed restore into one "Cash" account, and the app tells you how.
- App lock: unlock with the phone's biometrics or passcode.
- Appearance: Light, Dark or System (follows the phone).

## Tech stack

- Expo SDK 57 and React Native 0.86, with Expo Router for navigation
- TypeScript in strict mode
- SQLite (expo-sqlite) with Drizzle ORM
- Zustand for state
- React Native Reanimated and SVG for animation and charts
- Plus Jakarta Sans and Inter, embedded through the expo-font config plugin

## Running it

You need Node.js 22 or later, because one of the verify scripts uses Node's built-in SQLite module.

```bash
npm install
npx expo start
```

Open the project in Expo Go on your phone by scanning the QR code. Expo Go is enough for day-to-day development. Two things only show up in a real build: following the phone's Light/Dark setting (the `userInterfaceStyle` setting is applied when the app is built) and the embedded fonts (Expo Go loads them at runtime instead). Builds are made with EAS:

```bash
npx eas-cli@latest build --platform android --profile preview
```

## Checks

```bash
npx tsc --noEmit
npx expo lint
```

The verify scripts run the app's pure logic under Node (they use `npx tsx`, which is fetched on first use). The accounting script is written for East Africa Time; on macOS or Linux run it as `TZ=Africa/Addis_Ababa npx tsx scripts/verify-accounting.ts`:

```bash
npx tsx scripts/verify-accounting.ts      # Insights periods and trends, goal progress, streak, budgets, recurring, layout, schema 3 migration steps, notifications, search
npx tsx scripts/verify-splash.ts          # splash timeline
npx tsx scripts/verify-contrast.ts        # colour contrast of every text and graphic pair, Light and Dark
npx tsx scripts/verify-fonts.ts           # font weight to font family mapping
npx tsx scripts/verify-greeting.ts        # greeting, name rules and onboarding state
npx tsx scripts/verify-home.ts            # the rules behind the Home screen
npx tsx scripts/verify-budget-alerts.ts   # the 80% and over-budget alerts
npx tsx scripts/verify-appearance.ts      # Light / Dark / System resolution and the saved choice
npx tsx scripts/verify-accounts.ts        # accounts model: ledger, transfers and fees, reserved goal money, names, backup round trip and old-backup restore, notification retention, schema 3 to 4 migration
```

## Screenshots

| Home (Light) | Home (Dark) |
| :---: | :---: |
| <img src="docs/screenshots/home-light.jpeg" width="260" alt="Home screen, Light theme"> | <img src="docs/screenshots/home-dark.jpeg" width="260" alt="Home screen, Dark theme"> |
| Balances, this month's totals and recent transactions. | The same screen in the Dark theme. |

| Home with balances hidden | Add transaction |
| :---: | :---: |
| <img src="docs/screenshots/home-hidden.jpeg" width="260" alt="Home screen with balances hidden"> | <img src="docs/screenshots/add-transaction.jpeg" width="260" alt="Add transaction screen"> |
| Balances are hidden until you tap the eye. | Record income, an expense or a transfer. |

| Insights | Goals |
| :---: | :---: |
| <img src="docs/screenshots/insights-light.jpeg" width="260" alt="Insights screen, Light theme"> | <img src="docs/screenshots/goals-light.jpeg" width="260" alt="Goals screen, Light theme"> |
| Spending by category, totals and trend. | Money set aside toward your targets. |

## Project notes

`V2_SPEC.md` is the specification the accounting model was built from, and the verify scripts check those rules. If something about how money is calculated is unclear, start there.
