// goalTopicDisplay.ts -- how a GOAL's topic is named and colored on screen.
//
// Split out of stats/customLabels.ts, which these two helpers pushed past
// this project's 500-line cap, and which is the wrong home for them anyway:
// that module is the topic CATALOG (what a topic id resolves to), while this
// is goal-specific presentation copy -- "All focus time" for an untopic'd
// goal, "Deleted label" for one aimed at a label that has since been removed.
//
// One copy, six call sites. Before this existed, screens/GoalRow.tsx,
// screens/home/useHomeGoalRing.ts, screens/settings/RingBaselineSection.tsx,
// screens/GoalTopicChips.tsx, screens/stats/GoalsProgressView.tsx and
// ui/calendar/CalendarStreaksSheet.tsx each carried their own -- three as
// named functions with comments citing each other as precedent, three inlined
// -- and three of those also re-derived the swatch color a second time.
import { resolveTopic, type CustomLabel } from '../stats/customLabels';
import type { ThemeMode } from '../theme/theme';

/**
 * A goal's topic as a display string: its label, "All focus time" for an
 * untopic'd goal (`topic === null`), or "Deleted label" when the custom label
 * it named has since been removed.
 *
 * Distinct from customLabels.ts's topicDisplayName, which returns null for
 * both of those cases so each caller can phrase them itself. Goal surfaces
 * don't want that freedom -- they want the SAME two phrasings everywhere,
 * which is exactly what stopped happening when every screen kept its own copy.
 */
export function goalTopicLabel(topic: string | null, customLabels: CustomLabel[], mode: ThemeMode): string {
  if (topic === null) return 'All focus time';
  return resolveTopic(topic, customLabels, mode)?.label ?? 'Deleted label';
}

/**
 * The name above plus the swatch color every goal surface draws beside it.
 *
 * The two theme colors are parameters rather than read from a theme here:
 * this module is pure and knows nothing about useTheme. `accent` is what an
 * untopic'd ("all focus time") goal shows; `fallback` is for a saved custom
 * label that has since been deleted.
 */
export function goalTopicDisplay(
  topic: string | null,
  customLabels: CustomLabel[],
  mode: ThemeMode,
  accent: string,
  fallback: string,
): { name: string; swatch: string } {
  if (topic === null) return { name: 'All focus time', swatch: accent };
  const resolved = resolveTopic(topic, customLabels, mode);
  return { name: resolved?.label ?? 'Deleted label', swatch: resolved?.color ?? fallback };
}
