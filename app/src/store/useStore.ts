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
import { loadSessions, appendSessions, LoggedSession } from '../stats/sessionHistory';
import { useSettingsStore } from './useSettingsStore';

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
const CONNECT_BY_ID_TIMEOUT_MS = 6000;
const PENDING_TOPIC_SLACK_MS = 5000; // tolerance past a session's end for the tag to still count

interface PendingTopicTag {
  topic: string;
  at: number; // epoch ms when the user tagged the in-progress session
}

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
  closeBox: () => Promise<void>;
  openBox: () => Promise<void>;
  setAutoConnect: (on: boolean) => void;
  pushBoxSettings: (patch: Partial<Settings>) => Promise<void>;
  tagCurrentSession: (topic: string) => void;
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
      let consumed = false;
      const logged: LoggedSession[] = entries.map((e) => {
        // e.t is a wall-clock epoch second, or -1 if the box's clock was never
        // synced (no phone had connected yet); fall back to "now" so the
        // session still shows up somewhere on the calendar.
        const startedAt = (e.t >= 0 ? e.t * 1000 : Date.now()) - e.a * 1000;
        const endedAt = startedAt + e.a * 1000;
        let topic: string | undefined;
        if (pending && !consumed && pending.at >= startedAt && pending.at <= endedAt + PENDING_TOPIC_SLACK_MS) {
          topic = pending.topic;
          consumed = true;
        }
        return { startedAt, plannedS: e.p, actualS: e.a, outcome: e.c ? 'completed' : 'overridden', topic };
      });
      if (consumed) {
        setJSON<PendingTopicTag | null>(PENDING_TOPIC_KEY, null);
        set({ currentTopic: null });
      }
      appendSessions(logged).then((sessions) => set({ sessions }));
    });
  };

  const handleStatus = (status: Status) =>
    set((state) => ({
      status,
      // A fresh run needs a fresh tag; clear the label from whatever finished before.
      currentTopic: status.st === 'running' && state.status?.st !== 'running' ? null : state.currentTopic,
    }));

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
      if (get().conn === 'connecting' || get().conn === 'connected') return;
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

        const lastDeviceId = await getJSON<string | null>(LAST_DEVICE_KEY, null);
        if (lastDeviceId) {
          set({ conn: 'connecting' });
          try {
            await client.connectById(lastDeviceId, cb, CONNECT_BY_ID_TIMEOUT_MS);
            await afterConnected();
            return;
          } catch {
            // remembered box isn't reachable directly (out of range, OS forgot
            // the peripheral) -- fall through to a normal scan below
            set({ conn: 'scanning' });
          }
        }
        const device = await client.scanForBox();
        set({ conn: 'connecting' });
        await client.connect(device, cb);
        await afterConnected();
      } catch (e: any) {
        set({ conn: 'error', error: e?.message ?? 'Connection failed' });
        scheduleReconnect();
      }
    },

    disconnect: async () => {
      userDisconnected = true;
      clearReconnectTimer();
      monitor.stop();
      await client.disconnect();
      set({ conn: 'idle', status: null });
    },

    startLock: async (seconds) => {
      await client.startLock(seconds);
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

    // Optimistic, like pushBoxSettings: shows the tag immediately and is
    // reconciled onto the actual session once the box reports it finished
    // (see handleHistory above). Safe to call again before that -- it just
    // overwrites the pending tag with the newer timestamp/topic.
    tagCurrentSession: (topic) => {
      set({ currentTopic: topic });
      setJSON<PendingTopicTag>(PENDING_TOPIC_KEY, { topic, at: Date.now() });
    },
  };
});
