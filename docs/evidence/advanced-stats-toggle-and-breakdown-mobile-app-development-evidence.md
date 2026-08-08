# Feature: Advanced Stats toggle + topic breakdown/trend on StatsScreen
Issue: #local (delegated workstream from the "box call-alert / app-icon / Advanced Stats" roadmap)
PR: N/A -- no issue tracker/API access this session; changes presented in place, no branch/commit created.

Note on provenance: this node stalled twice under delegation (a mid-response
connection drop, then a retry that made no further progress on the actual
deliverable). After the human directed "do it yourself," MANdy implemented
the remaining scope directly rather than issuing a third delegated retry.

## Work List

### Scope
Finish what two prior delegated attempts on this node left undone. The prior
attempts' groundwork was reviewed, verified (tsc + jest), and kept as-is:
`app/src/stats/topics.ts` + `topics.test.ts`, `app/src/stats/trend.ts` +
`trend.test.ts`, `sessionHistory.ts`'s optional `topic` field, `useStore.ts`'s
`currentTopic`/`tagCurrentSession()`, `theme.ts`'s `withAlpha()`, and the topic
chips/progress meter on DashboardScreen + dominant-topic dot/label on
CalendarScreen.

- [x] `app/package.json` -- fixed the jest AsyncStorage mock wiring. The
  package's own `jest/async-storage-mock.js` is a plain module export, not a
  self-installing mock -- listing it directly in `setupFiles` (as a prior
  attempt had done) just executes it as a script and does nothing, since
  nothing calls `jest.mock()`. Added `app/jest.setup.js` with the actual
  `jest.mock('@react-native-async-storage/async-storage', () => require(...))`
  call, and pointed `setupFiles` at that instead — ✅ done, confirmed
  `trend.test.ts` now runs (previously failed to load at all).
- [x] `app/src/store/useSettingsStore.ts` -- new `advancedStatsEnabled`
  boolean, same hydrate/persist pattern as `callAlertsEnabled` (off by
  default) — ✅ done
- [x] `app/src/screens/StatsScreen.tsx` -- added the "Advanced stats" toggle
  card; when on, renders a 7-day trend bar chart (`lastNDays()` from
  `stats/trend.ts`) and a by-topic breakdown bar list (`topicBreakdown()`
  from `stats/topics.ts`), each with its own empty-state hint instead of a
  blank chart when there's no data yet. Also added a small always-visible
  completion-rate/streak/longest-session row to the existing total-focus-time
  card, since that data was already computed (`aggregate()`) but not shown
  anywhere on this screen — ✅ done
- [x] `app/src/screens/SettingsScreen.tsx` -- light visual touch (the one tab
  with none): a connection-status dot + label next to the "Settings" header,
  reusing the existing `conn` value already read by this screen. Read the
  file fresh before editing; did not touch the "Unlock box when called" row
  added by the separate, already-completed call-alert/unlock-setting
  workstream — ✅ done

### Validation Requirements
- `mobileValidationRequired`: Yes, in principle -- no iOS/Android
  device/simulator in this session, so this is host-side (type/test) only,
  same limitation as the other workstreams this round.

## Validation Results
| Validation Step | Result | Notes |
|---|---|---|
| `npx tsc --noEmit` (app) | ✅ Pass | Clean across the full working tree. |
| `npx jest` (full app suite) | ✅ Pass | 5/5 suites, 28/28 tests -- `trend.test.ts` now runs (was failing to load before the jest.setup.js fix). |
| On-device / live app | ⏸️ Untested -- no device/simulator this session | Stated plainly; charts and toggle have not been visually confirmed on a real screen. |

### Deferrals
- **Live visual check of the new charts/toggle** -- deferred, no
  device/simulator available. The bar-chart and breakdown-bar sizing math was
  hand-checked (percentage/height clamping, empty-state branches) but not
  eyeballed on an actual screen.
