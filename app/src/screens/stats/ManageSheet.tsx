// ManageSheet.tsx -- the write-capable goal editor (GoalsSection's
// add/edit/delete forms) that used to sit permanently at the bottom of
// StatsScreen's long scroll. Moved into a Sheet so the main Stats body stays
// a fixed, mostly-one-screen view (this task's "stop the screen growing
// vertically" requirement) without touching GoalsSection's own file -- it's
// rendered completely unmodified here, same props it always took from
// StatsScreen, just mounted inside a popover instead of inline.
//
// Reached only from the Goals period view's own "Manage goals" affordance,
// deliberately: editing a goal while you're looking at that goal is the one
// place on Stats where inline editing beats a tab jump (it's also the
// empty-state path to creating a first goal). Every other route to goal
// editing -- including GoalsProgressView's per-card tap -- navigates to
// Settings' goals section instead, so this is a contextual shortcut, not a
// second home for goal management.
//
// CustomLabelsSection is intentionally NOT here. Label CRUD lives in
// Settings' own "Custom labels" row now; mounting it on Stats as well would
// mean two equally-canonical places to edit the same catalog, which is the
// clutter this screen's rework was meant to remove.
import React from 'react';
import { View } from 'react-native';
import { useTheme } from '../../theme/useTheme';
import { GoalsSection } from '../GoalsSection';

// No ScrollView here -- ui/Sheet.tsx's own body already scrolls (see its
// header comment: "the sheet never grows the underlying screen"), and
// nesting a second same-axis ScrollView inside it is the classic RN
// broken-scroll trap (WheelPicker/DashboardScreen's own comments elsewhere
// in this app describe the identical hazard for two competing gesture
// owners), so this just wraps the section in a plain View.
export function ManageSheet({
  color,
  onWheelActiveChange,
}: {
  color: ReturnType<typeof useTheme>;
  onWheelActiveChange: (active: boolean) => void;
}) {
  return (
    <View>
      <GoalsSection color={color} onWheelActiveChange={onWheelActiveChange} />
    </View>
  );
}
