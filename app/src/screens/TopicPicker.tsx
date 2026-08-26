// TopicPicker.tsx -- split out of DashboardScreen.tsx (which was pushing
// past this project's 500-line file guideline) the same way
// OverridePressSection.tsx/CustomLabelsSection.tsx already sit beside
// SettingsScreen.tsx for their own feature areas. Shared by DashboardScreen's
// pre-session picker and its in-session chip row so both tagging moments
// render identically and stay backed by the same custom-label catalog.
import React from 'react';
import { View, Text, StyleSheet, TextInput } from 'react-native';
import { useTheme } from '../theme/useTheme';
import { useSettingsStore } from '../store/useSettingsStore';
import { allLabelChoices, resolveTopic, MAX_TOPIC_LENGTH } from '../stats/customLabels';
import { AnimatedPressable } from '../ui/AnimatedPressable';
import { typeScale } from '../theme/tokens';

export function TopicPicker({
  heading,
  currentTopic,
  customLabels,
  themeMode,
  theme,
  onSelect,
}: {
  heading: string;
  currentTopic: string | null;
  customLabels: ReturnType<typeof useSettingsStore.getState>['customLabels'];
  themeMode: ReturnType<typeof useSettingsStore.getState>['themeMode'];
  theme: ReturnType<typeof useTheme>;
  onSelect: (topic: string) => void;
}) {
  // Local to this render of the picker, not persisted -- a true one-time
  // tag (manager brief), never added to useSettingsStore.customLabels, so it
  // never appears in CustomLabelsSection or comes back as a chip later. The
  // typed string is passed straight to onSelect/tagCurrentSession, same as
  // tapping a built-in/custom chip -- resolveTopic (stats/customLabels.ts)
  // now falls back to rendering that raw string wherever a session's topic
  // is shown, instead of treating it as unresolvable.
  const [draft, setDraft] = React.useState('');
  const commitTag = () => {
    const trimmed = draft.trim();
    if (!trimmed) return;
    onSelect(trimmed);
    setDraft('');
  };
  return (
    <View style={{ marginTop: 8 }}>
      <Text style={[styles.label, { color: theme.textDim }]}>
        {currentTopic
          ? `Tagged: ${resolveTopic(currentTopic, customLabels, themeMode)?.label ?? currentTopic}`
          : heading}
      </Text>
      <View style={styles.topicChipRow}>
        {allLabelChoices(customLabels, themeMode).map((choice) => {
          const active = currentTopic === choice.id;
          return (
            <AnimatedPressable
              key={choice.id}
              style={[
                styles.topicChip,
                { borderColor: choice.color },
                active && { backgroundColor: choice.color },
              ]}
              onPress={() => onSelect(choice.id)}
            >
              <Text style={[styles.topicChipText, { color: active ? choice.textColor : theme.text }]}>
                {choice.label}
              </Text>
            </AnimatedPressable>
          );
        })}
      </View>
      <View style={styles.tagOnceRow}>
        <TextInput
          value={draft}
          onChangeText={setDraft}
          placeholder="Type a label for this session..."
          placeholderTextColor={theme.textDim}
          onSubmitEditing={commitTag}
          returnKeyType="done"
          maxLength={MAX_TOPIC_LENGTH}
          accessibilityLabel="Type a one-time label for this session"
          style={[styles.tagOnceInput, { color: theme.text, borderColor: theme.textDim }]}
        />
        <AnimatedPressable
          onPress={commitTag}
          disabled={!draft.trim()}
          accessibilityRole="button"
          accessibilityLabel="Tag session with typed label"
          style={[styles.tagOnceBtn, { backgroundColor: theme.accent, opacity: draft.trim() ? 1 : 0.5 }]}
        >
          <Text style={{ color: theme.accentText, fontWeight: '700' }}>Tag</Text>
        </AnimatedPressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  // Color applied at use-site (theme.textDim) -- same typeScale.label base
  // DashboardScreen's own `label` style uses, kept local rather than
  // threading the parent's `s` styles object through as a prop, now that
  // this component owns its full render.
  label: { ...typeScale.label },
  topicChipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 8 },
  topicChip: { paddingVertical: 6, paddingHorizontal: 12, borderRadius: 16, borderWidth: 1.5 },
  topicChipText: { ...typeScale.label },
  tagOnceRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 8 },
  tagOnceInput: { flex: 1, borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 8, fontSize: 14 },
  tagOnceBtn: { paddingVertical: 8, paddingHorizontal: 16, borderRadius: 10 },
});
