// protocol.ts -- the PhoneBox BLE GATT contract.
//
// These UUIDs and payload shapes are shared VERBATIM with the firmware in
// Box-code/lib/lock_config.py (UUIDs) and Box-code/lib/lock_ble.py /
// lock_controller.py (payloads). If you change one side you MUST change the
// other -- they are a single wire contract.

export const SERVICE_UUID = '6b9a7e00-4c2a-4f8e-9b21-9d7a5e3c0001';

export const CHAR = {
  status: '6b9a7e00-4c2a-4f8e-9b21-9d7a5e3c0002', // READ | NOTIFY  (box -> app)
  stats: '6b9a7e00-4c2a-4f8e-9b21-9d7a5e3c0003', // READ | NOTIFY  (box -> app)
  command: '6b9a7e00-4c2a-4f8e-9b21-9d7a5e3c0004', // WRITE        (app -> box)
  settings: '6b9a7e00-4c2a-4f8e-9b21-9d7a5e3c0005', // READ | WRITE (round-trip)
  timeSync: '6b9a7e00-4c2a-4f8e-9b21-9d7a5e3c0006', // WRITE       (epoch seconds)
  alert: '6b9a7e00-4c2a-4f8e-9b21-9d7a5e3c0007', // WRITE          (call label)
} as const;

// ----- box -> app payloads -----
export type BoxState = 'idle' | 'closed' | 'running' | 'done';

export interface Status {
  st: BoxState;
  rem: number; // remaining seconds (running only, else 0)
  set: number; // configured lock seconds
  bat: number; // battery percent, -1 if unavailable
  fw: string;
}

export interface Stats {
  avail: 0 | 1; // 0 = no SD card on the box
  n: number; // sessions
  foc: number; // total focus seconds
  done: number; // completed sessions
  str: number; // current streak (consecutive completed)
  lng: number; // longest session seconds
}

export interface Settings {
  ovr: number; // override presses
  auto: 0 | 1; // auto-open
  sleep: number; // screen-sleep seconds
  bright: number; // backlight percent
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
      fw: String(d.fw ?? ''),
    };
  } catch {
    return null;
  }
}

export function parseStats(json: string): Stats | null {
  try {
    const d = JSON.parse(json);
    if (!d.avail) return { avail: 0, n: 0, foc: 0, done: 0, str: 0, lng: 0 };
    return {
      avail: 1,
      n: Number(d.n) || 0,
      foc: Number(d.foc) || 0,
      done: Number(d.done) || 0,
      str: Number(d.str) || 0,
      lng: Number(d.lng) || 0,
    };
  } catch {
    return null;
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
    };
  } catch {
    return null;
  }
}

// ----- app -> box encoders -----
export const cmdStart = (seconds: number) => `start:${Math.max(0, Math.floor(seconds))}`;
export const cmdLock = () => 'lock';
export const cmdUnlock = () => 'unlock'; // honored only if the box enables remote unlock
export const encodeSettings = (s: Settings) => JSON.stringify(s);
export const encodeTime = (epochSeconds: number) => String(Math.floor(epochSeconds));

// An "important call" alert. The nonce forces a distinct write each time so the
// box re-fires the on-screen notification even for the same caller.
export const encodeAlert = (nonce: number, label: string) => `${nonce}|${label}`;
