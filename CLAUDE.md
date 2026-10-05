# GymTracker

Offline-first PWA. Plain ES modules, no build step, no dependencies.
README.md explains how the app works and where things live; this file is the
rules that aren't inferable from the code.

## Commands

| | |
|---|---|
| `npm test` | Unit tests. No browser, under a second. Run before calling anything done. |
| `npm run test:smoke` | End-to-end in headless Chrome, ~2 min. Run for any change to `src/views/`, `src/store.js`, `styles.css` or `sw.js`. |
| `npm run test:smoke -- --tz <zone>` | Forces the browser clock. The app names sessions by the hour, so this reproduces time-dependent bugs. |
| `npm run check` | Validates the exercise library data. Run after touching `src/exercises.js`. |
| `npm start` | Dev server on :5173. |

`npm test` is glob-scoped to `test/` deliberately: Node's default discovery
matches `tools/smoke-test.mjs` via the `*-test.mjs` pattern and will silently
launch Chrome from what looks like a unit-test run. Don't "tidy" that glob.

## Never

- **Call `wipeAll()`, `resetEverything()`, or `importData(_, {replace: true})`
  outside a throwaway browser profile.** They erase real training history that
  exists nowhere else — no server, no account, no backup unless the user
  exported one.
- **Make `onupgradeneeded` in `src/db.js` destructive, or rename `DB_NAME`.**
  Schema changes must be additive and guarded by `objectStoreNames.contains`.
  Anything else destroys the user's log on next launch.
- **Add a dependency, a build step, or a framework.** "No install step, no
  build, no dependencies" is a product decision, not an oversight. If something
  seems to need a library, say so rather than adding one.

## Invariants

- Weights are stored canonically in **kg**, distances in **metres**. Only
  display converts (`src/util.js`). Never write a converted value back to the
  store.
- Adding a file under `src/` means adding it to `ASSETS` in `sw.js`, and
  bumping `CACHE` when assets change — otherwise the app breaks offline.
- Chart text in `styles.css` stays in **px**: `src/charts.js` lays the SVG out
  in fixed pixel geometry, so rem-scaling those labels collides with the plot.
  Everything else sizes in rem so the Settings → Text size control works.
- Form controls keep a **16px floor** (`max(16px, …)`) or iOS zooms the
  viewport on focus.
- Tap targets are 44px (`--tap`), per Apple HIG. Don't shrink them back.

## Git

- Branch; don't commit to `main`.
- Commit messages: imperative subject, blank line, wrapped body explaining
  *why*. Match the existing history.
- Don't push, merge, or open PRs unless asked.

## Style

- Match the surrounding code. Comments are sparse and explain why, not what.
- Don't refactor adjacent code or add abstractions for a single caller.
- Report honestly: if a test fails or a step was skipped, say so.
