// DemoBoxClient.ts -- a box that isn't there.
//
// Phone Box's first public-TestFlight submission was rejected under App Store
// Review Guideline 2.1(a): the app's core feature is locking a phone inside a
// physical BLE box, and a reviewer has no box, so Home sat on "Connect your
// box" forever and no amount of seeded account data could show a session
// being started, run, or finished. Apple names a demonstration mode as the
// accepted remedy; this is it. See docs/handoff/demo-mode-handoff.md.
//
// It substitutes at the BLE-client layer and nowhere else. Every screen, the
// history intake, the session log, stats, goals and the calendar are all
// unaware this exists -- they see Status notifies arriving about once a
// second and a HistoryEntry batch at the end, which is exactly what a real
// box gives them. That is the whole reason to fake HERE rather than
// special-case the UI: a demo that took a different code path would
// demonstrate the different code path.
//
// The state machine mirrors firmware/lib/lock_controller_states.py and
// lock_controller_ble.py's apply_ble_command, including the parts that are
// inconvenient (a `dur` write is ignored while running; `unlock` is gated on
// the box's own remote-unlock setting; a session under
// MIN_LOGGED_SESSION_S never becomes a log entry). Where it deliberately
// differs from the firmware, the difference is commented.
import type { BoxClient, BoxDevice, ClientCallbacks } from './BoxClient';
import type { BoxState, HistoryEntry, Settings, Status } from './protocol';
// The one thing this module needs from the log it feeds: the length below
// which a session is dropped rather than recorded. See finish() for why the
// demo box has to know about it. ble/historyIntake.ts already imports from
// stats/, so the direction is established.
import { MIN_LOGGED_SESSION_S } from '../stats/sessionHistory';

/** How often a demo status notify goes out. Matched to the real box's
 * ~1Hz `_push_outbound` cadence (firmware/lib/lock_ble.py) rather than
 * something smoother, because this tick is also what drives
 * CallMonitor.checkNow() and battery sampling in the real app -- a demo
 * running at 5Hz would exercise those at a rate no box produces. */
export const DEMO_TICK_MS = 1000;

/**
 * Box-seconds burned per tick, i.e. how much faster than wall-clock a demo
 * lock runs.
 *
 * Not 1. The app's duration picker floors at MIN_LOCK_SECONDS (5 minutes --
 * stats/stats.ts, mirroring the box's own MIN_STEP), so a 1:1 demo would ask
 * a reviewer to sit through five real minutes before a single session landed
 * in history. At 5x the shortest pickable lock finishes in about a minute,
 * which fits inside a review sitting, while the countdown still visibly
 * ticks down on a real timer -- the point is that they watch it run, not
 * that it completes instantly.
 *
 * The logged session reports the FULL picked duration (300s), not the ~60s
 * of wall clock it took: what lands in Stats and the calendar is what a real
 * five-minute lock would have produced.
 */
export const DEMO_SECONDS_PER_TICK = 5;

/**
 * Ticks spent in `closed` before the countdown starts.
 *
 * A real session begins when someone presses LOCK on the box itself with the
 * phone already inside it -- the app deliberately has no remote start (see
 * DashboardScreen's control row). A reviewer has no box to press, so the
 * demo box presses its own LOCK button a beat after the lid shuts. The beat
 * is not padding: it is long enough to read Home's "Closed -- press LOCK on
 * the box to start" state before it moves on, which is the real state a real
 * box would be sitting in.
 */
export const DEMO_LOCK_PRESS_TICKS = 3;

/** Ticks the finished-session screen stays up before the box returns to
 * idle -- the box's own DONE_ANIM_S auto-dismiss (lock_config.py), rounded
 * to this tick. */
export const DEMO_DONE_TICKS = 2;

/** What the demo box's duration is set to before anything is picked: the
 * app's own minimum lock, so a reviewer who taps Close without opening the
 * duration sheet still gets the shortest session available. */
export const DEMO_DEFAULT_SECONDS = 5 * 60;

/**
 * Battery the demo box reports, held constant on purpose.
 *
 * battery/batterySamplingBridge.ts feeds every status.bat CHANGE into the
 * persisted sample log a real box's runtime estimate is fitted from. A
 * drifting demo battery would write a fake discharge curve into that log and
 * skew the estimate shown for the user's actual box; a constant value
 * records one sample and then nothing (recordBatterySample drops a repeat of
 * the last percent), and batteryEstimate.ts already discards a lone upward
 * step as a plug-in rather than fitting a line through it.
 */
export const DEMO_BATTERY_PCT = 87;

/** The demo box's own settings mirror. Mostly the firmware defaults
 * (store/settingsPersistence.ts's DEFAULT_BOX_SETTINGS), with `unlk` ON:
 * remote unlock ships off by default on a real box, and a reviewer who taps
 * Open and has nothing happen has found a dead button, not a demonstration.
 * Not imported from settingsPersistence -- this module stays store-free, the
 * same way protocol.ts stays UI-free.
 *
 * useStore's afterConnected reads these into useSettingsStore's box-settings
 * mirror, so while demo mode is on, Settings > Box behavior shows the demo
 * box rather than the user's own -- the honest reading, since it IS the box
 * you are connected to, and the only one where Home does not warn that Open
 * will not release a box this one will happily open. The mirror is written
 * NON-persistently for a demo box (setBoxSettings' `persist` option) and
 * restored from disk when demo mode is switched off, so the user's real
 * box's saved values -- `unlk` above all, which ships off deliberately --
 * are never overwritten by this struct. */
const DEMO_SETTINGS: Settings = {
  ovr: 25,
  auto: 1,
  sleep: 20,
  bright: 50,
  unlk: 1,
  ucal: 0,
  thm: 0,
  acc: 0,
  flip: 0,
  langle: 45,
  uangle: 0,
  ovrt: 10,
};

/** Firmware version string the demo box reports, shown verbatim in
 * Settings > Box behavior -- so the one screen that displays it says what
 * this is rather than impersonating a build number. */
const DEMO_FIRMWARE = 'demo';

const wholeSeconds = (n: number) => (Number.isFinite(n) ? Math.max(0, Math.floor(n)) : 0);

export class DemoBoxClient implements BoxClient {
  private cb: ClientCallbacks | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private isConnected = false;

  private st: BoxState = 'idle';
  private setSeconds = DEMO_DEFAULT_SECONDS;
  private remaining = 0;
  /** Ticks elapsed since entering the current state -- the only clock the
   * closed -> running and done -> idle transitions need. */
  private ticksInState = 0;
  /** Echoed back as Status.tp while running, exactly like the topic a real
   * box's own pre-session picker attaches (lock_controller.go_running's
   * `topic` argument). */
  private topic = '';
  private pendingTopic: string | null = null;
  private settings: Settings = { ...DEMO_SETTINGS };
  /** Finished sessions the app has not acked yet. Held, not dropped, when
   * the notify goes out -- the box only clears its own queue once it hears
   * ackHistory back (firmware/lib/lock_log.py's SessionLog.ack), and
   * reproducing that is what exercises the app's ack path rather than
   * bypassing it. */
  private pending: HistoryEntry[] = [];

  // ----- lifecycle -----

  /** Nothing to wait for -- there is no radio to power on. Resolving
   * immediately is also the behaviour that matters for demo mode's whole
   * premise: this must work on a device with Bluetooth switched off, or
   * denied, or in an environment (a review desk) where nothing is in range. */
  async waitForPoweredOn(): Promise<void> {}

  /** The scan always "finds" the demo box instantly. The handle is opaque
   * (BoxClient.BoxDevice) and useStore never reads a field off it, so this
   * is a marker object rather than a fabricated peripheral. */
  async scanForBox(): Promise<BoxDevice> {
    return { id: 'demo-box' };
  }

  async connect(_device: BoxDevice, cb: ClientCallbacks): Promise<void> {
    this.attach(cb);
  }

  async connectById(_deviceId: string, cb: ClientCallbacks): Promise<void> {
    this.attach(cb);
  }

  private attach(cb: ClientCallbacks) {
    this.cb = cb;
    this.isConnected = true;
    if (!this.timer) this.timer = setInterval(() => this.tick(), DEMO_TICK_MS);
    // One status straight away rather than making the caller wait a whole
    // tick for the first one -- a real connection delivers the box's current
    // state as soon as the notify subscription lands, and a second of blank
    // Home after tapping Connect reads as a failure.
    this.emitStatus();
    // Anything the app never acked (it disconnected mid-batch, or storage
    // failed) is re-offered on this connection, same as the box's own
    // pending queue. appendSessions dedupes a verbatim resend.
    this.emitHistory();
  }

  /**
   * Stops the clock and drops the callbacks.
   *
   * Deliberately does NOT invoke onDisconnect: unlike the real client, where
   * the native disconnect event is the only signal a teardown happened, every
   * caller of this method (useStore's disconnect(), and its demo-mode swap)
   * already knows -- and firing it would re-enter the store's own disconnect
   * handling from inside the call that requested it.
   *
   * In-flight state is frozen, not discarded: a box whose phone walks out of
   * range keeps counting, and a reviewer who toggles demo mode off and back
   * on mid-session should find the session where they left it rather than
   * silently losing it.
   */
  async disconnect(): Promise<void> {
    this.stopTimer();
    this.isConnected = false;
    this.cb = null;
  }

  private stopTimer() {
    if (!this.timer) return;
    clearInterval(this.timer);
    this.timer = null;
  }

  // ----- accessors -----

  /**
   * Always null, knowingly.
   *
   * sync/sessionMerge.ts builds each session's Firestore document id as
   * `deviceId_startedAt_actualS`, and sync/sessionsSync.ts's currentDeviceId()
   * falls back to 'unknown-device' when useStore has never recorded one. A
   * demo client that returned an id of its own would (a) get that id written
   * to LAST_DEVICE_KEY by useStore's afterConnected, displacing the real
   * box's, and (b) move every session produced afterwards into a different
   * doc-id namespace. Returning null makes afterConnected's `if
   * (client.deviceId)` guard skip the write entirely, which is exactly the
   * behaviour wanted: demo mode leaves no trace on which box this phone
   * remembers.
   */
  get deviceId(): string | null {
    return null;
  }

  get connected(): boolean {
    return this.isConnected;
  }

  // ----- commands -----
  // Each mirrors its opcode in firmware/lib/lock_controller_ble.py's
  // apply_ble_command, including the state guards -- a command the firmware
  // would ignore is ignored here too, so the app cannot learn a behaviour in
  // demo mode that a real box does not honour.

  async startLock(seconds: number): Promise<void> {
    if (this.st !== 'idle' && this.st !== 'closed') return;
    this.setSeconds = wholeSeconds(seconds);
    this.goRunning();
  }

  /** Live duration preview. Ignored while running, same as the firmware's
   * "dur" opcode -- set_seconds is read back when the session ends to
   * compute what was logged, so letting it move mid-session would corrupt
   * the entry. */
  async setDuration(seconds: number): Promise<void> {
    if (this.st === 'running') return;
    this.setSeconds = wholeSeconds(seconds);
    this.emitStatus();
  }

  async lock(): Promise<void> {
    if (this.st !== 'idle' && this.st !== 'done') return;
    this.st = 'closed';
    this.ticksInState = 0;
    this.emitStatus();
  }

  async unlock(): Promise<void> {
    // Gated on the box's own remote-unlock setting, exactly as the firmware
    // gates it -- turning "Allow open from this phone" off in Settings
    // really does stop Open working in demo mode too.
    if (!this.settings.unlk) return;
    if (this.st === 'running') {
      this.finish(false);
      return;
    }
    // `closed` had no countdown, so there is no session to log -- the box
    // just opens. Matches go_done's `if self.state == "running"` guard.
    if (this.st === 'closed') {
      this.st = 'done';
      this.ticksInState = 0;
      this.emitStatus();
    }
  }

  async readSettings(): Promise<Settings> {
    return { ...this.settings };
  }

  async writeSettings(s: Settings): Promise<void> {
    this.settings = { ...s };
  }

  /** No clock to set -- the demo box dates its history from this device's
   * own wall clock (see finish()), which is the value this write would have
   * carried anyway. */
  async syncTime(): Promise<void> {}

  /** Accepted and dropped. Faking an incoming-call alert-through would mean
   * faking the call, which is out of scope (see the handoff): what a real
   * box does with this is light its screen, and there is no screen here. */
  async alertCall(_label: string): Promise<void> {}

  /** Clears exactly `seq` entries off the front of the pending queue --
   * SessionLog.ack's own semantics, so a partial/failed intake leaves the
   * rest queued for the next connection instead of vanishing. */
  async ackHistory(seq: number): Promise<void> {
    this.pending = this.pending.slice(wholeSeconds(seq));
  }

  /** The box uses the label catalog for its own on-box tag picker; the demo
   * box has no picker, so this is accepted and dropped. Tagging still works
   * in demo mode through the app's own picker + setPendingTopic below. */
  async setLabels(_labels: { id: string; name: string; color: string }[]): Promise<void> {}

  /** A topic picked in the app before a session exists. Held and then echoed
   * back as Status.tp when the run starts, which is precisely what the real
   * box does (go_running's topic argument) and what makes a demo session
   * land in Stats and the calendar already tagged. */
  async setPendingTopic(topicId: string | null): Promise<void> {
    this.pendingTopic = topicId || null;
  }

  // ----- the clock -----

  private tick() {
    this.ticksInState += 1;
    switch (this.st) {
      case 'closed':
        // The box pressing its own LOCK button -- see DEMO_LOCK_PRESS_TICKS.
        if (this.ticksInState >= DEMO_LOCK_PRESS_TICKS) {
          this.goRunning();
          return;
        }
        break;
      case 'running':
        this.remaining = Math.max(0, this.remaining - DEMO_SECONDS_PER_TICK);
        if (this.remaining === 0) {
          this.finish(true);
          return;
        }
        break;
      case 'done':
        if (this.ticksInState >= DEMO_DONE_TICKS) {
          this.st = 'idle';
          this.ticksInState = 0;
        }
        break;
      default:
        break;
    }
    this.emitStatus();
  }

  private goRunning() {
    if (this.setSeconds <= 0) return; // go_running's own guard
    this.st = 'running';
    this.ticksInState = 0;
    this.remaining = this.setSeconds;
    this.topic = this.pendingTopic ?? '';
    this.pendingTopic = null; // consumed by this session, same as go_running
    this.emitStatus();
  }

  /**
   * Ends the running session: report `done`, then hand the app the finished
   * session the way the box does -- as a history batch, through the ordinary
   * intake path (ble/historyIntake.ts -> sessionHistory -> stats/goals/
   * calendar), not by writing anything itself.
   */
  private finish(completed: boolean) {
    const served = this.setSeconds - this.remaining;
    // Floored so a demo session is never one the log then silently discards.
    //
    // buildLoggedSessions drops anything under MIN_LOGGED_SESSION_S (60s) as
    // an accidental tap rather than focus time, and at DEMO_SECONDS_PER_TICK
    // an Open tapped inside the first twelve seconds serves less than that.
    // The reviewer's reading of "I pressed Open and nothing appeared in my
    // history" is that the feature is broken -- which is the failure mode
    // this whole mode exists to prevent, arrived at from a button the review
    // notes invite them to press. Every number a demo box reports is already
    // synthetic (the clock runs 5x), so rounding this one up to the shortest
    // length the app will actually keep costs nothing real and makes Open
    // always do something visible. Capped at the planned duration so a lock
    // configured shorter than the floor is not inflated past its own length.
    const actual = Math.max(Math.min(this.setSeconds, MIN_LOGGED_SESSION_S), served);
    this.st = 'done';
    this.ticksInState = 0;
    this.remaining = 0;
    this.topic = '';
    this.pending = [
      ...this.pending,
      {
        p: this.setSeconds,
        a: actual,
        c: completed ? 1 : 0,
        // Ends now; buildLoggedSessions derives startedAt by subtracting `a`.
        // With DEMO_SECONDS_PER_TICK > 1 that start lands further back than
        // the demo actually ran, which is the intended reading: the session
        // is recorded as the five minutes the reviewer asked for.
        t: Math.floor(Date.now() / 1000),
      },
    ];
    this.emitStatus();
    this.emitHistory();
  }

  private emitStatus() {
    const status: Status = {
      st: this.st,
      rem: this.st === 'running' ? this.remaining : 0,
      set: this.setSeconds,
      bat: DEMO_BATTERY_PCT,
      tp: this.st === 'running' ? this.topic : '',
      fw: DEMO_FIRMWARE,
    };
    this.cb?.onStatus?.(status);
  }

  private emitHistory() {
    if (!this.pending.length) return;
    // A copy: the app's intake keeps hold of what it is handed, and this
    // queue is still mutable until ackHistory lands.
    this.cb?.onHistory?.(this.pending.map((e) => ({ ...e })));
  }
}
