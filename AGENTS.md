This is an Expo/React Native mobile application. Prioritize mobile-first patterns, performance, and cross-platform compatibility.

## Expo has changed — do not trust your training data

Expo ships breaking changes every SDK release. APIs you remember are likely renamed, moved, or removed. Before writing any code that touches an Expo, EAS, or React Native API:

1. Read the major version of the `expo` package in `package.json`.
2. Fetch the matching versioned docs: `https://docs.expo.dev/versions/v<major>.0.0/`
3. For anything else, fetch https://docs.expo.dev/llms.txt — an index of all Expo docs with corrections to common LLM misconceptions. Follow its links to the specific page you need; never answer from memory.

## Commands

Use `bunx` instead of `npx` if the project uses bun (`bun.lock` present).

```bash
npx expo install <package>  # ALWAYS use instead of npm/yarn/pnpm/bun add — resolves SDK-compatible versions
npx expo start              # start the dev server
npx expo lint               # lint
npx tsc --noEmit            # typecheck
npx expo-doctor             # diagnose dependency and config issues
npx expo install --fix      # fix incompatible package versions
```

Run lint and typecheck before declaring any task done.

## Navigation & Routing

- Use **Expo Router** for all navigation. Routes live in `src/app/` — every file there is a screen, `_layout.tsx` files define navigators. Keep non-route code (components, hooks, utils) outside `src/app/`.
- Import `Link`, `router`, and `useLocalSearchParams` from `expo-router`.
- Docs: https://docs.expo.dev/router/introduction.md

## Building with EAS

Use EAS to build, sign, and submit the app in the cloud (`eas build`, `eas submit`) and to ship over-the-air updates (`eas update`) — no local Xcode or Android Studio required. Run EAS CLI as `bunx eas-cli <command>` in Bun projects, or `npx eas-cli@latest <command>` otherwise; substitute that for bare `eas` in docs examples.
Docs: https://docs.expo.dev/eas/index.md

## Rules

- If `ios/` and `android/` directories do not exist, they are generated (Continuous Native Generation). Never create or edit them by hand — configure native behavior in `app.json` and config plugins.
- Expo Go only includes its bundled native modules. After adding a library with native code, the app needs a development build: `npx expo run:ios|android` locally, or `eas build --profile development`.
- Prefer recommended Expo modules over third-party libraries, and check your available skills before adding dependencies. Docs: https://docs.expo.dev/versions/latest/index.md

---

## Project: My Finances

A personal finance mobile app, local-first, single-user, built incrementally through versioned phases. Not a tutorial project — a real app in active daily use by its owner.

### Stack specifics for this project

- TypeScript strict mode — no `any`
- SQLite via `expo-sqlite` + Drizzle ORM for local storage
- Zustand for state
- Local-first: no backend, no auth, no cloud sync unless a spec explicitly introduces it
- Currency: single ETB-denominated Total Balance; non-ETB transactions store original amount+currency alongside a converted `amountETB` (see `V2_SPEC.md` Part D)

### Source of truth for current work

**`V2_SPEC.md`** in this repo is the authoritative accounting and feature specification for the app's current version. Treat it as the source of truth — do not invent a different financial/accounting model, and do not change the accounting rules in it without discussing the change first.

Key architectural rule from that spec, worth restating here because it's easy to default away from: **balances (`Total`, `Available`, `Saved`, each `Goal`) are never stored as mutable fields — they are always computed by summing the transaction/transfer ledger.** Editing or deleting a transaction never requires "reversing" a prior effect; it just changes that one row.

### Project-specific working conventions

1. **Inspect before changing.** At the start of any non-trivial task, look at the existing code relevant to that area before writing anything. Report what you find before proceeding on anything architecturally significant.
2. **Work phase by phase / spec section by spec section.** Don't pull in functionality from a future version (see `V2_SPEC.md` Part A for what's explicitly out of scope) or an unrelated part of the spec just because it seems easy to include while you're in there.
3. **Test the accounting logic concretely.** When a spec includes numbered test cases (see `V2_SPEC.md` Part W), actually verify behavior against them before considering the work done — don't just assert it should work.
4. **Ask before assuming on ambiguous financial logic.** Silent assumptions in money-handling code are the most expensive kind of mistake in this project.
5. **Non-route file structure** (routes themselves live in `src/app/` per the Navigation section above):
   ```
   /components  → reusable UI components
   /db          → drizzle schema, migrations, queries
   /store       → zustand stores
   /utils       → currency conversion, date helpers, streak calc, balance derivation
   /constants   → default categories, colors, theme
   /types       → shared TypeScript types
   ```
6. **Every screen needs an empty state.** No blank/broken-looking screens.
7. **Comment for "why," not "what"** — especially around balance derivation, currency conversion, and streak logic.

### Versioning note

This project is mid-rewrite: V1 (original roadmap — local-first finance tracker with Builder Dashboard / Origin / Journey identity screens) is functionally complete. V2 (see `V2_SPEC.md`) introduces a corrected Available/Saved/Goals accounting model with ledger-derived balances, replacing V1's simpler goal-tracking approach. V2's data layer starts fresh — no migration from V1 test data is required or expected.

V3 (not in scope yet) will cover app identity/branding/onboarding and automatic transaction capture (SMS parsing). Do not pull V3 work into current sessions unless explicitly asked.
