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
import { loadSessions, appendSessions, retagSession, buildLoggedSessions, LoggedSession, PendingTopicTag } from '../stats/sessionHistory';
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
const PENDING_TOPIC_KEY = 'pendingTopicTag';
const RECONNECT_DELAY_MS = 4000;
// Used for both the by-id (autoconnect) and scan-then-connect paths -- see
// connect() below. The scan path previously had no timeout on the actual
// device.connect() call at all, so a peripheral that accepted the GATT
// connection but never finished could leave the UI stuck on "Connecting"
// indefinitely with no error and no way to cancel.
const CONNECT_TIMEOUT_MS = 6000;
const PENDING_TOPIC_SLACK_MS = 5000; // tolerance past a session's end for the tag to still count
// Tolerance before a session's start, for a tag applied via DashboardScreen's
// pre-session picker (before the box's own LOCK button is physically
// pressed) to still count. Comfortably covers "pick a tag, walk to the box,
// press Lock" without being so wide it risks matching a stale tag someone
// set and then changed their mind about -- see buildLoggedSessions.
const PENDING_TOPIC_PRE_SLACK_MS = 120_000;

interface AppState {
  initialized: boolean;
  conn: Conn;
  error: string | null;
  status: Status | null;
  lastAlert: string | null;
  autoConnect: boolean;
  sessions: LoggedSession[];
  currentTopic: string | null; // topic tagged for the box's in-progress session, if any
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
  tagCurrentSession: (topic: string) => void;
  /** Retag (or clear the tag on) a past, already-logged session -- see
   * CalendarScreen's per-day list. Identifies the session by the same
   * startedAt+plannedS+actualS triple sessionHistory.ts uses internally. */
  retagSession: (target: Pick<LoggedSession, 'startedAt' | 'plannedS' | 'actualS'>, topic: string | undefined) => Promise<void>;
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

  const clearReconnectTimer = () => {
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
  };

  const scheduleReconnect = () => {
    if (userDisconnected || !get().autoConnect || reconnectTimer) return;
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      get().connect();
    }, RECONNECT_DELAY_MS);
  };

  // The box queues every finished session in RAM (see Box-code/lib/lock_log.py
  // SessionLog.record, called unconditionally from go_done) and pushes +
  // clears that queue on its very next service tick whenever connected -- so
  // this is the *only* source of session records, live or not. There is
  // deliberately no separate "watch the status transition live" path: the
  // box would report the same session again here within about a second,
  // which would double-count it.
  // A topic tagged via tagCurrentSession() while a session is running is
  // matched here to whichever incoming history entry's time window contains
  // the tag's timestamp -- the box has no keyboard/topic input of its own
  // (touchscreen swipe timer only) and keeps no long-term session store (see
  // Box-code/lib/lock_log.py's 2026-07-24 SD-card removal), so topic tagging
  // is entirely app-side and only ever needs to survive to this hand-off.
  const handleHistory = (entries: HistoryEntry[]) => {
    if (!entries.length) return;
    getJSON<PendingTopicTag | null>(PENDING_TOPIC_KEY, null).then((pending) => {
      // buildLoggedSessions drops sessions under MIN_LOGGED_SESSION_S
      // (accidental taps/instant overrides, not real focus time) so they
      // never reach the durable log/stats, not merely hidden from it later.
      const { sessions: logged, consumedPendingTopic } = buildLoggedSessions(
        entries,
        pending,
        PENDING_TOPIC_SLACK_MS,
        PENDING_TOPIC_PRE_SLACK_MS,
      );
      if (consumedPendingTopic) {
        setJSON<PendingTopicTag | null>(PENDING_TOPIC_KEY, null);
        set({ currentTopic: null });
      }
      // Ack by the original entry count once handled, whether or not any of
      // them were durably logged -- see Box-code/lib/lock_log.py's
      // SessionLog.ack and
      // docs/rfcs/ios-call-greenlist-and-force-quit-logging-technical-design.md
      // §3.2: the box only drops its own pending queue once it hears this
      // back, so a dropped write here (e.g. disconnected right after this
      // notify) just means the box resends the same batch next connection
      // -- safe because appendSessions dedupes by (startedAt, plannedS).
      const ack = () => client.ackHistory(entries.length).catch(() => {});
      if (!logged.length) {
        ack();
        return;
      }
      appendSessions(logged).then((sessions) => {
        set({ sessions });
        ack();
      });
    });
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
      if (status.st === 'running' && status.tp && status.tp !== state.currentTopic) {
        setJSON<PendingTopicTag>(PENDING_TOPIC_KEY, { topic: status.tp, at: Date.now() });
        return { status, currentTopic: status.tp };
      }
      // A fresh run needs a fresh tag; clear the label from whatever finished before.
      return { status, currentTopic: freshRun ? null : state.currentTopic };
    });

  const afterConnected = async () => {
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

    startLock: async (seconds) => {
      await client.startLock(seconds);
    },

    setDuration: async (seconds) => {
      await client.setDuration(seconds);
    },

    closeBox: async () => {
      await client.lock();
    },

    openBox: async () => {
      await client.unlock();
    },

    setAutoConnect: (on) => {
      set({ autoConnect: on });
      setJSON(AUTO_CONNECT_KEY, on);
      if (on) get().connect();
    },

    // Optimistically mirrors the patch into useSettingsStore immediately, then
    // writes it to the box if connected. If the write fails the mirror stays
    // ahead of the box; the next connect()'s readSettings() reconciles it.
    pushBoxSettings: async (patch) => {
      useSettingsStore.getState().setBoxSettings(patch);
      if (!client.connected) return;
      const next = useSettingsStore.getState().boxSettings;
      await client.writeSettings(next);
    },

    pushLabels: async () => {
      if (!client.connected) return;
      await client.setLabels(useSettingsStore.getState().customLabels);
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
  };
});
