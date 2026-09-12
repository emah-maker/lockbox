// PlannedSessions.tsx -- the "Planned" block inside DaySheet: the sessions
// you've scheduled for that day, plus the entry point to add one. Split out
// of DaySheet.tsx (which already owns that day's logged sessions, topic
// breakdown and goal status) to keep both files under this project's
// 500-line guideline, the same seam GoalRow.tsx was split from
// GoalsSection.tsx along.
//
// Reads and writes useScheduleStore directly rather than taking the plans
// and four callbacks as props from CalendarScreen. Nothing above this in the
// tree has any use for them -- CalendarScreen reads the store on its own
// account, but only to mark which day cells have plans, which is a different
// question from this list -- and threading a whole CRUD surface through two
// components to reach the one place that uses it is exactly what
// GoalsSection.tsx avoids by reading useGoalsStore itself.
//
// A plan is never a logged session: it renders in its own block, above the
// day's real sessions, and nothing here ever writes to sessionHistory. See
// schedule/scheduledSessions.ts's header for why that separation is
// load-bearing rather than cosmetic.
import React from 'react';
import { View, Text, StyleSheet, Alert } from 'react-native';
import Feather from '@expo/vector-icons/Feather';
import { AnimatedPressable } from '../../ui/AnimatedPressable';
import { SessionReminderForm, leadLabel } from './SessionReminderForm';
import { useScheduleStore } from '../../store/useScheduleStore';
import { useSettingsStore } from '../../store/useSettingsStore';
import { ThemeColors } from '../../theme/theme';
import { withAlpha } from '../../theme/color';
import { hitSlop, spacing, typeScale } from '../../theme/tokens';
import { formatDuration } from '../../stats/stats';
import { formatClockTime } from '../../ui/time';
import { resolveTopic, CustomLabel } from '../../stats/customLabels';
import { sessionsOnDay, ScheduledSession, ScheduledSessionInput } from '../../schedule/scheduledSessions';

export function PlannedSessions({
  dateKey,
  theme,
  customLabels,
  themeMode,
}: {
  dateKey: string;
  theme: ThemeColors;
  customLabels: CustomLabel[];
  themeMode: 'dark' | 'light';
}) {
  const scheduled = useScheduleStore((s) => s.scheduled);
  const addScheduledSession = useScheduleStore((s) => s.addScheduledSession);
  const editScheduledSession = useScheduleStore((s) => s.editScheduledSession);
  const removeScheduledSession = useScheduleStore((s) => s.removeScheduledSession);
  const setDone = useScheduleStore((s) => s.setDone);
  const notificationsEnabled = useSettingsStore((s) => s.notificationsEnabled);

  // One sheet, two modes: `editingId === null` while open means "creating".
  // Same shape (and same `formSeq` remount guard) GoalsSection.tsx uses --
  // ui/Sheet.tsx passes `children` to its <Modal> unconditionally, so the
  // form's mount-time useState seeds survive an open/close cycle unless the
  // key changes. Without the sequence, two consecutive NEW plans would both
  // key to 'new' and the second would open showing the first's values.
  const [formOpen, setFormOpen] = React.useState(false);
  const [editingId, setEditingId] = React.useState<string | null>(null);
  const [formSeq, setFormSeq] = React.useState(0);
  const [error, setError] = React.useState<string | null>(null);

  const plans = React.useMemo(() => sessionsOnDay(scheduled, dateKey), [scheduled, dateKey]);
  const editing = editingId !== null ? plans.find((p) => p.id === editingId) ?? null : null;

  const openForm = (id: string | null) => {
    setError(null);
    setEditingId(id);
    setFormSeq((n) => n + 1);
    setFormOpen(true);
  };
  const closeForm = () => {
    setError(null);
    setFormOpen(false);
  };

  const handleSubmit = (input: ScheduledSessionInput) => {
    try {
      // Invalid input surfaces as the thrown Error's own `message`, rendered
      // inline by the form -- no validation is duplicated here, exactly the
      // discipline GoalsSection.tsx's header describes for goals.
      if (editing) editScheduledSession(editing.id, input);
      else addScheduledSession(input);
      closeForm();
    } catch (e: any) {
      setError(e?.message ?? 'Could not save that session.');
    }
  };

  const handleDelete = (plan: ScheduledSession) => {
    // Confirm-then-act, same shape as GoalsSection's own delete, and the
    // copy says what actually happens -- a plan carries a pending OS
    // notification, so "the reminder is cancelled" is the part worth stating.
    Alert.alert(
      'Delete this planned session?',
      `Your ${formatClockTime(plan.time)} session and its reminder will be removed. Logged sessions are not affected.`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Delete', style: 'destructive', onPress: () => removeScheduledSession(plan.id) },
      ],
    );
  };

  return (
    <View style={[styles.section, { borderTopColor: withAlpha(theme.textDim, 0.25) }]}>
      <View style={styles.headerRow}>
        <Text style={[styles.heading, { color: theme.textDim }]}>Planned</Text>
        <AnimatedPressable
          onPress={() => openForm(null)}
          accessibilityRole="button"
          accessibilityLabel="Schedule a focus session on this day"
          hitSlop={hitSlop.text}
          style={styles.addLink}
        >
          <Feather name="plus" size={14} color={theme.accent} />
          <Text style={[styles.addLinkText, { color: theme.accent }]}>Schedule</Text>
        </AnimatedPressable>
      </View>

      {plans.length === 0 ? (
        <Text style={[styles.empty, { color: theme.textDim }]}>
          Nothing planned. Schedule a session and get a reminder before it starts.
        </Text>
      ) : (
        plans.map((plan) => {
          const resolved = plan.topic ? resolveTopic(plan.topic, customLabels, themeMode) : null;
          const done = !!plan.done;
          return (
            <View key={plan.id} style={styles.row}>
              <AnimatedPressable
                onPress={() => setDone(plan.id, !done)}
                accessibilityRole="checkbox"
                accessibilityState={{ checked: done }}
                accessibilityLabel={`${formatClockTime(plan.time)} session, ${done ? 'done' : 'not done'}`}
                hitSlop={hitSlop.glyph}
              >
                <Feather
                  name={done ? 'check-circle' : 'circle'}
                  size={18}
                  color={done ? theme.success : theme.textDim}
                />
              </AnimatedPressable>

              <AnimatedPressable
                onPress={() => openForm(plan.id)}
                accessibilityRole="button"
                accessibilityLabel={`Edit the ${formatClockTime(plan.time)} planned session`}
                style={styles.rowBody}
              >
                <View style={styles.rowTop}>
                  <Text
                    style={[
                      styles.time,
                      { color: done ? theme.textDim : theme.text },
                      done && styles.struck,
                    ]}
                  >
                    {formatClockTime(plan.time)}
                  </Text>
                  {plan.plannedS ? (
                    <Text style={[styles.meta, { color: theme.textDim }]}>{formatDuration(plan.plannedS)}</Text>
                  ) : null}
                  {resolved ? (
                    <>
                      <View style={[styles.dot, { backgroundColor: resolved.color }]} />
                      <Text style={[styles.meta, { color: theme.textDim }]} numberOfLines={1}>
                        {resolved.label}
                      </Text>
                    </>
                  ) : null}
                </View>
                {plan.note ? (
                  <Text style={[styles.note, { color: theme.textDim }]} numberOfLines={1}>
                    {plan.note}
                  </Text>
                ) : null}
                {/* Says what will actually happen, and says it honestly: a
                    done plan and a plan whose reminder can't fire (master
                    switch off) both report that rather than showing a lead
                    time that no longer means anything. */}
                <Text style={[styles.meta, { color: theme.textDim }]}>
                  {done
                    ? 'Done'
                    : !notificationsEnabled
                      ? 'Reminders are off in Settings'
                      : leadLabel(plan.leadMinutes)}
                </Text>
              </AnimatedPressable>

              <AnimatedPressable
                onPress={() => handleDelete(plan)}
                accessibilityRole="button"
                accessibilityLabel={`Delete the ${formatClockTime(plan.time)} planned session`}
                hitSlop={hitSlop.text}
              >
                <Feather name="trash-2" size={16} color={theme.textDim} />
              </AnimatedPressable>
            </View>
          );
        })
      )}

      {/* The form's own sheet renders `error` inline; this only ever covers
          an error raised with no form open (none today, but the delete path
          would land here if it ever grew one). */}
      {error && !formOpen ? <Text style={[styles.empty, { color: theme.danger }]}>{error}</Text> : null}

      <SessionReminderForm
        key={`${editing?.id ?? 'new'}-${formSeq}`}
        visible={formOpen}
        onClose={closeForm}
        dateKey={dateKey}
        initial={editing ?? undefined}
        error={error}
        onSubmit={handleSubmit}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  section: { borderTopWidth: StyleSheet.hairlineWidth, paddingTop: spacing.sm, gap: 6 },
  headerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  heading: { ...typeScale.label },
  addLink: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  addLinkText: { ...typeScale.label },
  empty: { ...typeScale.caption, fontWeight: '400' },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: 6 },
  rowBody: { flex: 1, gap: 2 },
  rowTop: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  time: { ...typeScale.body, fontWeight: '600' },
  struck: { textDecorationLine: 'line-through' },
  meta: { ...typeScale.caption, fontWeight: '400' },
  note: { ...typeScale.caption, fontWeight: '400' },
  dot: { width: 8, height: 8, borderRadius: 4 },
});
