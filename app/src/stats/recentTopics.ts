// recentTopics.ts -- "which labels does this user actually reach for", so a
// tagging surface can put those first instead of making the user hunt
// through the full catalog every time. Pure and dependency-free (only a type
// import from sessionHistory.ts), unit-testable the same way trend.ts and
// topics.ts are.
//
// Deliberately NOT "most used, all time" and NOT "most recent, full stop" --
// either alone gets this wrong in a way people notice:
//   - Pure frequency freezes: a label used heavily last year outranks the
//     one you have used for every session this week.
//   - Pure recency thrashes: one stray tag yesterday displaces the label you
//     use daily.
// A frequency count with exponential recency decay is the standard fix and
// behaves like both at the extremes: with everything logged today it reduces
// to plain frequency, and a long-dormant label decays out of the way no
// matter how heavily it was once used.
import type { LoggedSession } from './sessionHistory';

/** Days after which one session counts half as much toward a label's score.
 * Two weeks: long enough that a label used a few times a week holds its
 * place through a quiet weekend, short enough that a label abandoned a month
 * ago (~4 half-lives, ~6% weight) drops off without needing a hard cutoff. */
export const RECENCY_HALF_LIFE_DAYS = 14;

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** How many sessions back to look. Bounds the work on a long history
 * (sessionHistory.ts caps storage at 2000 records) -- and anything older
 * than the most recent few hundred sessions has decayed to nothing anyway,
 * so this changes no realistic ranking. */
const MAX_SESSIONS_CONSIDERED = 500;

export interface RankedTopic {
  topic: string;
  /** Recency-weighted session count. Comparable only against other entries
   * from the same call -- the absolute value has no meaning on its own. */
  score: number;
  /** Raw, undecayed session count, for a caller that wants to show "12
   * sessions" alongside the label. */
  count: number;
  /** Epoch ms of the most recent session carrying this topic. */
  lastUsedAt: number;
}

/**
 * Every topic that appears in `sessions`, ranked best-first by
 * recency-weighted frequency. Ties (identical scores, e.g. two labels used
 * once each on the same day) break on `lastUsedAt` so the order is total and
 * stable rather than dependent on input order.
 *
 * Untagged sessions are skipped entirely -- "untagged" is the absence of a
 * topic, not a topic that could be ranked or suggested.
 *
 * Returns raw topic id strings, exactly as stored on the session: a built-in
 * TopicKey, a `custom:` label id, or a one-time free-text tag. This module
 * deliberately does not resolve them to display names -- callers pass them
 * through stats/customLabels.ts's resolveTopic, which is also what decides
 * whether a given id is still renderable at all (a since-deleted custom
 * label isn't).
 */
export function rankTopics(sessions: LoggedSession[], nowMs: number = Date.now()): RankedTopic[] {
  // Newest first, then capped -- so the cap drops the OLDEST sessions (the
  // ones that would have contributed least anyway), never the newest.
  const considered = [...sessions]
    .sort((a, b) => b.startedAt - a.startedAt)
    .slice(0, MAX_SESSIONS_CONSIDERED);

  const byTopic = new Map<string, RankedTopic>();
  for (const s of considered) {
    if (!s.topic) continue;
    // Clamped at 0 so a session with a clock-skewed future startedAt scores
    // as "right now" rather than earning an unbounded weight above 1.
    const ageDays = Math.max(0, (nowMs - s.startedAt) / MS_PER_DAY);
    const weight = Math.pow(0.5, ageDays / RECENCY_HALF_LIFE_DAYS);
    const existing = byTopic.get(s.topic);
    if (existing) {
      existing.score += weight;
      existing.count += 1;
      existing.lastUsedAt = Math.max(existing.lastUsedAt, s.startedAt);
    } else {
      byTopic.set(s.topic, { topic: s.topic, score: weight, count: 1, lastUsedAt: s.startedAt });
    }
  }

  return Array.from(byTopic.values()).sort((a, b) => b.score - a.score || b.lastUsedAt - a.lastUsedAt);
}

/**
 * The top `limit` topic ids, filtered to those a caller can still render.
 * `isRenderable` is injected rather than importing resolveTopic here,
 * keeping this module free of customLabels.ts's dependency chain (topics.ts,
 * theme.ts) exactly as its header describes -- and letting a caller decide
 * for itself what "renderable" means in its context.
 *
 * `exclude` drops ids the caller is already showing elsewhere, so a "recent"
 * row never duplicates a chip sitting directly beneath it.
 */
export function topRecentTopics(
  sessions: LoggedSession[],
  limit: number,
  isRenderable: (topic: string) => boolean,
  exclude: ReadonlySet<string> = new Set(),
  nowMs: number = Date.now(),
): string[] {
  const ranked = rankTopics(sessions, nowMs);
  const out: string[] = [];
  for (const r of ranked) {
    if (out.length >= limit) break;
    if (exclude.has(r.topic)) continue;
    if (!isRenderable(r.topic)) continue;
    out.push(r.topic);
  }
  return out;
}
