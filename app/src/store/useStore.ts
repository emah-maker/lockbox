// useStore.ts -- BLE/connection store: owns the single PhoneBoxClient + call
// monitor, drives autoconnect/auto-reconnect, and derives the local
// focus-session log from the box's history sync (see handleHistory below).
// Pure local preferences (theme, call-alert toggle, the box-settings mirror)
// live in useSettingsStore; this store is the only thing that actually talks
// to the box over BLE, and calls pushBoxSettings() to keep that mirror in sync.
//
// Background tracking note: we don't use expo-task-manager/background-fetch
// here. Those exist for periodic wake-ups with no active connection. This app
// instead relies on react-native-ble-plx's iOS background central mode
// (app.json: UIBackgroundModes bluetooth-central + isBackgroundEnabled) which
// keeps status/history notifications flowing to these same handlers while
// backgrounded, for as long as the BLE connection stays up -- the right
// mechanism for "keep watching a connected peripheral", vs. the wrong tool
// (periodic background fetch) for a job that's really "stay connected".
import { create } from 'zustand';
import { PhoneBoxClient } from '../ble/PhoneBoxClient';
import { CallMonitor } from '../calls/CallMonitor';
import type { Status, HistoryEntry, BoxState, Settings } from '../ble/protocol';
import { getJSON, setJSON } from '../storage/storage';
import { reconnectDelayMs, shouldScheduleReconnect } from '../ble/reconnectPolicy';
import { handleHistoryEntries, PENDING_TOPIC_KEY, withPendingTopicLock } from '../ble/historyIntake';
import { loadSessions, retagSession, LoggedSession, PendingTopicTag } from '../stats/sessionHistory';
import { useSettingsStore } from './useSettingsStore';
// Remote sync (docs/rfcs/google-signin-cross-device-sync-architecture.md §4.3)
// is wired from outside this store -- see sync/sessionsSyncBridge.ts, which
// subscribes to this store's `sessions` state rather than being called from
// here, so this file stays exactly as documented: the only thing that
// actually talks to the box over BLE, with zero awareness of auth/network.

type Conn = 'idle' | 'scanning' | 'connecting' | 'connected' | 'error';

export const CONN_LABELS: Record<Conn, string> = {
  idle: 'Idle',
  scanning: 'Scanning',
  connecting: 'Connecting',
  connected: 'Connected',
  error: 'Not Connected',
};

const AUTO_CONNECT_KEY = 'autoConnect';
const LAST_DEVICE_KEY = 'lastDeviceId';
const RECONNECT_DELAY_MS = 4000;
const MAX_RECONNECT_DELAY_MS = 60000; // cap the exponential backoff below
// Used for both the by-id (autoconnect) and scan-then-connect paths -- see
// connect() below. The scan path previously had no timeout on the actual
// device.connect() call at all, so a peripheral that accepted the GATT
// connection but never finished could leave the UI stuck on "Connecting"
// indefinitely with no error and no way to cancel.
const CONNECT_TIMEOUT_MS = 6000;

interface AppState {
  initialized: boolean;
  conn: Conn;
  error: string | null;
  status: Status | null;
  lastAlert: string | null;
  autoConnect: boolean;
  sessions: LoggedSession[];
  currentTopic: string | null; // topic tagged for the box's in-progress session, if any
  // A topic picked in the app *before* a session exists, pushed to the box so
  // pressing LOCK there can show a confirm screen for it -- see
  // PhoneBoxClient.setPendingTopic / protocol.ts's cmdSetPendingTopic. This is
  // the mirror-image of currentTopic above, not a duplicate of it:
  // currentTopic is the *backward* reconciliation of a tag onto a session
  // that's already running (from handleStatus's on-box echo or
  // tagCurrentSession), while pendingBoxTopic is the *forward* suggestion
  // sent to the box before any session -- running or not -- exists yet.
  pendingBoxTopic: string | null;
  // Whether the native CXCallObserver module is actually linked into this build
  // (false in Expo Go, Android, or if the module failed to link) -- surfaced so
  // the "alert box on incoming calls" toggle doesn't silently do nothing.
  callDetectionAvailable: boolean;

  init: () => Promise<void>;
  connect: () => Promise<void>;
  disconnect: () => Promise<void>;
  startLock: (seconds: number) => Promise<void>;
  /** Live-previews a picked duration on the box without starting the
   * countdown -- see DashboardScreen's stepper effect and
   * PhoneBoxClient.setDuration. */
  setDuration: (seconds: number) => Promise<void>;
  closeBox: () => Promise<void>;
  openBox: () => Promise<void>;
  setAutoConnect: (on: boolean) => void;
  pushBoxSettings: (patch: Partial<Settings>) => Promise<void>;
  /** Best-effort push of the app's custom-label catalog to the box (pairs
   * with the box's own pre-session tag picker) -- see protocol.ts's
   * cmdSetLabels. No-op while disconnected; not part of pushBoxSettings
   * since labels aren't part of Settings, and there's no mirror to keep in
   * sync -- customLabels already lives durably in useSettingsStore. */
  pushLabels: () => Promise<void>;
  /** Best-effort push of a topic picked in the app before a session exists --
   * see pendingBoxTopic's comment above and PhoneBoxClient.setPendingTopic.
   * Pass null to clear (the box's own picker then applies as normal). */
  setPendingBoxTopic: (topic: string | null) => void;
  tagCurrentSession: (topic: string) => void;
  /** Retag (or clear the tag on) a past, already-logged session -- see
   * CalendarScreen's per-day list. Identifies the session by the same
   * startedAt+plannedS+actualS triple sessionHistory.ts uses internally. */
  retagSession: (target: Pick<LoggedSession, 'startedAt' | 'plannedS' | 'actualS'>, topic: string | undefined) => Promise<void>;
  /** Overwrites the in-memory session list without touching AsyncStorage --
   * for callers that already persisted a new session set themselves
   * (sync/localDataOwner.ts's clearLocalAccountData on sign-out/delete;
   * sync/firestoreSync.ts's syncSessions after a cross-device/account merge)
   * and need this store's live `sessions` -- what StatsScreen, DashboardScreen,
   * and CalendarScreen actually render -- to stop reflecting whichever
   * account was signed in before. Without this, those screens kept showing
   * the previous account's session list until the next BLE history event or
   * an app restart, since loadSessions() is otherwise only read at init(). */
  setSessions: (sessions: LoggedSession[]) => void;
}

const client = new PhoneBoxClient();

export const useStore = create<AppState>((set, get) => {
  const monitor = new CallMonitor({
    client,
    getBoxState: (): BoxState => get().status?.st ?? 'idle',
    isEnabled: () => useSettingsStore.getState().callAlertsEnabled,
    onAlertSent: (label) => set({ lastAlert: label }),
  });

  // Internal bookkeeping for autoconnect/reconnect -- not UI state, so it
  // lives in this closure rather than the store shape.
  let userDisconnected = false;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  // Consecutive failed-reconnect count, for the exponential backoff below --
  // a fixed 4s retry forever (production readiness review, Low: "fixed-
  // interval BLE reconnect with no backoff/cap") means a box that's been off
  // for an hour still gets hammered with a scan/connect attempt every 4s the
  // whole time. Reset to 0 on any successful connect (afterConnected) or a
  // fresh user-initiated connect() call.
  let reconnectAttempts = 0;

  const clearReconnectTimer = () => {
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
  };

  const scheduleReconnect = () => {
    // Both halves of the decision live in ble/reconnectPolicy.ts, where they
    // can be tested; what stays here is the timer and the closure state they
    // read. Same plan/execute split goalNotificationPlan and
    // sessionReminderPlan have with their own executors.
    if (!shouldScheduleReconnect({ userDisconnected, autoConnect: get().autoConnect, timerArmed: !!reconnectTimer })) {
      return;
    }
    const delay = reconnectDelayMs(reconnectAttempts, RECONNECT_DELAY_MS, MAX_RECONNECT_DELAY_MS);
    reconnectAttempts += 1;
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      // Re-checked when the timer FIRES, not only when it was armed. The
      // backoff runs up to a minute, which is plenty of time for the user to
      // open Settings and turn Auto-connect off -- and connect() has no
      // autoConnect gate of its own, so an already-armed timer would go
      // ahead and reconnect to a box the user had just told the app to stop
      // reaching for. setAutoConnect clears the timer too; this is the
      // backstop for any other path that flips the flag.
      if (userDisconnected || !get().autoConnect) return;
      get().connect();
    }, delay);
  };

  /** The box's finished-session batches. The rule itself is
   * ble/historyIntake.ts; this binds it to this store and this connection. */
  const handleHistory = (entries: HistoryEntry[]) =>
    handleHistoryEntries(entries, {
      onSessions: (sessions) => set({ sessions }),
      onTopicConsumed: (topic) =>
        set((state) => (state.currentTopic === topic ? { currentTopic: null } : {})),
      ack: (count) => client.ackHistory(count),
    });

  // The user report this fixes: "goals do not update with the topic". A
  // pre-session pick durably writes PENDING_TOPIC_KEY at PICK time
  // (tagCurrentSession) and separately best-effort pushes the topic to the
  // box (setPendingBoxTopic) so the box can echo it back once running. If
  // that forward push never lands -- not connected yet, rejected, box busy
  // -- status.tp stays '' for the whole session, so the branch below (which
  // only refreshes on a truthy tp) never fires, and PENDING_TOPIC_KEY keeps
  // its original pick-time timestamp. An ordinary walk-to-the-box delay
  // then pushes that timestamp outside buildLoggedSessions'
  // PENDING_TOPIC_PRE_SLACK_MS window by the time the session's history
  // actually arrives, and the tag is silently dropped. The local tag is the
  // source of truth and must not depend on the box's forward acknowledgment
  // landing -- so on a freshRun with no echoed topic, refresh whatever tag
  // is ALREADY stored (never invent one from currentTopic or any other
  // in-memory field) against the moment this session actually started,
  // rather than the moment the user picked it.
  //
  // Goes through withPendingTopicLock, the same queue historyIntake.ts's
  // consume-then-compare-and-clear uses for this exact key, so this can
  // never land in the middle of that sequence: either this whole refresh
  // completes before historyIntake even reads the tag (whose own read then
  // simply sees the refreshed value), or after historyIntake's clear has
  // already run (in which case the read below sees null and this is a
  // no-op) -- never between its consume and its compare-and-clear, which is
  // what would let a tag historyIntake DID consume dodge the clear (stale
  // tag left in storage for a later session to pick up), or let this
  // refresh resurrect a tag historyIntake just cleared. Re-checks with its
  // own compare-and-set immediately before writing too, since
  // tagCurrentSession's direct setJSON isn't behind this lock and could
  // still land in between this function's two reads.
  const refreshPendingTopicOnFreshRun = () => {
    withPendingTopicLock(async () => {
      const existing = await getJSON<PendingTopicTag | null>(PENDING_TOPIC_KEY, null);
      if (!existing) return; // nothing to refresh -- never invent a tag
      const stillCurrent = await getJSON<PendingTopicTag | null>(PENDING_TOPIC_KEY, null);
      if (stillCurrent && stillCurrent.at === existing.at && stillCurrent.topic === existing.topic) {
        await setJSON<PendingTopicTag>(PENDING_TOPIC_KEY, { topic: existing.topic, at: Date.now() });
      }
    }).catch(() => {});
  };

  const handleStatus = (status: Status) =>
    set((state) => {
      const freshRun = status.st === 'running' && state.status?.st !== 'running';
      // The box's own pre-session tag picker (now fed the app's synced
      // custom labels -- see Box-code/lib/lock_controller.py's _all_topics)
      // can tag a session before Lock is even pressed at the box; status.tp
      // echoes that pick back live while running. Feed it through the same
      // pending-tag path tagCurrentSession uses, so buildLoggedSessions
      // still attaches it once this session's history entry arrives --
      // otherwise a topic chosen at the box has no way to reach the app's
      // durable session log at all (the box's own NVM history entries have
      // no room for a topic id -- see lock_log.py).
      // Rewriting the PENDING_TOPIC_KEY timestamp only on a *different* tp
      // used to mean: pick a topic in the app (pendingBoxTopic), walk over,
      // press LOCK, and confirm the box's own echo of that same pick back --
      // status.tp === state.currentTopic in that case, so the rewrite was
      // skipped and reconciliation fell back on the stale timestamp written
      // when the topic was first picked in the app, minutes earlier. If that
      // gap exceeded PENDING_TOPIC_PRE_SLACK_MS (120s), buildLoggedSessions
      // would miss the window entirely and the tag was lost. `freshRun` --
      // status.st just flipped to 'running' this tick -- is exactly the
      // signal that a new pending-tag timestamp is needed even when the
      // topic id itself didn't change.
      if (status.st === 'running' && status.tp && (status.tp !== state.currentTopic || freshRun)) {
        setJSON<PendingTopicTag>(PENDING_TOPIC_KEY, { topic: status.tp, at: Date.now() });
        // pendingBoxTopic is cleared here too, not only on the fall-through
        // below: this branch IS the feature's main success path (pick in the
        // app -> press LOCK -> CONFIRM -> the box echoes that same id back as
        // status.tp on a fresh run), so returning early without clearing
        // would leave the consumed suggestion set and let afterConnected
        // re-push last session's topic on the next reconnect -- the exact
        // resurrection the clear exists to prevent.
        return { status, currentTopic: status.tp, pendingBoxTopic: freshRun ? null : state.pendingBoxTopic };
      }
      // The box echoed no topic for this fresh run -- either nothing was
      // ever picked, or (see refreshPendingTopicOnFreshRun's comment above)
      // the forward BLE push of a pick that WAS made never landed. Refresh
      // whichever it is: a no-op if nothing is stored, otherwise it keeps
      // the durable tag alive against this session's actual start time.
      if (status.st === 'running' && !status.tp && freshRun) {
        refreshPendingTopicOnFreshRun();
      }
      // A fresh run needs a fresh tag; clear the label from whatever finished
      // before. Also drop any still-pending app-side suggestion (pure local
      // bookkeeping -- the box already clears its own copy in go_running, so
      // this does NOT push '' over BLE) so afterConnected doesn't resurrect
      // last session's pick and re-send it on the next reconnect.
      return {
        status,
        currentTopic: freshRun ? null : state.currentTopic,
        pendingBoxTopic: freshRun ? null : state.pendingBoxTopic,
      };
    });

  const afterConnected = async () => {
    reconnectAttempts = 0; // a real connection succeeded -- the next drop starts backoff fresh
    set({ conn: 'connected' });
    monitor.start();
    if (client.deviceId) setJSON(LAST_DEVICE_KEY, client.deviceId);
    try {
      const s = await client.readSettings();
      if (s) useSettingsStore.getState().setBoxSettings(s);
    } catch {
      // box didn't answer the settings read; the mirror keeps its last value
    }
    // Best-effort: give a freshly-connected box today's label catalog so its
    // own pre-session tag picker (box-firmware-batch, parallel task) has
    // something to offer without waiting for the next label edit.
    client.setLabels(useSettingsStore.getState().customLabels).catch(() => {});
    // Re-push any still-pending app-side pick too, same reasoning as
    // setLabels just above: a drop/reconnect shouldn't lose a topic the user
    // already chose in the app but hasn't walked over to confirm at the box
    // yet. handleStatus clears pendingBoxTopic to null on freshRun, so a pick
    // that was already consumed by a session starting is never resurrected
    // here.
    const pending = get().pendingBoxTopic;
    if (pending !== null) client.setPendingTopic(pending).catch(() => {});
  };

  return {
    initialized: false,
    conn: 'idle',
    error: null,
    status: null,
    lastAlert: null,
    autoConnect: true,
    sessions: [],
    currentTopic: null,
    pendingBoxTopic: null,
    callDetectionAvailable: monitor.available,

    init: async () => {
      const [autoConnect, sessions] = await Promise.all([
        getJSON<boolean>(AUTO_CONNECT_KEY, true),
        loadSessions(),
        useSettingsStore.getState().hydrate(),
      ]);
      set({ autoConnect, sessions, initialized: true });
      if (autoConnect) get().connect();
    },

    connect: async () => {
      // 'scanning' has to be guarded too, not just 'connecting'/'connected':
      // without it, autoConnect's init() call and a manual reconnect (or a
      // double-tapped Connect button) can both be mid-scan at once. The two
      // client.scanForBox() calls step on the same manager.startDeviceScan()
      // session -- the second call's timeout can stop the *first* call's
      // scan out from under it, so one of the two connect attempts fails for
      // no reason a user could ever explain, and looks exactly like an
      // unreliable "sometimes it just won't reconnect".
      if (get().conn === 'connecting' || get().conn === 'connected' || get().conn === 'scanning') return;
      clearReconnectTimer();
      userDisconnected = false;
      const cb = {
        onStatus: handleStatus,
        onHistory: handleHistory,
        onDisconnect: () => {
          set({ conn: 'idle', status: null });
          scheduleReconnect();
        },
      };
      try {
        set({ conn: 'scanning', error: null });
        await client.waitForPoweredOn();
        // Each of the checks below guards against disconnect() having run
        // while we were awaiting the previous step (user taps Disconnect
        // mid-scan/mid-connect, or a manual disconnect races an
        // auto-reconnect). Without them we'd carry on connecting/scanning
        // and could land back on "Connected" right after the user asked to
        // stop -- see PhoneBoxClient.disconnect()'s pendingDeviceId for the
        // other half of this fix.
        if (userDisconnected) return;

        const lastDeviceId = await getJSON<string | null>(LAST_DEVICE_KEY, null);
        if (userDisconnected) return;
        if (lastDeviceId) {
          set({ conn: 'connecting' });
          try {
            await client.connectById(lastDeviceId, cb, CONNECT_TIMEOUT_MS);
            if (userDisconnected) {
              await client.disconnect();
              return;
            }
            await afterConnected();
            return;
          } catch {
            if (userDisconnected) return;
            // remembered box isn't reachable directly (out of range, OS forgot
            // the peripheral) -- fall through to a normal scan below
            set({ conn: 'scanning' });
          }
        }
        if (userDisconnected) return;
        const device = await client.scanForBox();
        if (userDisconnected) return;
        set({ conn: 'connecting' });
        await client.connect(device, cb, CONNECT_TIMEOUT_MS);
        if (userDisconnected) {
          await client.disconnect();
          return;
        }
        await afterConnected();
      } catch (e: any) {
        // disconnect() already put us back to 'idle' and stopped any
        // reconnect -- don't let this attempt's (possibly
        // cancellation-induced) rejection overwrite that with a spurious
        // error state or re-arm a reconnect timer the user just cancelled.
        if (userDisconnected) return;
        set({ conn: 'error', error: e?.message ?? 'Connection failed' });
        scheduleReconnect();
      }
    },

    disconnect: async () => {
      userDisconnected = true;
      clearReconnectTimer();
      monitor.stop();
      await client.disconnect();
      set({ conn: 'idle', status: null, error: null });
    },

    // These four all write straight to CHAR.command with no connected-check
    // or error handling -- unlike pushBoxSettings/pushLabels just below, a
    // call while disconnected (or a mid-write disconnect) threw an unhandled
    // rejection straight at whichever caller invoked them without its own
    // .catch (closeBox/openBox's onPress handlers in DashboardScreen among
    // them; production readiness review, Medium). Guarded and swallowed the
    // same best-effort way pushBoxSettings already is: the box only matters
    // here while actually connected, and a failed write just means the
    // action didn't take, with no separate mirror state to leave stale.
    startLock: async (seconds) => {
      if (!client.connected) return;
      await client.startLock(seconds).catch(() => {});
    },

    setDuration: async (seconds) => {
      if (!client.connected) return;
      await client.setDuration(seconds).catch(() => {});
    },

    closeBox: async () => {
      if (!client.connected) return;
      await client.lock().catch(() => {});
    },

    openBox: async () => {
      if (!client.connected) return;
      await client.unlock().catch(() => {});
    },

    setAutoConnect: (on) => {
      set({ autoConnect: on });
      setJSON(AUTO_CONNECT_KEY, on);
      if (on) {
        get().connect();
        return;
      }
      // Turning it OFF has to cancel whatever backoff is already armed.
      // scheduleReconnect only consults autoConnect at the moment it arms a
      // timer, so a box that dropped out of range a moment ago leaves a timer
      // of up to a minute running -- and it used to fire regardless, silently
      // reconnecting to the box right after the user had explicitly said not
      // to.
      clearReconnectTimer();
    },

    // Optimistically mirrors the patch into useSettingsStore immediately, then
    // writes it to the box if connected. If the write fails the mirror stays
    // ahead of the box; the next connect()'s readSettings() reconciles it.
    // The connected-check above doesn't cover a disconnect landing mid-write
    // (Error('Not connected') from PhoneBoxClient.write, or the native write
    // itself rejecting) -- callers here (SettingsScreen's Switch/slider
    // handlers) never awaited or caught this promise, so that was an
    // unhandled rejection (production readiness review, Medium).
    pushBoxSettings: async (patch) => {
      useSettingsStore.getState().setBoxSettings(patch);
      if (!client.connected) return;
      const next = useSettingsStore.getState().boxSettings;
      await client.writeSettings(next).catch(() => {});
    },

    pushLabels: async () => {
      if (!client.connected) return;
      await client.setLabels(useSettingsStore.getState().customLabels).catch(() => {});
    },

    // Best-effort, like pushLabels: sets the app-side state immediately, then
    // pushes it to the box if connected -- see pendingBoxTopic's comment on
    // the AppState shape above for how this differs from tagCurrentSession
    // below (that one reconciles backward onto a session already running;
    // this one is a forward suggestion for a session that doesn't exist yet).
    setPendingBoxTopic: (topic) => {
      set({ pendingBoxTopic: topic });
      // Defense in depth, not the fix for the topic-drop bug above (that fix
      // must hold even when this write fails outright): matches pushLabels'
      // guard three lines up, so a push while disconnected fails loudly (in
      // the logs, via the native client rejecting a write with nothing
      // connected) instead of silently pretending to have gone out.
      if (!client.connected) return;
      client.setPendingTopic(topic).catch(() => {});
    },

    // Optimistic, like pushBoxSettings: shows the tag immediately and is
    // reconciled onto the actual session once the box reports it finished
    // (see handleHistory above). Safe to call again before that -- it just
    // overwrites the pending tag with the newer timestamp/topic.
    tagCurrentSession: (topic) => {
      set({ currentTopic: topic });
      setJSON<PendingTopicTag>(PENDING_TOPIC_KEY, { topic, at: Date.now() });
    },

    retagSession: async (target, topic) => {
      const sessions = await retagSession(get().sessions, target, topic);
      set({ sessions });
    },

    setSessions: (sessions) => set({ sessions }),
  };
});
