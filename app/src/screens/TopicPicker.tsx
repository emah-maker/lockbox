// TopicPicker.tsx -- split out of DashboardScreen.tsx (which was pushing
// past this project's 500-line file guideline) the same way
// OverridePressSection.tsx/CustomLabelsSection.tsx already sit beside
// SettingsScreen.tsx for their own feature areas. Shared by DashboardScreen's
// pre-session picker and its in-session chip row so both tagging moments
// render identically and stay backed by the same custom-label catalog.
//
// Two things make tagging faster here, both aimed at the same problem -- the
// full catalog is a flat wall of chips that looks identical every time, so
// finding the two or three labels you actually use is work:
//
//   1. A "Recent" row of the labels this user actually reaches for
//      (stats/recentTopics.ts's recency-weighted ranking), above the full
//      catalog and excluded from it so nothing appears twice. Optional --
//      a caller that passes no `sessions` gets exactly the old flat row.
//   2. A typed label can be SAVED as a real custom label right here, rather
//      than only ever being a one-time tag. Creating a label previously
//      meant leaving whatever you were doing, going to Settings > Custom
//      labels, and coming back -- at which point the session you wanted to
//      tag has usually moved on.
//
// The one-time tag itself is unchanged: still local to this render, still
// never added to useSettingsStore.customLabels, still passed straight to
// onSelect as a raw string (resolveTopic falls back to rendering it).
import React from 'react';
import { View, Text, StyleSheet, TextInput } from 'react-native';
import { useTheme } from '../theme/useTheme';
import { useSettingsStore } from '../store/useSettingsStore';
import { useStore } from '../store/useStore';
import { allLabelChoices, resolveTopic, MAX_TOPIC_LENGTH, LABEL_SWATCHES } from '../stats/customLabels';
import { topRecentTopics } from '../stats/recentTopics';
import { AnimatedPressable } from '../ui/AnimatedPressable';
import { typeScale } from '../theme/tokens';

// Four fits one row on a narrow phone without wrapping, and is about as many
// suggestions as anyone scans before giving up and reading the full list --
// past that the "recent" row stops being a shortcut and becomes a second
// catalog.
const MAX_RECENT = 4;

// Appended to a chip's own label text for a label with excludeFromTotals set
// (stats/customLabels.ts) -- a thin space + asterisk rather than a second
// line or an icon, so every chip keeps its existing single-line height and
// the flex-wrap row layout above doesn't need to change at all. The
// TOPIC_LEGEND caption below is what tells a user what the asterisk means.
const EXCLUDED_MARKER = ' *';

export function TopicPicker({
  heading,
  currentTopic,
  customLabels,
  themeMode,
  onSelect,
}: {
  heading: string;
  currentTopic: string | null;
  customLabels: ReturnType<typeof useSettingsStore.getState>['customLabels'];
  themeMode: ReturnType<typeof useSettingsStore.getState>['themeMode'];
  onSelect: (topic: string) => void;
}) {
  const addCustomLabel = useSettingsStore((s) => s.addCustomLabel);
  // Read here rather than taken as props. Both callers -- home/TagSheet.tsx
  // and home/DurationSheet.tsx -- were making these same three reads and
  // handing the results straight down, so the plumbing existed twice to
  // deliver values only this component uses. TagSheet's own comment already
  // made the argument for it: the "Recent" row's ranking and the excluded-
  // topic marker are this component's concerns, not its caller's, and it
  // already self-supplied `theme` the same way one level up.
  //
  // `customLabels`/`themeMode` stay props: DashboardScreen owns those two for
  // the whole Home screen and passes them through both sheets to here, so
  // reading them again would be a second subscription to state the parent is
  // already tracking, not the removal of a duplicate.
  const theme = useTheme();
  const sessions = useStore((s) => s.sessions);
  const excludedTopicKeys = useSettingsStore((s) => s.excludedTopicKeys);

  // Local to this render of the picker, not persisted -- a true one-time
  // tag (manager brief), never added to useSettingsStore.customLabels, so it
  // never appears in CustomLabelsSection or comes back as a chip later.
  const [draft, setDraft] = React.useState('');
  // Non-null while the "save this as a label" swatch row is open, holding
  // the color picked so far. Separate from `draft` so dismissing the swatch
  // row leaves what you typed intact and still taggable one-time.
  const [savingColor, setSavingColor] = React.useState<string | null>(null);
  const [saveError, setSaveError] = React.useState<string | null>(null);

  const choices = allLabelChoices(customLabels, themeMode, excludedTopicKeys);

  // Ranked over the full catalog, then resolved for display. `isRenderable`
  // is what drops a since-deleted custom label's id -- recentTopics.ts
  // deliberately doesn't know how to make that call itself (see its header).
  const recent = React.useMemo(() => {
    if (!sessions || sessions.length === 0) return [];
    const ids = topRecentTopics(sessions, MAX_RECENT, (t) => !!resolveTopic(t, customLabels, themeMode));
    return ids
      .map((id) => ({ id, resolved: resolveTopic(id, customLabels, themeMode, excludedTopicKeys)! }))
      .filter((r) => !!r.resolved);
  }, [sessions, customLabels, themeMode, excludedTopicKeys]);

  const recentIds = React.useMemo(() => new Set(recent.map((r) => r.id)), [recent]);

  // Whether the legend line below the chip rows is worth showing at all --
  // most users have no excluded label, and a caption explaining a marker
  // that appears nowhere on screen would just be confusing clutter.
  const anyExcluded = choices.some((c) => c.excludedFromTotals) || recent.some((r) => r.resolved.excludedFromTotals);

  const trimmed = draft.trim();

  const commitTag = () => {
    if (!trimmed) return;
    onSelect(trimmed);
    setDraft('');
    setSavingColor(null);
    setSaveError(null);
  };

  /** Creates a real custom label from what's typed, then tags with it. The
   * store's addCustomLabel returns nothing, so the new label is read back
   * off the freshly-updated catalog -- createCustomLabel appends, so it's
   * the last entry. Reading it back (rather than assuming an id) is what
   * lets this select the label it just made instead of leaving the session
   * tagged with the raw typed string. */
  const saveAsLabel = (color: string) => {
    try {
      addCustomLabel(trimmed, color);
    } catch (e: unknown) {
      // createCustomLabel throws a caller-renderable message (the catalog
      // cap, an over-long name) -- shown inline, same convention
      // CustomLabelsSection.tsx uses for the identical call.
      setSaveError(e instanceof Error ? e.message : 'Could not save that label.');
      return;
    }
    const created = useSettingsStore.getState().customLabels.at(-1);
    setDraft('');
    setSavingColor(null);
    setSaveError(null);
    if (created) onSelect(created.id);
  };

  return (
    <View style={{ marginTop: 8 }}>
      <Text style={[styles.label, { color: theme.textDim }]}>
        {currentTopic
          ? `Tagged: ${resolveTopic(currentTopic, customLabels, themeMode)?.label ?? currentTopic}`
          : heading}
      </Text>

      {recent.length > 0 ? (
        <>
          <Text style={[styles.sectionLabel, { color: theme.textDim }]}>Recent</Text>
          <View style={styles.topicChipRow}>
            {recent.map(({ id, resolved }) => {
              const active = currentTopic === id;
              return (
                <AnimatedPressable
                  key={`recent:${id}`}
                  style={[styles.topicChip, { borderColor: resolved.color }, active && { backgroundColor: resolved.color }]}
                  onPress={() => onSelect(id)}
                  accessibilityRole="button"
                  accessibilityState={{ selected: active }}
                  accessibilityLabel={
                    resolved.excludedFromTotals
                      ? `${resolved.label}, recently used, doesn't count toward totals`
                      : `${resolved.label}, recently used`
                  }
                >
                  <Text style={[styles.topicChipText, { color: active ? resolved.textColor : theme.text }]}>
                    {resolved.label}
                    {resolved.excludedFromTotals ? EXCLUDED_MARKER : ''}
                  </Text>
                </AnimatedPressable>
              );
            })}
          </View>
          <Text style={[styles.sectionLabel, { color: theme.textDim }]}>All labels</Text>
        </>
      ) : null}

      <View style={styles.topicChipRow}>
        {choices
          // A chip already shown in "Recent" above is skipped here rather
          // than rendered twice -- two identical chips a few rows apart
          // reads as a bug, and the recent row is strictly a subset.
          .filter((choice) => !recentIds.has(choice.id))
          .map((choice) => {
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
                accessibilityRole="button"
                accessibilityState={{ selected: active }}
                accessibilityLabel={choice.excludedFromTotals ? `${choice.label}, doesn't count toward totals` : undefined}
              >
                <Text style={[styles.topicChipText, { color: active ? choice.textColor : theme.text }]}>
                  {choice.label}
                  {choice.excludedFromTotals ? EXCLUDED_MARKER : ''}
                </Text>
              </AnimatedPressable>
            );
          })}
      </View>

      {anyExcluded ? (
        <Text style={[styles.sectionLabel, { color: theme.textDim, marginTop: 4 }]}>
          * doesn't count toward totals, goals, streaks, or the calendar heat map
        </Text>
      ) : null}

      <View style={styles.tagOnceRow}>
        <TextInput
          value={draft}
          onChangeText={(t) => {
            setDraft(t);
            setSaveError(null);
          }}
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
          disabled={!trimmed}
          accessibilityRole="button"
          accessibilityLabel="Tag session with typed label"
          style={[styles.tagOnceBtn, { backgroundColor: theme.accent, opacity: trimmed ? 1 : 0.5 }]}
        >
          <Text style={{ color: theme.accentText, fontWeight: '700' }}>Tag</Text>
        </AnimatedPressable>
      </View>

      {trimmed ? (
        savingColor === null ? (
          <AnimatedPressable
            onPress={() => setSavingColor(LABEL_SWATCHES[0])}
            accessibilityRole="button"
            accessibilityLabel={`Save "${trimmed}" as a reusable label`}
            style={styles.saveLink}
          >
            <Text style={[styles.saveLinkText, { color: theme.accent }]}>+ Save "{trimmed}" as a label</Text>
          </AnimatedPressable>
        ) : (
          <View style={styles.saveRow}>
            {/* Tapping a swatch both picks the color and commits -- a
                separate confirm step for a two-field creation (name already
                typed, color the only thing left) is one tap of pure
                ceremony. Settings > Custom labels remains the place to
                rename or recolor afterwards. */}
            <Text style={[styles.sectionLabel, { color: theme.textDim }]}>Pick a color to save it</Text>
            <View style={styles.swatchRow}>
              {LABEL_SWATCHES.map((color) => (
                // The colour IS this button's content -- no text, no shape
                // of its own -- so an identical label on all twelve (which
                // is what `Save with this color` was) leaves a VoiceOver
                // user a row of indistinguishable buttons, each of which
                // commits the save immediately. `Color ${hex}` is the
                // wording Settings > Custom labels' own swatch row
                // (CustomLabelsSection's ColorSwatchRow) already uses for
                // this same palette; the shared action moves to a hint,
                // where iOS expects "what happens" as opposed to "what
                // this is", instead of being repeated twelve times.
                <AnimatedPressable
                  key={color}
                  onPress={() => saveAsLabel(color)}
                  accessibilityRole="button"
                  accessibilityLabel={`Color ${color}`}
                  accessibilityHint={`Saves "${trimmed}" as a label in this color`}
                  style={[styles.swatch, { backgroundColor: color }]}
                />
              ))}
            </View>
            <AnimatedPressable
              onPress={() => setSavingColor(null)}
              accessibilityRole="button"
              accessibilityLabel="Cancel saving this label"
            >
              <Text style={[styles.saveLinkText, { color: theme.textDim }]}>Cancel</Text>
            </AnimatedPressable>
          </View>
        )
      ) : null}

      {saveError ? <Text style={[styles.errorText, { color: theme.danger }]}>{saveError}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  // Color applied at use-site (theme.textDim) -- same typeScale.label base
  // DashboardScreen's own `label` style uses, kept local rather than
  // threading the parent's `s` styles object through as a prop, now that
  // this component owns its full render.
  label: { ...typeScale.label },
  sectionLabel: { ...typeScale.caption, marginTop: 10 },
  topicChipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 8 },
  topicChip: { paddingVertical: 6, paddingHorizontal: 12, borderRadius: 16, borderWidth: 1.5 },
  topicChipText: { ...typeScale.label },
  tagOnceRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 8 },
  tagOnceInput: { flex: 1, borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 8, fontSize: 14 },
  tagOnceBtn: { paddingVertical: 8, paddingHorizontal: 16, borderRadius: 10 },
  saveLink: { marginTop: 8 },
  saveLinkText: { ...typeScale.label, fontWeight: '600' },
  saveRow: { marginTop: 4, gap: 4 },
  swatchRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 6 },
  swatch: { width: 28, height: 28, borderRadius: 14 },
  errorText: { ...typeScale.caption, marginTop: 6 },
});
