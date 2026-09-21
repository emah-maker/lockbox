// DurationSheet.tsx -- the pre-session duration + tag picker, moved off the
// Home screen's main layout into a Sheet popup (manager brief: the screen
// itself must stay a stable, fixed-height layout with "no meaningful
// vertical scrolling", and this block -- two wheel pickers plus the full
// topic-chip row and free-text input -- was the single biggest source of
// that screen growing/shrinking as it appeared and disappeared with
// connection/session state). DashboardScreen still owns all of the actual
// state (the picked hours/minutes, the box-sync effect, the push-to-box
// effect) -- this component only renders that state inside a Sheet.
//
// Sheet's own body is a vertical ScrollView (src/ui/Sheet.tsx), so nesting
// these vertical WheelPickers inside it recreates the exact "two nested
// vertical scrollers fighting over one drag" bug DashboardScreen's old
// pickerActive/lockOuterScroll/unlockOuterScroll dance existed to prevent --
// flagged to foundation, who added Sheet's `scrollEnabled` prop for exactly
// this. Same fix, new target: disable Sheet's own scroll for the duration of
// a wheel drag instead of the screen's ScrollView. The short safety timer
// mirrors DashboardScreen's old pickerSafetyTimer belt-and-suspenders against
// onDragEnd not firing -- cheap insurance, kept even though WheelPicker's
// own edge-bounce (the original trigger for a stuck onDragEnd) is gone now
// that WheelPicker sets bounces={false}.
import { View, StyleSheet } from 'react-native';
import { Sheet } from '../../ui/Sheet';
import { WheelPicker, useWheelScrollLock } from '../../ui/WheelPicker';
import { TopicPicker } from '../TopicPicker';
import { useSettingsStore } from '../../store/useSettingsStore';

export function DurationSheet({
  visible,
  onClose,
  hourLabels,
  minuteLabels,
  hoursIndex,
  minutesIndex,
  onHoursIndexChange,
  onMinutesIndexChange,
  currentTopic,
  customLabels,
  themeMode,
  onSelectTopic,
}: {
  visible: boolean;
  onClose: () => void;
  hourLabels: string[];
  minuteLabels: string[];
  hoursIndex: number;
  minutesIndex: number;
  onHoursIndexChange: (index: number) => void;
  onMinutesIndexChange: (index: number) => void;
  currentTopic: string | null;
  customLabels: ReturnType<typeof useSettingsStore.getState>['customLabels'];
  themeMode: ReturnType<typeof useSettingsStore.getState>['themeMode'];
  onSelectTopic: (topic: string) => void;
}) {
  // theme / sessions / excludedTopicKeys used to be read here purely to hand
  // to TopicPicker -- the identical three reads TagSheet was also making.
  // TopicPicker reads them itself now; see its own comment.
  // The lock/unlock pair the rest of this app's wheel call sites cite as the
  // reference version -- now the shared hook, so the reference and the copies
  // can't drift. Its backstop window is chosen from the gesture phase: the
  // flat 600ms this file used to arm fired in the middle of any longer drag,
  // handing the sheet's scroll back under a live finger and re-rendering the
  // wheels while they were being dragged. See useWheelScrollLock.
  const { wheelActive, setWheelActive } = useWheelScrollLock();

  return (
    <Sheet
      visible={visible}
      onClose={onClose}
      title="Set lock duration"
      size="auto"
      scrollEnabled={!wheelActive}
      // Wheels in the body -- see Sheet.tsx's dragBodyToDismiss.
      dragBodyToDismiss={false}
    >
      {/* Duration only -- no lock button here. Locking has to happen at the
          box itself (tap LOCK once the phone is physically inside it); this
          just previews/pushes the duration live so the box's own clock
          reflects it -- same behavior as before, just relocated. */}
      {/* The three-way gesture handoff every other wheel row in this app
          already had, and this one -- the lock-duration picker, i.e. the
          control in every "the timer screen froze" report -- did not.
          Without the touch-phase claim the lock is only taken at
          onDragStart, which is AFTER the wheel's ScrollView has won the
          gesture, so `scrollEnabled={!wheelActive}` reaches the Sheet body
          a render too late and its ScrollView is still live for the frame
          the touch lands on -- two vertical scrollers pulling on one drag.
          dragBodyToDismiss={false} above blocks the body's capture-phase
          dismiss, but not the body ScrollView's own pan. onTouchEnd/-Cancel
          release a touch that never became a drag; a touch that DID is
          released by the wheel's own onDragEnd. See ClockWheels.tsx, which
          carries the same block. */}
      <View
        style={styles.pickerRow}
        onTouchStart={() => setWheelActive(true, 'touch')}
        onTouchEnd={() => setWheelActive(false)}
        onTouchCancel={() => setWheelActive(false)}
      >
        <WheelPicker
          labels={hourLabels}
          selectedIndex={hoursIndex}
          onChange={onHoursIndexChange}
          onDragStart={() => setWheelActive(true, 'drag')}
          onDragEnd={() => setWheelActive(false)}
          accessibilityLabel="Lock duration, hours"
        />
        <WheelPicker
          labels={minuteLabels}
          selectedIndex={minutesIndex}
          onChange={onMinutesIndexChange}
          onDragStart={() => setWheelActive(true, 'drag')}
          onDragEnd={() => setWheelActive(false)}
          accessibilityLabel="Lock duration, minutes"
        />
      </View>
      <TopicPicker
        heading="Tag this session before you lock it"
        currentTopic={currentTopic}
        customLabels={customLabels}
        themeMode={themeMode}
        onSelect={onSelectTopic}
      />
    </Sheet>
  );
}

const styles = StyleSheet.create({
  pickerRow: { flexDirection: 'row', gap: 16, justifyContent: 'center' },
});
