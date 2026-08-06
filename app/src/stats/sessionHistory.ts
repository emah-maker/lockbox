// sessionHistory.ts -- the app's own local log of focus sessions. Most
// entries come live from BLE status transitions (see useStore's
// handleStatus); the rest are drained in a batch from the box's small
// RAM-only queue of sessions that finished while no phone was connected (see
// Box-code/lib/lock_log.py and useStore's handleHistory). Either way, this
// is the durable, per-session, timestamped copy -- the box keeps nothing
// long-term (no SD card, no NVM) once it has handed a session off here.
import type { SessionRecord } from './stats';
import { getJSON, setJSON } from '../storage/storage';

const KEY = 'sessionHistory';
const MAX_RECORDS = 2000; // keep unbounded growth in check; ~a session/hour is years of history

export interface LoggedSession extends SessionRecord {
  startedAt: number; // epoch ms, local device clock at session start
}

export async function loadSessions(): Promise<LoggedSession[]> {
  return getJSON<LoggedSession[]>(KEY, []);
}

/** Append one completed/overridden session and persist. Returns the updated list. */
export async function appendSession(session: LoggedSession): Promise<LoggedSession[]> {
  return appendSessions([session]);
}

/** Append a batch (e.g. a drained box history queue) in one read/write. */
export async function appendSessions(sessions: LoggedSession[]): Promise<LoggedSession[]> {
  if (!sessions.length) return loadSessions();
  const existing = await loadSessions();
  const next = [...existing, ...sessions].slice(-MAX_RECORDS);
  await setJSON(KEY, next);
  return next;
}

export async function clearSessions(): Promise<void> {
  await setJSON<LoggedSession[]>(KEY, []);
}

/** Local-timezone Y-M-D key so a session groups under the day it happened for the user. */
export function dayKey(epochMs: number): string {
  const d = new Date(epochMs);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function groupByDay(sessions: LoggedSession[]): Map<string, LoggedSession[]> {
  const map = new Map<string, LoggedSession[]>();
  for (const s of sessions) {
    const key = dayKey(s.startedAt);
    const bucket = map.get(key);
    if (bucket) bucket.push(s);
    else map.set(key, [s]);
  }
  return map;
}
