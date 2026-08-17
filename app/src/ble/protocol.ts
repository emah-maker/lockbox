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
} as const;

// ----- box -> app payloads -----
export type BoxState = 'idle' | 'closed' | 'running' | 'done';

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
}

// ----- parsers (defensive: the radio can hand us partial/garbled JSON) -----
export function parseStatus(json: string): Status | null {
  try {
    const d = JSON.parse(json);
    if (typeof d.st !== 'string') return null;
    return {
      st: d.st,
      rem: Number(d.rem) || 0,
      set: Number(d.set) || 0,
      bat: d.bat == null ? -1 : Number(d.bat),
      tp: String(d.tp ?? ''),
      fw: String(d.fw ?? ''),
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
        p: Number(e.p) || 0,
        a: Number(e.a) || 0,
        c: e.c ? 1 : 0,
        t: e.t == null ? -1 : Number(e.t),
      }));
  } catch {
    return [];
  }
}

export function parseSettings(json: string): Settings | null {
  try {
    const d = JSON.parse(json);
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
export const encodeSettings = (s: Settings) => JSON.stringify(s);
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
