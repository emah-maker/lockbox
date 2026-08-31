// protocol.ts -- the PhoneBox BLE GATT contract.
//
// These UUIDs and payload shapes are shared VERBATIM with the firmware in
// Box-code/lib/lock_config.py (UUIDs) and Box-code/lib/lock_ble.py /
// lock_controller.py (payloads). If you change one side you MUST change the
// other -- they are a single wire contract.

export const SERVICE_UUID = '6b9a7e00-4c2a-4f8e-9b21-9d7a5e3c0001';

export const CHAR = {
  status: '6b9a7e00-4c2a-4f8e-9b21-9d7a5e3c0002', // READ | NOTIFY  (box -> app)
  history: '6b9a7e00-4c2a-4f8e-9b21-9d7a5e3c0003', // READ | NOTIFY (box -> app)
  command: '6b9a7e00-4c2a-4f8e-9b21-9d7a5e3c0004', // WRITE        (app -> box)
  settings: '6b9a7e00-4c2a-4f8e-9b21-9d7a5e3c0005', // READ | WRITE (round-trip)
  timeSync: '6b9a7e00-4c2a-4f8e-9b21-9d7a5e3c0006', // WRITE       (epoch seconds)
  alert: '6b9a7e00-4c2a-4f8e-9b21-9d7a5e3c0007', // WRITE          (call label)
  labels: '6b9a7e00-4c2a-4f8e-9b21-9d7a5e3c0008', // WRITE         (label list)
  pendingTopic: '6b9a7e00-4c2a-4f8e-9b21-9d7a5e3c0009', // WRITE  (app -> box, forward tag suggestion)
} as const;

// ----- box -> app payloads -----
export type BoxState = 'idle' | 'closed' | 'running' | 'done';

// The runtime half of BoxState, so parseStatus can actually enforce the union
// rather than casting whatever string arrived into it. Keep in lockstep with
// Box-code/lib/lock_controller.py's own state names.
const BOX_STATES: readonly string[] = ['idle', 'closed', 'running', 'done'];

// Hard cap on the topic id echoed back in Status.tp, and on the version
// string. 200 mirrors stats/customLabels.ts's MAX_TOPIC_LENGTH (itself
// mirroring firestore.rules' sessions `create` rule, topic.size() <= 200) --
// hardcoded rather than imported for the same "this wire-parsing module stays
// UI-independent" reason the `acc` and langle/uangle bounds above are; keep
// them in lockstep.
//
// The cap matters because tp is not display-only. useStore's handleStatus
// parks it as this device's pending topic tag, which sessionHistory then
// attaches to the finished session, which sessionsSync uploads -- and an
// over-length topic is a document the rules refuse, failing the whole
// writeBatch and with it syncSessions, the first step of the entire account
// sync. See buildLoggedSessions' own comment on the pre-epoch startedAt case
// for why that failure is permanent rather than transient.
const MAX_TOPIC_CHARS = 200;
// Version strings are display-only (SettingsScreen's box section), so this is
// just a sanity bound on an unbounded string arriving off the radio.
const MAX_FW_CHARS = 32;

/** `Number(v)`, but a value that isn't a real finite number comes back as
 * `fallback` instead of NaN.
 *
 * The `Number(x) || 0` idiom used for the other numeric fields already does
 * this, because 0 is their fallback and NaN is falsy. It does NOT work for a
 * field whose fallback isn't 0 -- `bat` and `t` both use -1 as a documented
 * "unavailable" sentinel, and -1 is truthy, so `Number(x) || -1` would map a
 * legitimate 0% battery to -1. Writing the check out is the only way to get
 * both halves right. */
function numOr(value: unknown, fallback: number): number {
  if (value == null) return fallback;
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

/** `numOr`, floored. Every number on this wire is a whole count -- seconds,
 * percent, epoch seconds, degrees -- and the firmware only ever sends whole
 * ones, so a fraction arriving here is already a malformed frame.
 *
 * Flooring it is not cosmetic tidying. A session's numbers are copied
 * verbatim into a Firestore document, and firestore.rules' sessions `create`
 * rule requires `plannedS is int` and `actualS is int`. A fractional value
 * therefore doesn't produce a slightly-off session -- it produces a document
 * the rules refuse, which fails the whole writeBatch, which fails
 * syncSessions, which is the FIRST step of runMigrationAndSync. Settings,
 * goals and scheduled sessions never reconcile either, and because the record
 * stays in local storage it is retried on every subsequent sync forever. One
 * malformed frame, and the account never syncs again. */
function intOr(value: unknown, fallback: number): number {
  const n = numOr(value, fallback);
  return Math.floor(n);
}

export interface Status {
  st: BoxState;
  rem: number; // remaining seconds (running only, else 0)
  set: number; // configured lock seconds
  bat: number; // battery percent, -1 if unavailable
  // Topic id tagged via the box's OWN pre-session picker (Box-code/lib/
  // lock_controller.py go_picking/go_running's `topic` arg), echoed back
  // live while running -- '' whenever no on-box tag was chosen (including
  // any session tagged only from the app's own TopicPicker, which the box
  // has no way to know about). Only the id crosses the wire; the app still
  // resolves the display name/color itself via resolveTopic, same as any
  // other tag. See useStore.ts's handleStatus for how this reaches the
  // eventual logged session.
  tp: string;
  fw: string;
}

// A session the box finished while no phone was connected to see it live
// (see Box-code/lib/lock_log.py). The box holds these in RAM only -- no SD
// card, no NVM -- and clears its queue as soon as it has handed them to the
// app over the `history` characteristic, so the app is the durable copy.
export interface HistoryEntry {
  p: number; // planned seconds
  a: number; // actual seconds
  c: 0 | 1; // 1 = completed naturally, 0 = ended early (override/remote unlock)
  t: number; // wall-clock epoch seconds when it ended, or -1 if never time-synced
}

export interface Settings {
  ovr: number; // override presses
  auto: 0 | 1; // auto-open
  sleep: number; // screen-sleep seconds
  bright: number; // backlight percent
  unlk: 0 | 1; // remote unlock from the phone -- off by default; opt in from Settings
  ucal: 0 | 1; // unlock when called -- off by default; opt in from Settings. Distinct
  // from `unlk`: this fires from an incoming call (alert path), not a deliberate
  // Open/Close tap on the app.
  thm: 0 | 1; // theme mode -- index into theme.ts THEME_MODES (0=dark, 1=light).
  // Phone is authoritative here (see useStore.afterConnected): unlike the other
  // fields, the box's echoed value is never read back into the app's own theme.
  acc: number; // accent -- index into theme.ts ACCENT_KEYS (0=mint..5=rose).
  // The box applies this to its decorative accent elements -- the LOCK/OPEN
  // button, the analog clock's second hand, the settings screen's values
  // (list + detail page), and the elapsed-clock style's time text (see
  // Box-code/lib/lock_ui.py set_theme/_accent_widgets) -- but never recolors
  // lock/closed/unlocked status indicators.
  flip: 0 | 1; // rotate the box's own screen 180° -- lets it be mounted
  // upside-down and still read right-side-up. Off by default. Applied via
  // Box-code/lib/lock_ui.py LockUI.set_screen_flipped (display rotation) and
  // LockController._map (touch coordinate correction).
  langle: number; // servo angle (degrees) the box drives to when locking.
  // Was a fixed lock_servo.py constant (45°); now phone-adjustable. Range
  // [-90, 90] -- mirrors app/src/screens/servoAngle.ts's SERVO_ANGLE_MIN/MAX
  // and the box's own clamp; keep both in lockstep with lock_config.py.
  uangle: number; // servo angle (degrees) the box drives to when unlocking.
  // Was a fixed lock_servo.py constant (0°); now phone-adjustable. Same
  // [-90, 90] range/clamp as langle above.
  ovrt: number; // override auto-reset window, in TENTHS OF A SECOND.
  // The only field on this wire whose unit is not the one a user sees: the
  // box stores it in a single NVM byte and every other number here is an
  // integer, so it travels in tenths and is divided by 10 exactly once, at
  // the UI boundary (see screens/overrideTimeout.ts). Was a fixed
  // lock_config.py constant (OVERRIDE_TIMEOUT); now phone-adjustable.
  // Range [3, 100] = 0.3s-10.0s -- mirrors OVR_TIMEOUT_MIN_TENTHS/
  // OVR_TIMEOUT_MAX_TENTHS in lock_config.py; keep both in lockstep.
}

// ----- parsers (defensive: the radio can hand us partial/garbled JSON) -----
export function parseStatus(json: string): Status | null {
  try {
    const d = JSON.parse(json);
    // Checked against the union, not merely `typeof === 'string'`. `st` drives
    // every state machine downstream (useStore's freshRun detection,
    // CallMonitor's LOCKED check, the Home hero's whole rendering), and a
    // string this build has never heard of was previously cast straight into
    // BoxState -- so the type said the value was one of four things while the
    // value was anything at all. Rejecting the frame is right rather than
    // defaulting: a status whose state can't be read carries no information
    // any of those consumers can use, and the box re-notifies on a cadence.
    if (!BOX_STATES.includes(d.st)) return null;
    return {
      st: d.st as BoxState,
      rem: Number(d.rem) || 0,
      set: Number(d.set) || 0,
      // -1, this field's own documented "unavailable" sentinel, for a value
      // that isn't a finite number -- NOT NaN. A NaN here poisoned the
      // persisted battery-sample log (battery/useBatteryStore.ts): its two
      // skip guards are `pct < 0` and `lastRecordedPct === pct`, and NaN
      // satisfies neither (NaN !== NaN), so every single status tick appended
      // a fresh NaN sample and rewrote AsyncStorage, until the 500-sample log
      // held nothing else and the runtime estimate could never recover.
      bat: numOr(d.bat, -1),
      tp: String(d.tp ?? '').slice(0, MAX_TOPIC_CHARS),
      fw: String(d.fw ?? '').slice(0, MAX_FW_CHARS),
    };
  } catch {
    return null;
  }
}

export function parseHistoryEntries(json: string): HistoryEntry[] {
  try {
    const d = JSON.parse(json);
    if (!Array.isArray(d)) return [];
    return d
      .filter((e) => e && typeof e === 'object')
      .map((e) => ({
        p: intOr(e.p, 0),
        a: intOr(e.a, 0),
        c: e.c ? 1 : 0,
        // -1 ("never time-synced") for a non-finite value, same as `bat`
        // above and for a sharper reason: sessionHistory's
        // buildLoggedSessions branches on `t < 0`, which NaN fails, so a
        // garbled timestamp used to compute `startedAt: NaN` and store it
        // durably. That is not a display glitch -- dayKey() renders
        // 'NaN-NaN-NaN' so the session vanishes from the calendar and every
        // day-bucketed stat, the merge sorts it arbitrarily, and
        // sessionMerge's deterministic doc id uploads it to Firestore as
        // `<device>_NaN_<actualS>`, permanently. -1 instead routes it down
        // the approxStart path this field already has for exactly this case:
        // a timestamp the box could not supply.
        t: intOr(e.t, -1),
      }));
  } catch {
    return [];
  }
}

export function parseSettings(json: string): Settings | null {
  try {
    const d = JSON.parse(json);
    // langle/uangle default to the box's own fixed pre-upgrade constants
    // (45/0, see lock_servo.py) rather than 0 for both -- unlike every other
    // field here, 0 is a legitimate in-range angle, so `Number(d.x) || 0`
    // would silently overwrite a real, intentional 0° with a fallback. Only
    // an actually missing/non-finite value should fall back at all.
    const langleRaw = Number(d.langle);
    const uangleRaw = Number(d.uangle);
    // Same "0 is not a usable fallback" reasoning as langle/uangle, for a
    // different reason: 0 is not a legitimate value here at all, it is a
    // window in which the counter can never advance. A box running firmware
    // older than this field sends no `ovrt`, so fall back to the constant
    // that firmware actually uses (1.0s = 10 tenths) rather than to 0, which
    // would render as "0.0s" in the UI and, if echoed back, be clamped to
    // the floor by the box -- a setting the user never chose.
    const ovrtRaw = Number(d.ovrt);
    return {
      ovr: Number(d.ovr) || 0,
      auto: d.auto ? 1 : 0,
      sleep: Number(d.sleep) || 0,
      bright: Number(d.bright) || 0,
      unlk: d.unlk ? 1 : 0,
      ucal: d.ucal ? 1 : 0,
      thm: Number(d.thm) === 1 ? 1 : 0,
      // Upper bound is ACCENT_KEYS.length - 1 (../theme/theme.ts) -- not
      // imported here to keep this wire-parsing module UI-independent, same
      // reasoning as the manually-synced UUIDs above. Was hardcoded to 5
      // (the old 6-accent set's last index); bump this by hand alongside
      // ACCENT_KEYS/Box-code/lib/lock_config.py's ACCENT_COLORS_DARK/LIGHT
      // if the accent count ever changes again.
      acc: Math.max(0, Math.min(7, Number(d.acc) || 0)),
      flip: d.flip ? 1 : 0,
      // -90/90 hardcoded here (not imported from screens/servoAngle.ts) for
      // the same "wire-parsing module stays UI-independent" reason as the
      // acc bound above -- keep in lockstep with SERVO_ANGLE_MIN/MAX there.
      langle: Math.max(-90, Math.min(90, Number.isFinite(langleRaw) ? Math.round(langleRaw) : 45)),
      uangle: Math.max(-90, Math.min(90, Number.isFinite(uangleRaw) ? Math.round(uangleRaw) : 0)),
      // 3/100 hardcoded for the same UI-independence reason as the bounds
      // above -- keep in lockstep with lock_config.py's OVR_TIMEOUT_*_TENTHS.
      ovrt: Math.max(3, Math.min(100, Number.isFinite(ovrtRaw) ? Math.round(ovrtRaw) : 10)),
    };
  } catch {
    return null;
  }
}

// ----- app -> box encoders -----
export const cmdStart = (seconds: number) => `start:${Math.max(0, Math.floor(seconds))}`;
// Live duration preview: pushes the H/M stepper's value to the box as it
// changes, so the on-screen clock tracks the picked time without pressing
// Lock (which is what cmdStart above still does -- set AND start in one
// write). Ignored by the box while a countdown is already running -- see
// Box-code/lib/lock_controller.apply_ble_command's "dur" opcode.
export const cmdSetDuration = (seconds: number) => `dur:${Math.max(0, Math.floor(seconds))}`;
export const cmdLock = () => 'lock';
export const cmdUnlock = () => 'unlock'; // ignored if the box's remote-unlock setting is off
// Unlike cmdStart/cmdSetDuration just above (both Math.max(0, Math.floor(...))
// clamped), this used to JSON.stringify(s) verbatim with no validation at all
// -- a NaN/Infinity slipping into any numeric field (e.g. a bad slider read)
// would serialize as a bare `NaN`/`Infinity` token, which isn't valid JSON,
// aborting the box's parse of the *entire* settings write with no
// diagnostic (production readiness review, Low: "asymmetric input clamping
// between BLE encode/parse paths"). Not currently exploitable end-to-end --
// the firmware already clamps defensively -- but this is the app's own
// belt-and-suspenders layer, same as clampLockSeconds/OverrideCustomEntry's
// clamp elsewhere in this app.
export const encodeSettings = (s: Settings) =>
  JSON.stringify({
    ovr: Number.isFinite(s.ovr) ? Math.floor(s.ovr) : 0,
    auto: s.auto ? 1 : 0,
    sleep: Number.isFinite(s.sleep) ? Math.floor(s.sleep) : 0,
    bright: Number.isFinite(s.bright) ? Math.floor(s.bright) : 0,
    unlk: s.unlk ? 1 : 0,
    ucal: s.ucal ? 1 : 0,
    thm: s.thm === 1 ? 1 : 0,
    acc: Number.isFinite(s.acc) ? Math.floor(s.acc) : 0,
    flip: s.flip ? 1 : 0,
    // Fallbacks are the box's own pre-upgrade fixed constants (45/0), not 0
    // for both -- see parseSettings's comment on the same asymmetry.
    langle: Number.isFinite(s.langle) ? Math.max(-90, Math.min(90, Math.floor(s.langle))) : 45,
    uangle: Number.isFinite(s.uangle) ? Math.max(-90, Math.min(90, Math.floor(s.uangle))) : 0,
    // Tenths of a second, integer -- see the Settings interface. Fallback is
    // the box's own pre-upgrade fixed constant (1.0s), not 0.
    ovrt: Number.isFinite(s.ovrt) ? Math.max(3, Math.min(100, Math.floor(s.ovrt))) : 10,
  });
export const encodeTime = (epochSeconds: number) => String(Math.floor(epochSeconds));

// An "important call" alert. The nonce forces a distinct write each time so the
// box re-fires the on-screen notification even for the same caller.
export const encodeAlert = (nonce: number, label: string) => `${nonce}|${label}`;

// Acks a `history` batch once the app has durably persisted it (see
// useStore.ts's handleHistory -> sessionHistory.appendSessions). Reuses the
// existing `command` characteristic (no new BLE UUID) -- see
// docs/rfcs/ios-call-greenlist-and-force-quit-logging-technical-design.md
// §3.2 for why the box needs this at all: it now only clears its own pending
// queue (Box-code/lib/lock_log.py SessionLog) once it hears this back,
// instead of on every notify, which had no delivery guarantee. `seq` is just
// the number of entries in the batch being acked -- the box's queue is
// strictly FIFO/append-only and `history` always serializes the *entire*
// current pending set (never a delta), so "how many entries were in the
// batch I just received" is an unambiguous stand-in for a sequence number:
// SessionLog.ack() clears exactly that many from the front, leaving anything
// recorded after the send untouched.
export const cmdHistoryAck = (seq: number) => `historyAck:${Math.max(0, Math.floor(seq))}`;

// Best-effort push of the app's custom-label catalog (stats/customLabels.ts)
// to the box, so its own pre-session tag picker can offer the same labels
// the app does (name only, abbreviated to BLE_LABEL_NAME_MAX_LEN chars to
// fit the screen -- see Box-code/lib/lock_ui.py show_tag_picker; the color
// still crosses the wire per label but the box's own picker doesn't render
// a swatch with it today). Writes CHAR.labels directly
// (Box-code/lib/lock_config.py's dedicated BLE_UUID_LABELS characteristic),
// NOT CHAR.command -- unlike cmdHistoryAck/cmdSetDuration etc., this isn't
// an opcode apply_ble_command recognizes, it's read straight off its own
// characteristic by lock_ble.py's _drain_inbound. Raw JSON, no opcode
// prefix, and compact keys (i/n/c) to save BLE payload bytes -- mirrors
// Box-code/lib/lock_controller.py's apply_ble_labels_json exactly; keep the
// two in lockstep.
// Mirrors Box-code/lib/lock_config.py's BLE_LABEL_MAX_COUNT/
// BLE_LABEL_NAME_MAX_LEN exactly. The box already re-applies both limits
// defensively on receipt (apply_ble_labels_json), so this isn't the only
// thing standing between an oversized catalog and a dropped/truncated
// label -- same "app clamps too" belt-and-suspenders as clampLockSeconds --
// but truncating here means what the app just sent is what actually shows
// on the box, not a silent further cut the app has no visibility into.
export const BLE_LABEL_MAX_COUNT = 8;
export const BLE_LABEL_NAME_MAX_LEN = 12;

export const cmdSetLabels = (labels: { id: string; name: string; color: string }[]) =>
  JSON.stringify(
    labels
      .slice(0, BLE_LABEL_MAX_COUNT)
      .map((l) => ({ i: l.id, n: l.name.slice(0, BLE_LABEL_NAME_MAX_LEN), c: l.color })),
  );

// One-way app -> box push of the topic the user already picked in the app,
// *before* a session exists -- so pressing LOCK on the box can show a
// confirm screen for it instead of falling back to the box's own picker.
// Writes CHAR.pendingTopic directly (Box-code/lib/lock_ble.py's dedicated
// `pending_topic` characteristic / LockController.apply_ble_pending_topic),
// NOT an opcode through CHAR.command -- apply_ble_command is rate-limited to
// one accepted command per second (BLE_CMD_MIN_INTERVAL = 1.0), so an opcode
// here could starve a concurrent start/dur/historyAck. This is occasional
// declarative state, not a time-sensitive command -- the same category
// cmdSetLabels above is already in, which is why it has its own
// characteristic too. `''` means "nothing pending" -- the same
// empty-string-means-cleared convention Status.tp already uses on the way
// back.
export const cmdSetPendingTopic = (topicId: string | null) => topicId ?? '';
