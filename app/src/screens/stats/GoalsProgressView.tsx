// GoalsProgressView.tsx -- the read-only body StatsScreen swaps in when its
// period selector is set to "Goals" (task: "one card per active goal with a
// progress ring/bar, current-vs-target, streak or on-pace indicator, and
// the weekday restriction shown when present"). This is deliberately NOT
// the existing write-capable GoalsSection.tsx (add/edit/delete forms,
// wheel pickers) -- that stays reachable from StatsScreen's "Manage" sheet
// (see ManageSheet.tsx) so goal editing keeps working from Stats even
// before Settings grows its own goals section, but this card list itself
// only ever reads goals/progress, same "render only" discipline
// GoalsSection.tsx's own header describes for itself.
//
// Progress math is entirely delegated: computeGoalProgress/goalWindow from
// goals/goalProgress.ts (including its now-final daysOfWeek/targetSessions/
// dueToday/monthly-period fields -- see that file's own header, settled by
// the goals agent), current streak/on-pace/streak-state from
// stats/goalStreak.ts and best streak from its sibling
// stats/goalStreakHistory.ts (both built only on top of those same
// goalProgress exports -- see either file's header for why neither
// duplicates goalProgress.ts's actual window/ratio logic).
import React, { useEffect, useRef } from 'react';
import { Animated, View, Text, StyleSheet, ScrollView } from 'react-native';
import * as Haptics from 'expo-haptics';
import Feather from '@expo/vector-icons/Feather';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useStore } from '../../store/useStore';
import { useSettingsStore } from '../../store/useSettingsStore';
import { useGoalsStore } from '../../store/useGoalsStore';
import { useTheme } from '../../theme/useTheme';
import { withAlpha } from '../../theme/color';
import { formatDuration } from '../../stats/stats';
import { goalTopicDisplay } from '../../goals/goalTopicDisplay';
import { Goal } from '../../goals/goals';
import { computeGoalProgress, goalWindow, goalDisplayPercent } from '../../goals/goalProgress';
import { computeGoalStreak, isGoalOnPace, goalStreakState, GoalStreakState } from '../../stats/goalStreak';
import { computeBestGoalStreak } from '../../stats/goalStreakHistory';
import { AnimatedPressable } from '../../ui/AnimatedPressable';
import { useReducedMotion } from '../../ui/useReducedMotion';
import { useNowMs } from '../../ui/useNowMs';
import { typeScale } from '../../theme/tokens';
import { GoalRing } from './GoalRing';
import { GoalsEmptyState } from './GoalsEmptyState';
import { PeriodIcon, useMetCelebration } from './goalVisuals';

const WEEKDAY_ABBR = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const PERIOD_LABELS: Record<Goal['period'], string> = { daily: 'Daily', weekly: 'Weekly', monthly: 'Monthly' };

/** Renders the restricted-days list only when the goal actually carries a
 * real subset (present, non-empty, and not literally "every day", which is
 * indistinguishable from no restriction at all -- Goal.daysOfWeek's own
 * comment says undefined/[] both mean "every day"). */
function weekdayRestrictionLabel(goal: Goal): string | null {
  const days = goal.daysOfWeek;
  if (!days || days.length === 0 || days.length >= 7) return null;
  return [...days].sort().map((d) => WEEKDAY_ABBR[d] ?? '?').join(', ');
}

export function GoalsProgressView({
  onOpenGoalInSettings,
  onManage,
  onAddGoal,
  highlightGoalId,
}: {
  onOpenGoalInSettings: (goalId: string) => void;
  /** The always-visible "Manage goals" button below the card list -- opens
   * ManageSheet on whatever it normally shows (the goal list, or its own
   * empty state if there happen to be none). */
  onManage: () => void;
  /** The EMPTY-state's own "Start adding goals" CTA -- deliberately a
   * different callback from `onManage` above, not the same one reused (bug
   * fix: this used to just be `onManage`, which opened ManageSheet onto
   * GoalsSection.tsx's OWN "no goals yet" empty state -- a second, identical
   * "Start adding goals" button the user then had to tap AGAIN to actually
   * reach GoalForm). StatsScreen wires this to open the same sheet but with
   * its create form already open, so tapping this button reaches the form
   * in one step instead of two. */
  onAddGoal: () => void;
  highlightGoalId?: string | null;
}) {
  const c = useTheme();
  const sessions = useStore((s) => s.sessions);
  const customLabels = useSettingsStore((s) => s.customLabels);
  const excludedTopicKeys = useSettingsStore((s) => s.excludedTopicKeys);
  const themeMode = useSettingsStore((s) => s.themeMode);
  const goals = useGoalsStore((s) => s.goals);

  const active = React.useMemo(() => goals.filter((g) => !g.archived), [goals]);
  // Ticks on its own (useNowMs.ts) so a day/window boundary crossed while
  // this screen just sits open -- e.g. a daily goal met by a 23:50 session,
  // still open past midnight -- flips this memo back to "not met" on its
  // own, instead of freezing at whatever `nowMs` was at the last render that
  // happened to touch goals/sessions/customLabels/excludedTopicKeys.
  const nowMs = useNowMs();
  // customLabels/excludedTopicKeys so an excludeFromTotals-tagged session, or
  // one tagged with an excluded built-in topic, doesn't advance this ring
  // any more than it does anywhere else that counts (stats/customLabels.ts) --
  // previously omitted here, unlike every other computeGoalProgress call
  // site in the app.
  const progress = React.useMemo(
    () => computeGoalProgress(goals, sessions, nowMs, customLabels, excludedTopicKeys),
    [goals, sessions, nowMs, customLabels, excludedTopicKeys],
  );
  const progressById = React.useMemo(() => new Map(progress.map((p) => [p.goalId, p])), [progress]);

  if (active.length === 0) {
    return <GoalsEmptyState onAddGoal={onAddGoal} color={c} />;
  }

  return (
    <View style={{ flex: 1, gap: 10 }}>
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ gap: 10, paddingBottom: 8 }}>
        {active.map((goal) => {
        const result = progressById.get(goal.id);
        const focusS = result?.focusS ?? 0;
        const ratio = result?.ratio ?? 0;
        const met = result?.met ?? false;
        const dueToday = result?.dueToday ?? true;
        const sessionCount = result?.sessionCount ?? 0;
        const window = goalWindow(goal.period, nowMs);
        // customLabels is forwarded so a session tagged with an
        // excludeFromTotals label (e.g. "Sleep") doesn't count toward this
        // goal's streak any more than it counts toward its progress ring --
        // see goalStreak.ts's own windowTotals comment for the cross-agent
        // contract this satisfies.
        const streak = computeGoalStreak(goal, sessions, nowMs, customLabels, excludedTopicKeys);
        const bestStreak = computeBestGoalStreak(goal, sessions, nowMs, customLabels, excludedTopicKeys);
        const onPace = isGoalOnPace(ratio, met, window, nowMs);
        const streakState = goalStreakState(streak, bestStreak, dueToday, met, onPace);
        const restriction = weekdayRestrictionLabel(goal);
        const { name, swatch } = goalTopicDisplay(goal.topic, customLabels, themeMode, c.accent, c.textDim);
        // Off-day goals get a neutral ring rather than the "behind" warn
        // color -- a Mon/Wed/Fri goal reading amber on a Tuesday would look
        // like it's failing a target it was never scheduled to hit today
        // (see goalProgress.ts's dueToday comment on why 0 progress on an
        // off day isn't a miss).
        const ringColor = met ? c.success : !dueToday ? c.textDim : onPace ? c.accent : c.warn;

        return (
          <GoalCard
            key={goal.id}
            name={name}
            swatch={swatch}
            period={goal.period}
            focusS={focusS}
            targetS={goal.targetS}
            sessionCount={sessionCount}
            targetSessions={goal.targetSessions}
            ratio={ratio}
            met={met}
            dueToday={dueToday}
            onPace={onPace}
            streak={streak}
            bestStreak={bestStreak}
            streakState={streakState}
            restriction={restriction}
            highlighted={highlightGoalId === goal.id}
            ringColor={ringColor}
            color={c}
            onPress={() => onOpenGoalInSettings(goal.id)}
          />
        );
        })}
      </ScrollView>
      {/* Outside the ScrollView on purpose -- "Manage goals" must stay
          reachable regardless of how far the card list is scrolled, the same
          "always-visible action below a scroller" shape DashboardScreen's own
          bottom controls use. No scrollEnabled hand-off is needed between
          this scroller and anything else: this screen (StatsScreen) no
          longer has its own outer ScrollView (see StatsScreen's header), so
          this is the ONLY vertical scroller in the tree, not one of two
          fighting over the same drag the way Sheet's own scrollEnabled prop
          exists to resolve elsewhere in this app. Reintroducing a page-level
          scroll above this one would bring that hazard back. */}
      <AnimatedPressable
        style={[styles.manageBtn, { borderColor: withAlpha(c.textDim, 0.3) }]}
        onPress={onManage}
        accessibilityRole="button"
        accessibilityLabel="Manage goals"
        hitSlop={{ top: 4, bottom: 4, left: 0, right: 0 }}
      >
        <Text style={[styles.manageBtnText, { color: c.textDim }]}>Manage goals</Text>
      </AnimatedPressable>
    </View>
  );
}

function GoalCard({
  name,
  swatch,
  period,
  focusS,
  targetS,
  sessionCount,
  targetSessions,
  ratio,
  met,
  dueToday,
  onPace,
  streak,
  bestStreak,
  streakState,
  restriction,
  highlighted,
  ringColor,
  color,
  onPress,
}: {
  name: string;
  swatch: string;
  period: Goal['period'];
  focusS: number;
  targetS: number;
  sessionCount: number;
  targetSessions?: number;
  ratio: number;
  met: boolean;
  dueToday: boolean;
  onPace: boolean;
  streak: number;
  bestStreak: number;
  streakState: GoalStreakState;
  restriction: string | null;
  highlighted: boolean;
  ringColor: string;
  color: ReturnType<typeof useTheme>;
  onPress: () => void;
}) {
  const reducedMotion = useReducedMotion();
  const highlightAnim = useRef(new Animated.Value(0)).current;
  // A DIFFERENT trigger from highlightAnim above -- that one is a deep-link
  // "look here" cue driven by NavIntent.goalId; this is "this goal's target
  // was just met", driven by the met flag flipping false->true. Layered on
  // the same GoalRing in addition to, not instead of, highlightAnim (see
  // useMetCelebration's own header comment).
  const metPulse = useMetCelebration(met, reducedMotion);

  // Deep-linking here from a NavIntent.goalId (StatsScreen's consumeIntent
  // handling) is a one-shot "look here" cue, not a persistent selection --
  // pulses once on mount when this card is the target, then settles back
  // to its normal resting look, same restraint AnimatedTotal/StreakStat
  // apply elsewhere on this screen for a value that "just changed".
  useEffect(() => {
    if (!highlighted || reducedMotion) return;
    highlightAnim.setValue(1);
    Animated.timing(highlightAnim, { toValue: 0, duration: 1400, useNativeDriver: false }).start();
  }, [highlighted, reducedMotion, highlightAnim]);

  // Clamped display percentage -- see goalProgress.ts's goalDisplayPercent
  // for why this isn't `Math.round(ratio * 100)` off the unclamped `ratio`
  // (that used to print "1741%" inside a ring that GoalRing.tsx already
  // renders as a single full, saturated lap).
  const percent = goalDisplayPercent(ratio);
  const subtitle = `${formatDuration(focusS)} of ${formatDuration(targetS)}${
    targetSessions !== undefined ? ` · ${sessionCount}/${targetSessions} sessions` : ''
  } · ${PERIOD_LABELS[period]}`;

  return (
    <AnimatedPressable
      style={[
        styles.card,
        { backgroundColor: color.surface, borderColor: withAlpha(color.accent, 0.4), borderWidth: highlighted ? 1.5 : 0 },
      ]}
      onPress={() => {
        Haptics.selectionAsync();
        onPress();
      }}
      accessibilityRole="button"
      accessibilityLabel={`${name}, ${period} goal, ${formatDuration(focusS)} of ${formatDuration(targetS)}, ${percent} percent${
        streak > 0 ? `, ${streak} ${PERIOD_LABELS[period].toLowerCase()} streak` : ''
      }${streakState === 'atRisk' ? ', streak at risk' : ''}${
        streakState === 'broken' ? `, streak broken, best was ${bestStreak}` : ''
      }. Open in Settings.`}
    >
      <Animated.View
        pointerEvents="none"
        style={[
          StyleSheet.absoluteFill,
          { borderRadius: 14, backgroundColor: withAlpha(color.accent, 0.15), opacity: highlightAnim },
        ]}
      />
      <Animated.View style={{ transform: [{ scale: metPulse }] }}>
        <GoalRing ratio={ratio} color={ringColor} trackColor={withAlpha(color.textDim, 0.2)}>
          <Text style={[styles.ringPercent, { color: color.text }]}>{percent}%</Text>
        </GoalRing>
      </Animated.View>
      <View style={styles.cardBody}>
        <View style={styles.cardHead}>
          <View style={[styles.swatch, { backgroundColor: swatch }]} />
          <Text style={[styles.cardName, { color: color.text }]} numberOfLines={1}>
            {name}
          </Text>
          <PeriodIcon period={period} color={color.textDim} />
        </View>
        <Text style={[styles.cardSub, { color: color.textDim }]} numberOfLines={1}>{subtitle}</Text>
        <View style={styles.badgeRow}>
          {/* The streak's own badge -- color/copy keyed off `streakState`
              rather than `streak > 0` alone, so a live-but-at-risk streak
              reads as urgent (warn) instead of the same steady accent every
              other live streak gets. Ionicons "flame" matches the icon
              language DayCell.tsx's calendar flame badge already uses for
              "streak" elsewhere in this app, rather than inventing a second
              glyph for the same concept. */}
          {streak > 0 ? (
            <View
              style={[
                styles.badge,
                { backgroundColor: withAlpha(streakState === 'atRisk' ? color.warn : color.accent, 0.16) },
              ]}
            >
              <Ionicons
                name="flame"
                size={11}
                color={streakState === 'atRisk' ? color.warn : color.accent}
                style={styles.badgeIcon}
              />
              <Text style={[styles.badgeText, { color: streakState === 'atRisk' ? color.warn : color.accent }]}>
                {streak}x streak{streakState === 'atRisk' ? ' · at risk' : ''}
              </Text>
            </View>
          ) : null}
          {/* "Streak broken" only shows in place of the live-streak badge
              above (streak === 0 here) -- so a goal that once had a run
              still gets an explanatory badge instead of just silently
              showing nothing, distinct from a goal that has never built one
              at all (streakState 'none', no badge). */}
          {streakState === 'broken' ? (
            <View style={[styles.badge, { backgroundColor: withAlpha(color.textDim, 0.16) }]}>
              <Text style={[styles.badgeText, { color: color.textDim }]}>Streak broken</Text>
            </View>
          ) : null}
          {/* Best-streak badge -- shown whenever there IS a best to show,
              even alongside a live streak of the same length (confirms
              "you're at your personal best right now" rather than hiding
              that fact just because it duplicates the live-streak number). */}
          {bestStreak > 0 ? (
            <View style={[styles.badge, { backgroundColor: withAlpha(color.textDim, 0.16) }]}>
              <Feather name="award" size={11} color={color.textDim} style={styles.badgeIcon} />
              <Text style={[styles.badgeText, { color: color.textDim }]}>Best {bestStreak}</Text>
            </View>
          ) : null}
          {!dueToday ? (
            <View style={[styles.badge, { backgroundColor: withAlpha(color.textDim, 0.16) }]}>
              <Text style={[styles.badgeText, { color: color.textDim }]}>Not due today</Text>
            </View>
          ) : !met ? (
            // Suppressed when the streak badge above already reads "at
            // risk" -- that badge already says exactly this, more
            // specifically (naming the streak that's on the line), so
            // showing both would just repeat the same warning twice.
            streakState !== 'atRisk' ? (
              <View style={[styles.badge, { backgroundColor: withAlpha(onPace ? color.accent : color.warn, 0.16) }]}>
                <Text style={[styles.badgeText, { color: onPace ? color.accent : color.warn }]}>
                  {onPace ? 'On pace' : 'Behind pace'}
                </Text>
              </View>
            ) : null
          ) : null}
          {restriction ? (
            <View style={[styles.badge, { backgroundColor: withAlpha(color.textDim, 0.14) }]}>
              <Text style={[styles.badgeText, { color: color.textDim }]}>{restriction}</Text>
            </View>
          ) : null}
        </View>
      </View>
    </AnimatedPressable>
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: 14, padding: 14, flexDirection: 'row', alignItems: 'center', gap: 12 },
  manageBtn: { alignItems: 'center', paddingVertical: 10, borderRadius: 12, borderWidth: 1.5 },
  manageBtnText: { ...typeScale.label },
  ringPercent: { fontSize: 13, fontWeight: '700' },
  cardBody: { flex: 1, gap: 4 },
  cardHead: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  swatch: { width: 10, height: 10, borderRadius: 5 },
  cardName: { fontSize: 15, fontWeight: '600', flex: 1, letterSpacing: typeScale.sectionTitle.letterSpacing, lineHeight: 20 },
  cardSub: { ...typeScale.caption },
  badgeRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 2 },
  badge: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8 },
  badgeIcon: { marginRight: 3 },
  badgeText: { ...typeScale.caption, fontWeight: '700' },
});
