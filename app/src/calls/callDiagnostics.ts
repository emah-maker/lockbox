// callDiagnostics.ts -- instrumentation for the call -> box alert path.
//
// This exists because that path is invisible in the only conditions that
// matter. The alert has to fire while iOS has the app suspended, so nobody is
// watching a console, and a box that failed to light up looks identical
// whether (a) iOS never woke the app at all, (b) it woke but
// CXCallObserver.calls came back empty, or (c) the call was seen and the BLE
// write failed. Those need completely different fixes, and the previous
// on-device attempt burned a build to learn only "detects nothing".
//
// The counters are the experiment, not the log. `backgroundTicks` is the one
// number that validates or kills the whole design: CallMonitor.checkNow is
// driven by the box's ~1/s status notify, which only reaches us if iOS really
// does resume the app for a BLE event under the bluetooth-central background
// mode (the premise the RFCs got wrong -- see
// docs/rfcs/ios-background-wake-and-call-notification-architecture.md §4.1).
// If backgroundTicks stays 0 across a locked session, it does not, and no
// amount of work on this path will ever make it fire.
//
// `events` is the qualitative half: a short ring buffer of the interesting
// transitions, deliberately NOT including ticks (at 1/s they would evict
// everything else within a minute).
import { AppState } from 'react-native';
import { getJSON, setJSON } from '../storage/storage';

const STORE_KEY = 'callDiagnostics';
const MAX_EVENTS = 40;
// Tick counters are flushed on a throttle rather than on every tick: this runs
// once a second for the whole length of every lock, and an AsyncStorage write
// per second is real battery and flash wear for data nobody reads until
// afterwards. Suspension does not lose the in-memory copy (the process stays
// resident, just frozen), so the only thing this window risks is losing the
// last few seconds of counters to an outright process kill.
const FLUSH_INTERVAL_MS = 30_000;
// Silence longer than this between two ticks is worth a log line. The box
// notifies about once a second, so anything past a few seconds means iOS
// throttled or suspended us without waking -- exactly the behaviour that
// decides whether a 20-30s ring is reliably caught or merely sometimes caught.
const GAP_THRESHOLD_MS = 5_000;

export type CallDiagKind =
  | 'monitor-started'
  | 'monitor-stopped'
  | 'saw-call'
  | 'alert-sent'
  | 'write-failed'
  | 'skipped'
  | 'gap';

export interface CallDiagEvent {
  at: number;
  kind: CallDiagKind;
  detail?: string;
}

export interface CallDiagnostics {
  /** checkNow invocations, i.e. box status notifies actually delivered to JS. */
  ticks: number;
  /** ...of which these arrived while the app was not in the foreground. */
  backgroundTicks: number;
  lastTickAt: number | null;
  /** Longest silence observed between two consecutive ticks. */
  maxGapMs: number;
  events: CallDiagEvent[];
}

const empty = (): CallDiagnostics => ({
  ticks: 0,
  backgroundTicks: 0,
  lastTickAt: null,
  maxGapMs: 0,
  events: [],
});

let state = empty();
let hydrated = false;
let lastFlushAt = 0;

/** Fire-and-forget; a failed write only costs us the persisted copy. */
function flush(now: number) {
  lastFlushAt = now;
  void setJSON<CallDiagnostics>(STORE_KEY, state);
}

function isBackgrounded(): boolean {
  // 'active' is foreground; 'background'/'inactive' are not. A null/undefined
  // currentState (early launch, or the RN jest mock before a test sets it)
  // is not evidence of backgrounding, so it does not count as one.
  const current = AppState.currentState;
  return current != null && current !== 'active';
}

/** One box status notify reached JS. Called before any of CallMonitor's own
 * gating, so this measures the wake heartbeat itself rather than how often
 * the feature happened to be eligible to act. */
export function recordTick(now: number = Date.now()): void {
  const previous = state.lastTickAt;
  state.ticks += 1;
  if (isBackgrounded()) state.backgroundTicks += 1;
  if (previous != null) {
    const gap = now - previous;
    if (gap > state.maxGapMs) state.maxGapMs = gap;
    if (gap >= GAP_THRESHOLD_MS) {
      appendEvent({
        at: now,
        kind: 'gap',
        detail: `${Math.round(gap / 1000)}s silent, resumed ${isBackgrounded() ? 'backgrounded' : 'in foreground'}`,
      });
    }
  }
  state.lastTickAt = now;
  if (now - lastFlushAt >= FLUSH_INTERVAL_MS) flush(now);
}

function appendEvent(event: CallDiagEvent) {
  state.events.push(event);
  if (state.events.length > MAX_EVENTS) {
    state.events.splice(0, state.events.length - MAX_EVENTS);
  }
}

/** Something worth seeing happened. Flushed immediately -- these are rare,
 * and they are the entries you came to read. */
export function recordCallEvent(kind: CallDiagKind, detail?: string, now: number = Date.now()): void {
  appendEvent({ at: now, kind, detail });
  flush(now);
}

/** A snapshot for the UI. Copied, so a later tick can't mutate what a
 * rendered panel is showing. */
export function getCallDiagnostics(): CallDiagnostics {
  return { ...state, events: state.events.slice() };
}

function sanitize(raw: CallDiagnostics): CallDiagnostics {
  const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : 0);
  const events = Array.isArray(raw?.events) ? raw.events : [];
  return {
    ticks: num(raw?.ticks),
    backgroundTicks: num(raw?.backgroundTicks),
    lastTickAt: typeof raw?.lastTickAt === 'number' && Number.isFinite(raw.lastTickAt) ? raw.lastTickAt : null,
    maxGapMs: num(raw?.maxGapMs),
    // storage.getJSON's shape check is deliberately coarse (it can't know T's
    // fields), so per-entry validation belongs here -- same split as
    // sessionHistory's loadSessions and sanitizeCustomLabels.
    events: events
      .filter((e): e is CallDiagEvent => !!e && typeof e.at === 'number' && typeof e.kind === 'string')
      .slice(-MAX_EVENTS),
  };
}

/** Load the persisted counters at app start. No-ops past its first call, the
 * same as the other stores' hydrate(). */
export async function hydrateCallDiagnostics(): Promise<void> {
  if (hydrated) return;
  hydrated = true;
  const stored = await getJSON<CallDiagnostics>(STORE_KEY, empty());
  const restored = sanitize(stored);
  // Anything recorded before hydration finished (a tick can beat this, since
  // App.tsx does not await it) is kept rather than overwritten -- carry the
  // live counters forward on top of the restored ones.
  state = {
    ticks: restored.ticks + state.ticks,
    backgroundTicks: restored.backgroundTicks + state.backgroundTicks,
    lastTickAt: state.lastTickAt ?? restored.lastTickAt,
    maxGapMs: Math.max(restored.maxGapMs, state.maxGapMs),
    events: [...restored.events, ...state.events].slice(-MAX_EVENTS),
  };
}

/** Clears counters and log, so a test run starts from a known state. */
export async function resetCallDiagnostics(): Promise<void> {
  state = empty();
  lastFlushAt = 0;
  await setJSON<CallDiagnostics>(STORE_KEY, state);
}

/** Test seam only -- forgets that hydrate() already ran. */
export function __resetForTests(): void {
  state = empty();
  hydrated = false;
  lastFlushAt = 0;
}
