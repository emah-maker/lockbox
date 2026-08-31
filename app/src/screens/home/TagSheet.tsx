// TagSheet.tsx -- the in-session "what are you focusing on" tagger, moved
// off the Home screen's main layout into a Sheet the same way DurationSheet
// moved the pre-session picker (see that file's header for why: keeping the
// Home screen a fixed-height layout). Opened from FocusHero's topic pill
// while a session is running; DashboardScreen owns visibility and the
// tagCurrentSession call itself, this just renders TopicPicker inside a
// Sheet and closes itself once a tag is actually chosen.
import React from 'react';
import { Sheet } from '../../ui/Sheet';
import { TopicPicker } from '../TopicPicker';
import { useTheme } from '../../theme/useTheme';
import { useSettingsStore } from '../../store/useSettingsStore';
import { useStore } from '../../store/useStore';

export function TagSheet({
  visible,
  onClose,
  currentTopic,
  customLabels,
  themeMode,
  onSelect,
}: {
  visible: boolean;
  onClose: () => void;
  currentTopic: string | null;
  customLabels: ReturnType<typeof useSettingsStore.getState>['customLabels'];
  themeMode: ReturnType<typeof useSettingsStore.getState>['themeMode'];
  onSelect: (topic: string) => void;
}) {
  const theme = useTheme();
  // Read here rather than threaded through DashboardScreen: the session log
  // is only used to rank TopicPicker's "Recent" row, which is that
  // component's own concern, and this sheet already self-supplies `theme`
  // the same way. excludedTopicKeys is read the identical way, for the
  // identical reason -- TopicPicker's own excluded-marker affordance is its
  // concern, not DashboardScreen's.
  const sessions = useStore((s) => s.sessions);
  const excludedTopicKeys = useSettingsStore((s) => s.excludedTopicKeys);
  return (
    <Sheet visible={visible} onClose={onClose} title="Session topic" size="auto">
      <TopicPicker
        heading="What are you focusing on?"
        currentTopic={currentTopic}
        customLabels={customLabels}
        excludedTopicKeys={excludedTopicKeys}
        themeMode={themeMode}
        theme={theme}
        sessions={sessions}
        onSelect={(topic) => {
          onSelect(topic);
          onClose(); // picking a tag is the sheet's whole purpose -- close it immediately rather than making the user dismiss separately
        }}
      />
    </Sheet>
  );
}
