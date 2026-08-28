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
import React, { useEffect, useRef, useState } from 'react';
import { View, StyleSheet } from 'react-native';
import { Sheet } from '../../ui/Sheet';
import { WheelPicker } from '../../ui/WheelPicker';
import { TopicPicker } from '../TopicPicker';
import { useStore } from '../../store/useStore';
import { useTheme } from '../../theme/useTheme';
import { useSettingsStore } from '../../store/useSettingsStore';

// Matches DashboardScreen's old pickerSafetyTimer duration -- no real
// drag+settle takes anywhere near this long, so a stuck flag always means
// the paired re-enable was lost, not a still-legitimate drag.
const SCROLL_LOCK_SAFETY_MS = 600;

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
  const theme = useTheme();
  // Read here rather than threaded through DashboardScreen -- the session
  // log only feeds TopicPicker's "Recent" ranking, which is that
  // component's own concern, and this sheet already self-supplies `theme`.
  const sessions = useStore((s) => s.sessions);
  const [sheetScrollEnabled, setSheetScrollEnabled] = useState(true);
  const safetyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const lockSheetScroll = () => {
    setSheetScrollEnabled(false);
    if (safetyTimer.current) clearTimeout(safetyTimer.current);
    safetyTimer.current = setTimeout(() => setSheetScrollEnabled(true), SCROLL_LOCK_SAFETY_MS);
  };
  const unlockSheetScroll = () => {
    if (safetyTimer.current) {
      clearTimeout(safetyTimer.current);
      safetyTimer.current = null;
    }
    setSheetScrollEnabled(true);
  };
  useEffect(() => () => {
    if (safetyTimer.current) clearTimeout(safetyTimer.current);
  }, []);

  return (
    <Sheet
      visible={visible}
      onClose={onClose}
      title="Set lock duration"
      size="auto"
      scrollEnabled={sheetScrollEnabled}
    >
      {/* Duration only -- no lock button here. Locking has to happen at the
          box itself (tap LOCK once the phone is physically inside it); this
          just previews/pushes the duration live so the box's own clock
          reflects it -- same behavior as before, just relocated. */}
      <View style={styles.pickerRow}>
        <WheelPicker
          labels={hourLabels}
          selectedIndex={hoursIndex}
          onChange={onHoursIndexChange}
          onDragStart={lockSheetScroll}
          onDragEnd={unlockSheetScroll}
          accessibilityLabel="Lock duration, hours"
        />
        <WheelPicker
          labels={minuteLabels}
          selectedIndex={minutesIndex}
          onChange={onMinutesIndexChange}
          onDragStart={lockSheetScroll}
          onDragEnd={unlockSheetScroll}
          accessibilityLabel="Lock duration, minutes"
        />
      </View>
      <TopicPicker
        heading="Tag this session before you lock it"
        currentTopic={currentTopic}
        customLabels={customLabels}
        themeMode={themeMode}
        theme={theme}
        sessions={sessions}
        onSelect={onSelectTopic}
      />
    </Sheet>
  );
}

const styles = StyleSheet.create({
  pickerRow: { flexDirection: 'row', gap: 16, justifyContent: 'center' },
});
