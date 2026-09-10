// TagSheet.tsx -- the in-session "what are you focusing on" tagger, moved
// off the Home screen's main layout into a Sheet the same way DurationSheet
// moved the pre-session picker (see that file's header for why: keeping the
// Home screen a fixed-height layout). Opened from FocusHero's topic pill
// while a session is running; DashboardScreen owns visibility and the
// tagCurrentSession call itself, this just renders TopicPicker inside a
// Sheet and closes itself once a tag is actually chosen.
import { Sheet } from '../../ui/Sheet';
import { TopicPicker } from '../TopicPicker';
import { useSettingsStore } from '../../store/useSettingsStore';

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
  // theme / sessions / excludedTopicKeys used to be read here and handed
  // straight to TopicPicker -- the identical three reads DurationSheet was
  // also making. TopicPicker reads them itself now; see its own comment.
  return (
    <Sheet visible={visible} onClose={onClose} title="Session topic" size="auto">
      <TopicPicker
        heading="What are you focusing on?"
        currentTopic={currentTopic}
        customLabels={customLabels}
        themeMode={themeMode}
        onSelect={(topic) => {
          onSelect(topic);
          onClose(); // picking a tag is the sheet's whole purpose -- close it immediately rather than making the user dismiss separately
        }}
      />
    </Sheet>
  );
}
