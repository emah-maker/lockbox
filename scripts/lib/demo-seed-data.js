// demo-seed-data.js -- the App Review demo account's data, as pure functions.
//
// Split from scripts/seed-demo-account.js, which owns credentials, the
// Firebase client, and the writes. The seam is the same one this repo already
// draws between sessionMerge.ts and firestoreSync.ts, or goalSanitize.ts and
// goals.ts: everything here is a pure function of `nowMs`, so it can be
// printed by --dry-run, diffed, and reasoned about without a network call.
//
// Every payload below is shaped to pass app/firestore.rules as written. Read
// that file before changing any of them -- a rejected write surfaces as a
// generic permission error that says nothing about which field was wrong.

/** The deviceId component of every seeded session's document ID, and it MUST
 * be this value.
 *
 * sync/sessionMerge.ts's sessionDocId is `${deviceId}_${startedAt}_${actualS}`,
 * and sync/sessionsSync.ts's currentDeviceId() falls back to 'unknown-device'
 * on a phone that has never connected to a box -- which is exactly the
 * reviewer's phone. Seed under any other id and the reviewer's first sync
 * pulls these sessions down, recomputes a DIFFERENT id for each one, matches
 * none of them against what it just read, and uploads a second copy of every
 * session: permanent double-counting in every stat, with no way to delete the
 * duplicates (firestore.rules makes session docs undeletable by anyone). */
export const DEVICE_ID = 'unknown-device';

/** Unremarkable on purpose -- a reviewer should read this as a person's
 * account, not as test scaffolding. */
export const DISPLAY_NAME = 'Alex Rivera';

/** Three weeks plus today. Enough for the calendar heat map to show a habit
 * and for the Stats tab's week/month windows to both have content. */
export const HISTORY_DAYS = 22;

/** Two custom labels, so the label UI is not an empty state. Colors come from
 * stats/customLabels.ts's LABEL_SWATCHES, which are deliberately distinct from
 * the built-in topic palette so a custom label never reads as a built-in one.
 * Neither carries `excludeFromTotals`: everything seeded here should count. */
export const LABELS = [
  { id: 'custom:demo-thesis', name: 'Thesis', color: '#7c3aed' },
  { id: 'custom:demo-guitar', name: 'Guitar', color: '#0891b2' },
];

// Five of the six built-in topics (stats/topics.ts) plus both custom labels,
// weighted, so the topic breakdown and the label UI each have something to
// show. `undefined` is an untagged session, which the app also has to render.
const TOPIC_POOL = [
  'work', 'work', 'work', 'work', 'study', 'study', 'study',
  'custom:demo-thesis', 'custom:demo-thesis', 'reading', 'reading',
  'creative', 'exercise', 'custom:demo-guitar', undefined,
];
const PLANNED_CHOICES = [1500, 1800, 2700, 3000, 3600]; // 25m / 30m / 45m / 50m / 60m
const START_HOURS = [8, 9, 10, 11, 13, 14, 15, 16, 19, 20];
const START_MINUTES = [0, 15, 30, 45];

/** Deterministic PRNG (mulberry32), seeded per CALENDAR DAY rather than per
 * run. That is what makes the whole script re-runnable: a given date's
 * sessions are always byte-identical, so their document IDs are too, so a
 * second run finds them already present and writes nothing -- instead of
 * appending a duplicate set that could never be deleted. */
function mulberry32(seed) {
  let a = seed | 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const pick = (rng, arr) => arr[Math.floor(rng() * arr.length)];

/** Rounds to a whole number of minutes, floored at one.
 *
 * Load-bearing, not cosmetic: sessionHistory.ts's MIN_LOGGED_SESSION_S drops
 * any record under 60s from the local log on load, so a shorter seeded session
 * would sync down from Firestore and then vanish -- which looks exactly like a
 * sync bug on the reviewer's screen. */
const toWholeMinutes = (s) => Math.max(60, Math.round(s / 60) * 60);

/** Local-timezone Y-M-D, matching stats/sessionHistory.ts's own dayKey. */
export const dayKey = (ms) => {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

/** sync/sessionMerge.ts's sessionDocId, re-derived here. See DEVICE_ID. */
export const sessionDocId = (s) => `${DEVICE_ID}_${s.startedAt}_${s.actualS}`;

/** How many sessions a given weekday gets. Weekends are lighter and more often
 * empty, so the calendar heat map reads as a real habit and not a filled grid. */
function sessionCountFor(dow, roll) {
  if (dow === 0 || dow === 6) return roll < 0.3 ? 0 : roll < 0.75 ? 1 : 2;
  return roll < 0.08 ? 0 : roll < 0.35 ? 1 : roll < 0.78 ? 2 : 3;
}

/**
 * The seeded session log: HISTORY_DAYS calendar days ending today, ascending
 * by startedAt. Drives Home's ring, the whole Stats tab, and the calendar heat
 * map.
 *
 * Every record is shaped for firestore.rules' sessions `create` rule:
 * non-negative integers for startedAt/plannedS/actualS, `outcome` exactly
 * 'completed' or 'overridden', `topic` under 200 chars, and no key outside
 * that rule's `hasOnly` allow-list.
 */
export function buildSessions(nowMs) {
  const today = new Date(nowMs);
  today.setHours(0, 0, 0, 0);
  const out = [];

  for (let back = HISTORY_DAYS - 1; back >= 0; back -= 1) {
    const day = new Date(today.getFullYear(), today.getMonth(), today.getDate() - back);
    const rng = mulberry32(day.getFullYear() * 10000 + (day.getMonth() + 1) * 100 + day.getDate());
    const count = sessionCountFor(day.getDay(), rng());
    const usedHours = new Set();

    for (let i = 0; i < count; i += 1) {
      let hour = pick(rng, START_HOURS);
      while (usedHours.has(hour)) hour += 1; // two sessions in one hour would overlap
      usedHours.add(hour);

      const startedAt = new Date(
        day.getFullYear(), day.getMonth(), day.getDate(), hour, pick(rng, START_MINUTES), 0, 0,
      ).getTime();
      const plannedS = pick(rng, PLANNED_CHOICES);
      const overridden = rng() < 0.16;
      const actualS = overridden
        ? Math.min(plannedS - 60, Math.max(300, toWholeMinutes(plannedS * (0.35 + 0.45 * rng()))))
        : plannedS;
      const topic = pick(rng, TOPIC_POOL);

      // A session the user has not started yet is not history. This is the one
      // place the output depends on the clock as well as the date, and it only
      // ever WITHHOLDS today's later slots -- it never alters an
      // already-written record, so re-running later the same day adds at most
      // the slots that have since begun. Every roll above happens either way,
      // so skipping here does not shift the rest of the day's data.
      if (startedAt > nowMs) continue;

      out.push({
        startedAt,
        plannedS,
        actualS,
        outcome: overridden ? 'overridden' : 'completed',
        // Omitted, not written as undefined: Firestore rejects undefined
        // outright, and the rule's allow-list is `hasOnly`, so an absent topic
        // is the correct representation of an untagged session.
        ...(topic ? { topic, topicUpdatedAt: startedAt } : {}),
      });
    }
  }
  return out.sort((a, b) => a.startedAt - b.startedAt);
}

/**
 * The window a goal of `period` is measured over, mirroring
 * goals/goalProgress.ts's dailyWindow/weeklyWindow/monthlyWindow exactly:
 * local calendar day, local calendar week SUNDAY-START, local calendar month.
 *
 * Re-derived rather than imported because that module is TypeScript inside the
 * Expo app; if its math ever changes this must follow (its own header names
 * tests/fixtures/goalProgress.golden.json as the place drift gets caught).
 *
 * The Sunday-start detail is not a nicety: a trailing-7-days approximation
 * overstates the weekly window on every day but Saturday, so a target derived
 * from it reads as "met" at seed time and as "not met" in the app.
 */
function goalWindowStart(period, nowMs) {
  const d = new Date(nowMs);
  if (period === 'daily') return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  if (period === 'weekly') return new Date(d.getFullYear(), d.getMonth(), d.getDate() - d.getDay()).getTime();
  return new Date(d.getFullYear(), d.getMonth(), 1).getTime();
}

/** Seconds of seeded focus time from `sinceMs` on, optionally for one topic.
 * Nothing seeded here is excluded from totals (no label carries
 * excludeFromTotals, excludedTopicKeys is empty), so this is the same number
 * stats/stats.ts's aggregate and goals/goalProgress.ts will compute. */
function totalS(sessions, sinceMs, topic) {
  return sessions
    .filter((s) => s.startedAt >= sinceMs && (topic === undefined || s.topic === topic))
    .reduce((sum, s) => sum + s.actualS, 0);
}

/**
 * Goals, shaped for goals/goalSanitize.ts's sanitizeRemoteGoals (which drops
 * any entry whose id/topic/period/targetS it cannot trust) and for
 * firestore.rules' goals/config rule.
 *
 * Two of the three targets are DERIVED from the seeded history inside each
 * goal's own real window, so the handoff's "at least one already met and one in
 * progress" holds on whatever day this actually runs. A hardcoded target would
 * be met or missed by luck, and by a different margin on a Sunday than on a
 * Saturday, since the weekly window is a calendar week.
 *
 * Reminders are off on every goal (`notify: false`): a reviewer should not get
 * notifications from a demo account.
 */
export function buildGoals(sessions, nowMs) {
  const todayMs = goalWindowStart('daily', nowMs);
  const monthAll = totalS(sessions, goalWindowStart('monthly', nowMs));
  const todayAll = totalS(sessions, todayMs);

  return [
    // ALREADY MET. Monthly, deliberately: the widest window holds the most
    // seeded history, so 70% of it is met on any day of the month -- including
    // the 1st, when a weekly or daily target derived the same way would have
    // almost nothing to be a fraction of.
    {
      id: 'goal:demo-monthly-focus',
      topic: null,
      period: 'monthly',
      targetS: Math.min(2678400, Math.max(60, toWholeMinutes(monthAll * 0.7))),
      notify: false,
      createdAt: todayMs - 21 * 86400000,
      updatedAt: todayMs,
      archived: false,
    },
    // IN PROGRESS. Half again what today already holds, floored at an hour, so
    // the goal ring shows partial progress rather than empty or complete.
    {
      id: 'goal:demo-daily-focus',
      topic: null,
      period: 'daily',
      targetS: Math.min(86400, Math.max(3600, toWholeMinutes(todayAll * 1.5))),
      notify: false,
      createdAt: todayMs - 18 * 86400000,
      updatedAt: todayMs,
      archived: false,
    },
    // A narrower goal, so the list is not three variations of one shape: one
    // custom label, weekdays only, a modest target.
    {
      id: 'goal:demo-thesis-weekdays',
      topic: 'custom:demo-thesis',
      period: 'daily',
      targetS: 1800,
      daysOfWeek: [1, 2, 3, 4, 5],
      notify: false,
      createdAt: todayMs - 12 * 86400000,
      updatedAt: todayMs,
      archived: false,
    },
  ];
}

/** What each seeded goal's ring will actually read, computed the way
 * goals/goalProgress.ts computes it. The caller prints this on every run
 * (including --dry-run) so "one met, one in progress" is verified against the
 * data rather than assumed -- and so a future change to the generator that
 * quietly breaks it shows up here instead of on a reviewer's screen. */
export function goalProgressReport(goals, sessions, nowMs) {
  return goals.map((g) => {
    const doneS = totalS(sessions, goalWindowStart(g.period, nowMs), g.topic ?? undefined);
    return { id: g.id, period: g.period, doneS, targetS: g.targetS, met: doneS >= g.targetS };
  });
}

/**
 * Two planned sessions in the near future, so the Calendar tab has content,
 * shaped for sync/scheduledSessionsSync.ts's RemotePlan and firestore.rules'
 * validPlan().
 *
 * Document IDs are derived from the date rather than random, so a re-run
 * overwrites the same plan instead of accumulating a new one; the caller
 * deletes the `sched_demo_*` plans whose day has already passed.
 */
export function buildPlans(nowMs) {
  const today = new Date(nowMs);
  today.setHours(0, 0, 0, 0);
  let tz = 'UTC';
  try {
    tz = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    // Diagnostic-only field (nothing reads it); UTC is a fine fallback.
  }

  // Mirrors ui/time.ts's formatClockTime, which is what the app writes here --
  // the client formats it because only it knows the device locale.
  const timeLabel = (time) => {
    const [h, m] = time.split(':').map(Number);
    const d = new Date();
    d.setHours(h, m, 0, 0);
    return d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  };

  return [
    { daysAhead: 1, time: '09:00', topic: 'work', plannedS: 3000, leadMinutes: 10, note: 'Inbox zero, then the roadmap doc' },
    { daysAhead: 3, time: '14:30', topic: 'custom:demo-thesis', plannedS: 3600, leadMinutes: 30, note: 'Chapter 3 revisions' },
  ].map(({ daysAhead, time, topic, plannedS, leadMinutes, note }) => {
    const d = new Date(today.getFullYear(), today.getMonth(), today.getDate() + daysAhead);
    const date = dayKey(d.getTime());
    const [h, m] = time.split(':').map(Number);
    const startMs = new Date(d.getFullYear(), d.getMonth(), d.getDate(), h, m, 0, 0).getTime();
    return {
      id: `sched_demo_${date.replace(/-/g, '')}_${time.replace(':', '')}`,
      date,
      plan: {
        date,
        time,
        // The only field the reminder backend queries on, computed here
        // because only this side knows the timezone.
        fireAtMs: startMs - leadMinutes * 60000,
        timeLabel: timeLabel(time),
        tz,
        topic,
        leadMinutes,
        plannedS,
        note,
        done: false,
        // A client writes null on create and on every edit; that is what
        // re-arms an edited plan. The reminder job is the only writer of a
        // real value, and Firestore cannot query for an absent field, so this
        // must be an explicit null rather than omitted.
        notifiedAt: null,
        updatedAt: nowMs,
      },
    };
  });
}

/**
 * settings/app -- exactly the six keys firestoreSync.ts's localSettingsPayload
 * writes, because that is the shape the rule's `hasOnly` allow-list validates.
 *
 * `updatedAt` is a client-side logical clock, not a server timestamp: a fresh
 * install carries 0, so any positive value wins settingsSyncPlan.ts's
 * last-write-wins compare and the reviewer's device adopts these rather than
 * pushing its own defaults up over them.
 */
export function buildSettings(nowMs) {
  return {
    themeMode: 'dark',
    accent: 'mint',
    callAlertsEnabled: true,
    customLabels: LABELS,
    excludedTopicKeys: [],
    updatedAt: nowMs,
  };
}
