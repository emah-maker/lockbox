# Stats window persistence — feature-implementation evidence

## Summary
- **Task**: Persist StatsScreen's day/week/month/all-time `timeWindow` selection across app restarts, as a per-device UI preference (not synced via `useSettingsStore`).
- **Workflow type**: feature-implementation
- **Source of truth**: No GitHub issue or RFC exists for this task; scope was fully specified inline by the manager (MANdy) as a delegated mobile-dev workstream. Repo is in FRAIM `conversational` mode (`fraim/config.json`), with no issue tracker wired for this ad hoc task.

## Work Completed
- **File changed**: `app/src/screens/StatsScreen.tsx`
- **Approach**: Reused the file's own existing `BEST_STREAK_KEY`/`getJSON`/`setJSON` pattern for a new `TIME_WINDOW_KEY` ('statsTimeWindow'):
  - Added an `isTimeWindow` type guard.
  - Added a mount-time `useEffect` that loads the saved window and falls back to the existing default (`'all'`) when missing or invalid.
  - Added a `setJSON` call inside `selectWindow` so every user selection persists immediately.
  - Added a `userSelectedRef` guard (found during bug-bash, see below) so a still-in-flight mount-load can never clobber a selection the user already made.
- **Explicitly not changed**: `app/src/store/useSettingsStore.ts` — confirmed via `git diff`/`git status` that only `StatsScreen.tsx` was touched, per the manager's instruction to keep this out of `SyncableSettings`/Firestore sync.

## Validation
- `npx tsc --noEmit` (app/): clean, no errors.
- `npx jest` (app/): 8 suites / 81 tests, all passing, no regressions.
- No new automated test was added: this repo's test suite only covers pure-logic modules (`app/src/stats/*.test.ts`, `app/src/ble/protocol.test.ts`); there is no React Native Testing Library/render harness for screens anywhere in the codebase to extend. Coverage instead comes from manual code-path reasoning, exercised as follows:
  1. First launch (no stored key): `getJSON` returns `null` → guard rejects → state stays default `'all'`.
  2. Corrupted/invalid stored value: guard rejects → falls back to `'all'`, same as missing.
  3. Valid stored value (e.g. `'week'`): loaded and applied once on mount.
  4. User taps a chip: state updates immediately and `setJSON` persists the new value under `phonebox:statsTimeWindow`, mirroring `BEST_STREAK_KEY`.
  5. Race between in-flight load and a user tap before it resolves: covered by the `userSelectedRef` fix.
  6. Unmount before load resolves: existing `cancelled` guard (same pattern as `StreakStat` elsewhere in this file) prevents a state update on an unmounted component.
- UI polish check: N/A — no visible UI/layout change; the window chip row's markup and styles are unchanged, only persistence behavior was added behind it.

## Bug Bash Findings
- **Medium (fixed)**: Race condition — if the user tapped a window chip before the mount-time AsyncStorage read resolved, the late-resolving load would overwrite the user's fresh selection with the previously-saved value. Fixed with a `userSelectedRef` guard; re-verified via `tsc` + full `jest` suite after the fix.
- No other issues found after edge case, boundary, and adjacent flow exploration.

## Security Review
- **Review scope**: diff (`app/src/screens/StatsScreen.tsx` only).
- **Threat surfaces detected**: none (`surfaces: []`). The change is a client-side AsyncStorage read/write of a closed 4-value enum, with no network call, no free-text user input, and no auth/crypto/secret material touched.
- **Coverage matrix**: all categories N/A per the threat-surface-classification skill's guidance for no matched surface.
- **Findings**: none.

## Quality Checks
- File is ~337 lines (well under the repo's 500-line limit).
- New key string follows the same hardcoded-constant convention as the existing `BEST_STREAK_KEY`.
- No duplicated logic, no new architecture-layer dependencies.
- All deliverables complete; documentation (this file) is accurate and specific.

## Feature Requirement Traceability Matrix
| Requirement | Implemented | Proof | Status |
|---|---|---|---|
| Persist timeWindow locally via storage.ts getJSON/setJSON, same pattern as BEST_STREAK_KEY | `TIME_WINDOW_KEY` constant + getJSON/setJSON calls | Pattern is structurally identical to existing BEST_STREAK_KEY usage in the same file | Met |
| Load saved value on mount, fallback to 'all' if missing/invalid | mount `useEffect` + `isTimeWindow` guard | Manual trace scenarios 1–3 above | Met |
| Save on every selectWindow change | `setJSON` call inside `selectWindow` | Code inspection — runs on every non-no-op call | Met |
| Do NOT add to useSettingsStore's SyncableSettings/Firestore sync | No change made | `git diff`/`git status` show only StatsScreen.tsx modified | Met |
| Confirm the change was exercised (manually reasoned through or tested) | Manual reasoning trace + full jest run + tsc | 8/8 suites, 81/81 tests, tsc clean | Met |
| Return branch/PR per submission phase | See Phase Completion below | — | Handled per repo-state rule (no branch/PR — see below) |

Technical Design Traceability Matrix: N/A — no RFC/technical design exists for this task; covered by the table above.

## Phase Completion
All feature-implementation job phases completed: scoping, tests, code, validate, security-review, regression, quality, completeness-review, architecture-update, submission.

**Branch/PR**: The current branch is `master` (the repo's default branch), and `fraim/config.json` has `"mode": "conversational"`. Per this job's own submission-phase rule ("If the current branch exactly equals the default branch: do not stage files, do not commit, and do not push during submission") and the `set-up-workspace` skill's conversational-mode rule, this work was done in place with no branch or commit created. The diff below is the review artifact; pushing/branching is a manager decision, not taken automatically.

## Diff
```diff
diff --git a/app/src/screens/StatsScreen.tsx b/app/src/screens/StatsScreen.tsx
index 9f9f21b..<new> 100644
--- a/app/src/screens/StatsScreen.tsx
+++ b/app/src/screens/StatsScreen.tsx
@@ -33,6 +33,7 @@ const TOP_N = 5;
 const TREND_BAR_MAX_H = 80;
 const HEATMAP_OPACITY = [0.08, 0.3, 0.5, 0.72, 1] as const; // index = HeatmapDay.level
 const BEST_STREAK_KEY = 'bestStreakSeen';
+const TIME_WINDOW_KEY = 'statsTimeWindow';

 const WINDOW_OPTIONS: { key: TimeWindow; label: string }[] = [
   { key: 'day', label: 'Day' },
@@ -41,6 +42,9 @@ const WINDOW_OPTIONS: { key: TimeWindow; label: string }[] = [
   { key: 'all', label: 'All time' },
 ];

+const isTimeWindow = (v: unknown): v is TimeWindow =>
+  v === 'day' || v === 'week' || v === 'month' || v === 'all';
+
 export default function StatsScreen() {
   const c = useTheme();
   const sessions = useStore((s) => s.sessions);
@@ -49,10 +53,28 @@ export default function StatsScreen() {
   const reducedMotion = useReducedMotion();
   const [timeWindow, setTimeWindow] = useState<TimeWindow>('all');
+  // Guards the mount load below against overwriting a selection the user
+  // already made while the AsyncStorage read was still in flight.
+  const userSelectedRef = useRef(false);
+
+  // Per-device view preference -- deliberately not part of useSettingsStore's
+  // SyncableSettings, since which window is selected shouldn't follow the
+  // user to another device (see that store's header comment).
+  useEffect(() => {
+    let cancelled = false;
+    getJSON<TimeWindow | null>(TIME_WINDOW_KEY, null).then((saved) => {
+      if (!cancelled && !userSelectedRef.current && isTimeWindow(saved)) setTimeWindow(saved);
+    });
+    return () => {
+      cancelled = true;
+    };
+  }, []);

   const selectWindow = (w: TimeWindow) => {
+    userSelectedRef.current = true;
     if (w === timeWindow) return;
     configureLayoutAnimation(reducedMotion);
     setTimeWindow(w);
+    setJSON(TIME_WINDOW_KEY, w);
   };
```
