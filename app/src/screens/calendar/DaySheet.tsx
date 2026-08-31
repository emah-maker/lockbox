// DaySheet.tsx -- one day's detail, presented in a `Sheet` instead of an
// inline panel that grows/shrinks the screen (manager brief: this app's
// screens should not "expand up and down" -- the month grid stays a stable,
// fixed-height view; tapping a day opens this instead of pushing content).
// Owns: the day's session list + retag entry point, its topic breakdown
// (each row a link out to Stats filtered to that topic), its goal status
// (each met goal a link out to Stats' goals view), and a "See trends" link
// to Stats' month view, and -- since this sheet is now also where you plan
// ahead, not only where you look back -- the day's PLANNED sessions, which
// live in their own component (PlannedSessions.tsx) for the same 500-line
// reason the rest of this screen is split up. Everything here reads goal
// state through
// goalProgress.ts's types/useGoalsStore's Goal shape -- no goal math is
// reimplemented (that lives in monthGrid.ts's goalsMetOnDay, a thin wrapper
// around goalProgress.ts's computeGoalProgress).
import React, { useState } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { Sheet } from '../../ui/Sheet';
import { AnimatedPressable } from '../../ui/AnimatedPressable';
import { LabelPickerSheet } from '../../ui/calendar/LabelPickerSheet';
import { PlannedSessions } from './PlannedSessions';
import { ThemeColors } from '../../theme/theme';
import { withAlpha } from '../../theme/color';
import { hitSlop, typeScale } from '../../theme/tokens';
import { formatDuration } from '../../stats/stats';
import { dayKeyToDate, LoggedSession } from '../../stats/sessionHistory';
import { allLabelChoices, resolveTopic, topicBreakdownWithCustom, CustomLabel } from '../../stats/customLabels';
import { GoalProgressResult } from '../../goals/goalProgress';
import type { Goal } from '../../goals/goals';
import { useNav } from '../../nav/useNav';

export function DaySheet({
  visible,
  onClose,
  dateKey,
  sessions,
  goalsMet,
  goals,
  theme,
  customLabels,
  excludedTopicKeys,
  themeMode,
  onRetag,
}: {
  visible: boolean;
  onClose: () => void;
  dateKey: string;
  sessions: LoggedSession[];
  goalsMet: GoalProgressResult[];
  goals: Goal[];
  theme: ThemeColors;
  customLabels: CustomLabel[];
  /** Built-in topics excluded from totals/goals/streaks (stats/
   * customLabels.ts) -- forwarded to allLabelChoices below so the retag
   * picker's "Not counted" tag (LabelPickerSheet.tsx) shows for an excluded
   * built-in the same way it already does for an excluded custom label. */
  excludedTopicKeys?: string[];
  themeMode: 'dark' | 'light';
  onRetag: (target: LoggedSession, topic: string | undefined) => void;
}) {
  const navigate = useNav((s) => s.navigate);
  const [taggingSession, setTaggingSession] = useState<LoggedSession | null>(null);

  const topics = topicBreakdownWithCustom(sessions, customLabels, themeMode);
  const totalFocusS = sessions.reduce((sum, s) => sum + s.actualS, 0);

  const goalsById = new Map(goals.map((g) => [g.id, g]));
  const goalRows = goalsMet.map((g) => {
    const goal = goalsById.get(g.goalId);
    const label = goal?.topic ? resolveTopic(goal.topic, customLabels, themeMode)?.label ?? goal.topic : 'All focus time';
    return { goalId: g.goalId, label };
  });

  return (
    <>
      <Sheet
        visible={visible}
        onClose={onClose}
        title={dayKeyToDate(dateKey).toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' })}
        size="large"
      >
        <View style={styles.summaryRow}>
          <Text style={[styles.totalText, { color: theme.text }]}>
            {totalFocusS > 0 ? formatDuration(totalFocusS) : 'No focus time'}
          </Text>
          <AnimatedPressable
            style={styles.trendsLink}
            accessibilityRole="button"
            accessibilityLabel="See trends for this month"
            hitSlop={hitSlop.text}
            onPress={() => navigate('stats', { statsPeriod: 'month' })}
          >
            <Text style={[styles.trendsLinkText, { color: theme.accent }]}>See trends</Text>
            <Feather name="arrow-up-right" size={14} color={theme.accent} />
          </AnimatedPressable>
        </View>

        {goalRows.length > 0 && (
          <View style={styles.goalRow}>
            {goalRows.map((g) => (
              <AnimatedPressable
                key={g.goalId}
                style={[styles.goalChip, { backgroundColor: withAlpha(theme.success, 0.15), borderColor: theme.success }]}
                accessibilityRole="button"
                accessibilityLabel={`Goal met: ${g.label}. View goal.`}
                onPress={() => navigate('stats', { statsPeriod: 'goals', goalId: g.goalId })}
              >
                <Feather name="check-circle" size={13} color={theme.success} />
                <Text style={[styles.goalChipText, { color: theme.success }]}>{g.label}</Text>
              </AnimatedPressable>
            ))}
          </View>
        )}

        {topics.length > 0 && (
          <View style={styles.topicSection}>
            {topics.map((t) => (
              <AnimatedPressable
                key={t.key}
                style={styles.topicRow}
                accessibilityRole="button"
                accessibilityLabel={`${t.label}, ${formatDuration(t.focusS)}. View in Stats.`}
                onPress={() => navigate('stats', { topic: t.key })}
              >
                <View style={[styles.dotInline, { backgroundColor: t.color }]} />
                <Text style={[styles.topicLabel, { color: theme.text }]}>{t.label}</Text>
                <Text style={[styles.topicValue, { color: theme.textDim }]}>{formatDuration(t.focusS)}</Text>
                <Feather name="chevron-right" size={16} color={theme.textDim} />
              </AnimatedPressable>
            ))}
          </View>
        )}

        {/* Ahead of the logged-session list on purpose: a day you are
            looking at is more often today or a future day than a past one,
            and on those days what you INTEND is the actionable half of this
            sheet. On a past day the block reads as a record of what you had
            planned, which sits naturally above what actually happened. */}
        <PlannedSessions dateKey={dateKey} theme={theme} customLabels={customLabels} themeMode={themeMode} />

        <View style={[styles.sessionSection, { borderTopColor: withAlpha(theme.textDim, 0.25) }]}>
          {sessions.length === 0 ? (
            <Text style={[styles.empty, { color: theme.textDim }]}>No focus sessions logged this day.</Text>
          ) : (
            sessions.map((s) => {
              const resolved = resolveTopic(s.topic, customLabels, themeMode);
              return (
                <View key={`${s.startedAt}:${s.plannedS}`} style={styles.sessionRow}>
                  <Text style={[styles.sessionTime, { color: theme.textDim }]}>
                    {new Date(s.startedAt).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}
                  </Text>
                  <Text style={[styles.sessionDuration, { color: theme.text }]}>{formatDuration(s.actualS)}</Text>
                  <AnimatedPressable
                    style={styles.sessionTopic}
                    onPress={() => setTaggingSession(s)}
                    accessibilityRole="button"
                    accessibilityLabel={resolved ? `Tagged: ${resolved.label}. Tap to change.` : 'Untagged. Tap to tag this session.'}
                    // A 12px caption inside a 6px-padded row -- ~15px tall,
                    // and it is the only way to retag a past session.
                    hitSlop={{ top: 14, bottom: 14, left: 6, right: 6 }}
                  >
                    {resolved ? (
                      <>
                        <View style={[styles.dotInline, { backgroundColor: resolved.color }]} />
                        <Text style={[styles.sessionTopicLabel, { color: theme.textDim }]}>{resolved.label}</Text>
                      </>
                    ) : (
                      <Text style={[styles.sessionTopicLabel, { color: theme.accent }]}>Tag</Text>
                    )}
                  </AnimatedPressable>
                  <Text
                    style={[styles.sessionOutcome, { color: s.outcome === 'completed' ? theme.accent : theme.warn }]}
                  >
                    {s.outcome === 'completed' ? 'Completed' : 'Ended early'}
                  </Text>
                </View>
              );
            })
          )}
        </View>
      </Sheet>

      <LabelPickerSheet
        visible={taggingSession !== null}
        choices={allLabelChoices(customLabels, themeMode, excludedTopicKeys)}
        current={taggingSession ? resolveTopic(taggingSession.topic, customLabels, themeMode)?.id : undefined}
        theme={theme}
        onClose={() => setTaggingSession(null)}
        onPick={(id) => {
          if (taggingSession) onRetag(taggingSession, id);
          setTaggingSession(null);
        }}
        onClear={
          taggingSession?.topic
            ? () => {
                onRetag(taggingSession, undefined);
                setTaggingSession(null);
              }
            : undefined
        }
      />
    </>
  );
}

const styles = StyleSheet.create({
  summaryRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  totalText: { ...typeScale.sectionTitle },
  trendsLink: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  trendsLinkText: { fontSize: 13, fontWeight: '600', letterSpacing: typeScale.label.letterSpacing },
  goalRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 12 },
  goalChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderWidth: 1,
    borderRadius: 14,
    paddingVertical: 6,
    paddingHorizontal: 10,
  },
  goalChipText: { fontSize: 12, fontWeight: '600', letterSpacing: typeScale.caption.letterSpacing },
  topicSection: { marginBottom: 8 },
  topicRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 8 },
  topicLabel: { flex: 1, ...typeScale.body },
  topicValue: { fontSize: 12, letterSpacing: typeScale.caption.letterSpacing },
  // borderTopColor is supplied inline from the theme at the call site -- it
  // was a hardcoded 'rgba(127,127,127,0.25)' picked to be tolerable in both
  // modes, which is the one hardcoded color literal left in this app's
  // screens/ui tree and reads as a foreign grey against either palette.
  sessionSection: { borderTopWidth: StyleSheet.hairlineWidth, paddingTop: 8 },
  empty: { ...typeScale.body },
  sessionRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 6 },
  sessionTime: {
    fontSize: 13,
    width: 80,
    letterSpacing: typeScale.label.letterSpacing,
    lineHeight: typeScale.label.lineHeight,
  },
  sessionDuration: {
    fontSize: 14,
    fontWeight: '600',
    flex: 1,
    textAlign: 'center',
    letterSpacing: typeScale.body.letterSpacing,
    lineHeight: typeScale.body.lineHeight,
  },
  sessionTopic: { flexDirection: 'row', alignItems: 'center', gap: 5, width: 80 },
  dotInline: { width: 8, height: 8, borderRadius: 4 },
  sessionTopicLabel: {
    fontSize: 12,
    letterSpacing: typeScale.caption.letterSpacing,
    lineHeight: typeScale.caption.lineHeight,
  },
  sessionOutcome: {
    fontSize: 12,
    width: 90,
    textAlign: 'right',
    letterSpacing: typeScale.caption.letterSpacing,
    lineHeight: typeScale.caption.lineHeight,
  },
});
