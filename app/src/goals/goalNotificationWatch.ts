// goalNotificationWatch.ts -- the one module that connects useStore's live
// session log to the goal-reminder scheduler. Deliberately tiny, and
// deliberately separate from goalNotificationBridge.ts: useStore constructs
// a BleManager at module scope, so anything importing it drags BLE into its
// importers' graphs. The bridge is imported by useGoalsStore (which must
// stay BLE-free so its unit tests can run with no native module registered),
// and this file is imported only by App.tsx, which already owns BLE anyway.
import { useStore } from '../store/useStore';
import { noteSessionsChanged, startGoalNotificationPrefsWatch } from './goalNotificationBridge';

let teardown: (() => void) | null = null;

/**
 * Call once at app start, alongside the other bridges. Pushes the current
 * session log into the scheduler immediately (so a goal already met today
 * doesn't get nudged before the first new session lands), then keeps it
 * updated. Idempotent -- a second call returns the existing teardown.
 */
export function startGoalNotificationBridge(): () => void {
  if (teardown) return teardown;

  const unsubPrefs = startGoalNotificationPrefsWatch();

  let prev = useStore.getState().sessions;
  noteSessionsChanged(prev);
  // Reference compare only: sessionHistory.ts's writers always produce a NEW
  // array (append/replace/retag all return fresh arrays), so an in-place
  // mutation this would miss doesn't exist on that path. Every other
  // useStore emission -- BLE status ticks above all, which fire constantly
  // during a session -- costs exactly this one comparison.
  const unsubSessions = useStore.subscribe((state) => {
    if (state.sessions === prev) return;
    prev = state.sessions;
    noteSessionsChanged(state.sessions);
  });

  teardown = () => {
    teardown = null;
    unsubSessions();
    unsubPrefs();
  };
  return teardown;
}
