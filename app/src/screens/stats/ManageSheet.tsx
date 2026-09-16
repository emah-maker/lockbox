// ManageSheet.tsx -- the write-capable goal editor (GoalsSection's
// add/edit/delete forms) that used to sit permanently at the bottom of
// StatsScreen's long scroll. Moved into a Sheet so the main Stats body stays
// a fixed, mostly-one-screen view (this task's "stop the screen growing
// vertically" requirement).
//
// `initialCreate` (bug fix): StatsScreen sets this when this Sheet is opened
// via GoalsProgressView's empty-state "Start adding goals" CTA specifically,
// as opposed to the ordinary "Manage goals" button -- see
// StatsScreen.tsx's manageSheetAutoCreate comment for the double-empty-state
// dead end this fixes. Threaded straight through to GoalsSection's own
// `autoOpenCreate`, which is the thing that actually opens GoalForm.
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
import { View } from 'react-native';
import { useTheme } from '../../theme/useTheme';
import { GoalsSection } from '../GoalsSection';
import { WheelLockPhase } from '../../ui/WheelPicker';

// No ScrollView here -- ui/Sheet.tsx's own body already scrolls (see its
// header comment: "the sheet never grows the underlying screen"), and
// nesting a second same-axis ScrollView inside it is the classic RN
// broken-scroll trap (WheelPicker/DashboardScreen's own comments elsewhere
// in this app describe the identical hazard for two competing gesture
// owners), so this just wraps the section in a plain View.
export function ManageSheet({
  color,
  onWheelActiveChange,
  initialCreate,
}: {
  color: ReturnType<typeof useTheme>;
  onWheelActiveChange: (active: boolean, phase?: WheelLockPhase) => void;
  /** See this file's header -- forwarded verbatim to GoalsSection's own
   * `autoOpenCreate`. */
  initialCreate?: boolean;
}) {
  return (
    <View>
      <GoalsSection color={color} onWheelActiveChange={onWheelActiveChange} autoOpenCreate={initialCreate} />
    </View>
  );
}
