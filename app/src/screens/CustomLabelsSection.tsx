// CustomLabelsSection.tsx -- the "Custom labels" section of SettingsScreen,
// split into its own file so SettingsScreen.tsx stays under this project's
// 500-line file-size guideline. Custom labels coexist with the six built-in
// topics (stats/topics.ts) -- this section creates/renames/deletes entries
// in useSettingsStore.customLabels, which syncs cross-device the same
// last-write-wins way as the rest of SyncableSettings (see
// useSettingsStore.ts, sync/settingsSyncBridge.ts).
//
// Also owns the six built-in topics' own "counts toward totals" switches
// (BuiltInTopicsSection below) -- deliberately rendered in this same file,
// above the custom-label list, rather than as a separate SettingsScreen
// section: it's the identical user-facing feature (stats/customLabels.ts's
// sessionCountsTowardTotals treats a saved label's excludeFromTotals and a
// built-in's membership in useSettingsStore's excludedTopicKeys exactly the
// same way), just for the catalog that has no per-entry row of its own to
// carry the flag on. A built-in topic can never be renamed or deleted the
// way a custom label can (topics.ts's TOPIC_KEYS is a fixed table), so its
// row is just the swatch/name/switch, none of CustomLabelRow's edit chrome.
import React from 'react';
import { View, Text, StyleSheet, TextInput, Switch, Alert } from 'react-native';
import { useSettingsStore } from '../store/useSettingsStore';
import { useStore } from '../store/useStore';
import { useTheme } from '../theme/useTheme';
import { LABEL_SWATCHES, MAX_LABEL_NAME_LENGTH, CustomLabel } from '../stats/customLabels';
import { TOPIC_KEYS, TOPIC_LABELS, topicColor, TopicKey } from '../stats/topics';
import { Section, Button, rowLabelStyle, captionStyle, textInputStyle } from './SettingsPrimitives';
import { AnimatedPressable } from '../ui/AnimatedPressable';
import { useReducedMotion, configureLayoutAnimation } from '../ui/useReducedMotion';
import { hitSlop, typeScale } from '../theme/tokens';

export function CustomLabelsSection({ color }: { color: ReturnType<typeof useTheme> }) {
  const customLabels = useSettingsStore((s) => s.customLabels);
  const addCustomLabel = useSettingsStore((s) => s.addCustomLabel);
  const renameCustomLabel = useSettingsStore((s) => s.renameCustomLabel);
  const removeCustomLabel = useSettingsStore((s) => s.removeCustomLabel);
  const setLabelExcluded = useSettingsStore((s) => s.setLabelExcluded);
  const themeMode = useSettingsStore((s) => s.themeMode);
  const excludedTopicKeys = useSettingsStore((s) => s.excludedTopicKeys);
  const setTopicKeyExcluded = useSettingsStore((s) => s.setTopicKeyExcluded);

  const [newName, setNewName] = React.useState('');
  const [newColor, setNewColor] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  // Best-effort push of the label catalog to the box after every local edit
  // -- see useStore.pushLabels/protocol.ts's cmdSetLabels. No-ops silently
  // while disconnected; the next connect's afterConnected does a full push.
  const syncLabelsToBox = () => useStore.getState().pushLabels().catch(() => {});

  const handleCreate = () => {
    if (!newColor) {
      setError('Pick a color first.');
      return;
    }
    try {
      addCustomLabel(newName, newColor);
      syncLabelsToBox();
      setNewName('');
      setNewColor(null);
      setError(null);
    } catch (e: any) {
      setError(e?.message ?? 'Could not create that label.');
    }
  };

  const handleRename = (id: string, name: string) => {
    renameCustomLabel(id, name);
    syncLabelsToBox();
  };

  const handleDelete = (id: string, name: string) => {
    Alert.alert('Delete label?', `"${name}" will be removed. Past sessions tagged with it keep their history, just without this label's color/name.`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () => {
          removeCustomLabel(id);
          syncLabelsToBox();
        },
      },
    ]);
  };

  // No box push here (unlike create/rename/delete above) -- excludeFromTotals
  // is purely an app-side aggregation flag (stats/customLabels.ts's
  // sessionCountsTowardTotals). The box's own label catalog (cmdSetLabels)
  // only ever needs id/name/color to render a chip on its own screen; it has
  // no concept of "totals" to exclude anything from.
  const handleToggleExcluded = (id: string, excluded: boolean) => setLabelExcluded(id, excluded);

  // Same "no box push" reasoning as handleToggleExcluded above, extended to
  // a built-in topic -- excludedTopicKeys is exactly as app-side-only as a
  // label's excludeFromTotals.
  const handleToggleTopicExcluded = (key: TopicKey, excluded: boolean) => setTopicKeyExcluded(key, excluded);

  return (
    <>
      <Section title="Built-in topics" subtitle="Turn off totals/goals/streaks tracking for one of the six built-in topics" color={color}>
        {TOPIC_KEYS.map((key) => (
          <BuiltInTopicRow
            key={key}
            topicKey={key}
            swatchColor={topicColor(key, themeMode)}
            excluded={excludedTopicKeys.includes(key)}
            color={color}
            onToggleExcluded={handleToggleTopicExcluded}
          />
        ))}
      </Section>

      <Section title="Custom labels" subtitle="Add your own focus categories, alongside the built-in ones" color={color}>
        {customLabels.map((label) => (
          <CustomLabelRow
            key={label.id}
            label={label}
            color={color}
            onRename={handleRename}
            onDelete={handleDelete}
            onToggleExcluded={handleToggleExcluded}
          />
        ))}

        <View style={{ gap: 8 }}>
          <TextInput
            value={newName}
            onChangeText={setNewName}
            placeholder="New label name"
            placeholderTextColor={color.textDim}
            maxLength={MAX_LABEL_NAME_LENGTH}
            style={[styles.textInput, { color: color.text, borderColor: color.textDim }]}
          />
          <ColorSwatchRow selected={newColor} onSelect={setNewColor} color={color} />
          {error ? <Text style={[styles.subtitle, { color: color.danger }]}>{error}</Text> : null}
          <Button label="Add label" onPress={handleCreate} disabled={!newName.trim() || !newColor} color={color} />
        </View>
      </Section>
    </>
  );
}

function BuiltInTopicRow({
  topicKey,
  swatchColor,
  excluded,
  color,
  onToggleExcluded,
}: {
  topicKey: TopicKey;
  swatchColor: string;
  excluded: boolean;
  color: ReturnType<typeof useTheme>;
  onToggleExcluded: (key: TopicKey, excluded: boolean) => void;
}) {
  const name = TOPIC_LABELS[topicKey];
  return (
    <View style={{ gap: 2 }}>
      <View style={styles.labelRow}>
        <View style={[styles.swatch, { backgroundColor: swatchColor }]} />
        <Text style={[styles.label, { color: color.text, flex: 1 }]}>{name}</Text>
      </View>
      <CountsTowardTotalsRow
        name={name}
        excluded={excluded}
        onToggle={(next) => onToggleExcluded(topicKey, next)}
        color={color}
      />
    </View>
  );
}

/**
 * The "Counts toward totals & goals" switch and the caption that appears
 * under it when the answer is no.
 *
 * One component, two catalogs -- built-in topics (BuiltinTopicRow above) and
 * saved custom labels (CustomLabelRow below) -- because it is one feature,
 * and the two rows should read as identical apart from the edit chrome a
 * built-in topic has no use for. They were previously the same twenty lines
 * twice, with a comment on each pointing at the other.
 *
 * "Counts toward totals" rather than "Exclude this label": phrased as the
 * ON-state a user wants to keep for every label they never think about, per
 * this project's "the common case reads as the affirmative, not a double
 * negative" convention (see e.g. AlertsSection.tsx's own toggle copy).
 * Sessions tagged with an excluded label are still logged and still shown
 * everywhere history renders (SessionListSheet, DaySheet, the topic
 * breakdown) regardless of this switch -- only the aggregates named in the
 * caption stop counting them (customLabels.ts's sessionCountsTowardTotals).
 */
function CountsTowardTotalsRow({
  name,
  excluded,
  onToggle,
  color,
}: {
  name: string;
  excluded: boolean;
  /** Receives the new EXCLUDED value, not the switch's own on/off -- the
   * switch is inverted (on means counted), and inverting it here rather than
   * at each call site is what keeps both catalogs' handlers reading the
   * same way. */
  onToggle: (excluded: boolean) => void;
  color: ReturnType<typeof useTheme>;
}) {
  return (
    <>
      <View style={[styles.labelRow, { paddingLeft: 38 }]}>
        <Text
          style={[styles.excludeLabel, { color: excluded ? color.textDim : color.text, flex: 1 }]}
          numberOfLines={1}
        >
          Counts toward totals &amp; goals
        </Text>
        <Switch
          value={!excluded}
          onValueChange={(on) => onToggle(!on)}
          accessibilityLabel={`Whether ${name} counts toward totals and goals`}
        />
      </View>
      {excluded ? (
        <Text style={[styles.subtitle, { color: color.textDim, paddingLeft: 38 }]}>
          Excluded -- logged and shown, but not counted in focus totals, goal progress, streaks, or the calendar
          heat map.
        </Text>
      ) : null}
    </>
  );
}

function CustomLabelRow({
  label,
  color,
  onRename,
  onDelete,
  onToggleExcluded,
}: {
  label: CustomLabel;
  color: ReturnType<typeof useTheme>;
  onRename: (id: string, name: string) => void;
  onDelete: (id: string, name: string) => void;
  onToggleExcluded: (id: string, excluded: boolean) => void;
}) {
  const [editing, setEditing] = React.useState(false);
  const [draft, setDraft] = React.useState(label.name);
  const [error, setError] = React.useState<string | null>(null);
  const reducedMotion = useReducedMotion();

  const toggleEditing = (next: boolean) => {
    configureLayoutAnimation(reducedMotion);
    setError(null);
    // Re-seed the draft on the way IN, not only on Cancel's way out. The
    // useState initializer above runs once, and this row is keyed by
    // label.id, so it survives every change to the label's NAME -- and the
    // name changes underneath it whenever settings sync writes another
    // device's edit back into useSettingsStore (sync/firestoreSync.ts),
    // which Settings, left open, is precisely where that lands. The row
    // then showed the new name but held the old one in draft: opening the
    // editor put the pre-sync name in the field, and Save pushed it back
    // over the remote rename. The user saw a name, changed nothing, tapped
    // Save, and silently undid an edit they were never shown.
    if (next) setDraft(label.name);
    setEditing(next);
  };

  const handleSave = () => {
    // Previously silently discarded the edit and closed the row with no
    // feedback at all when the draft was blank (production readiness review,
    // Medium: "silent-discard on empty label save"). Now it stays open and
    // tells the user why, matching the create-label form's own validation
    // just below (handleCreate).
    if (!draft.trim()) {
      setError('Name cannot be empty.');
      return;
    }
    onRename(label.id, draft);
    toggleEditing(false);
  };

  if (editing) {
    return (
      <View style={{ gap: 4 }}>
        <View style={styles.labelRow}>
          <View style={[styles.swatch, { backgroundColor: label.color }]} />
          {/* The only TextInput in this app that used to carry neither an
              accessibilityLabel nor a placeholder, so VoiceOver read it as
              just its value -- "Reading, text field" -- with nothing to say
              that editing it renames the label. A placeholder (what the
              "New label name" field above uses) would not fix this one:
              this field is pre-filled with the current name, so a
              placeholder never shows and is never announced. The name is
              interpolated because several of these rows can be on screen
              at once. */}
          <TextInput
            value={draft}
            onChangeText={setDraft}
            maxLength={MAX_LABEL_NAME_LENGTH}
            accessibilityLabel={`New name for ${label.name}`}
            style={[styles.textInput, { flex: 1, color: color.text, borderColor: color.textDim }]}
            autoFocus
          />
          {/* Role + hitSlop on all four of this file's text actions: none
              of them announced as a button, and each is a 20px-tall text run
              -- under half the ~44pt minimum, in a row that also holds a
              focused TextInput, so a near-miss dismisses the keyboard
              instead of saving. */}
          <AnimatedPressable
            onPress={handleSave}
            accessibilityRole="button"
            accessibilityLabel={`Save name for ${label.name}`}
            hitSlop={hitSlop.text}
          >
            <Text style={[styles.rowAction, { color: color.accent, fontWeight: '600' }]}>Save</Text>
          </AnimatedPressable>
          <AnimatedPressable
            onPress={() => {
              setDraft(label.name);
              toggleEditing(false);
            }}
            accessibilityRole="button"
            accessibilityLabel="Cancel rename"
            hitSlop={hitSlop.text}
          >
            <Text style={[styles.rowAction, { color: color.textDim }]}>Cancel</Text>
          </AnimatedPressable>
        </View>
        {error ? <Text style={[styles.subtitle, { color: color.danger }]}>{error}</Text> : null}
      </View>
    );
  }

  const excluded = !!label.excludeFromTotals;

  return (
    <View style={{ gap: 2 }}>
      <View style={styles.labelRow}>
        <View style={[styles.swatch, { backgroundColor: label.color }]} />
        <Text style={[styles.label, { color: color.text, flex: 1 }]}>{label.name}</Text>
        <AnimatedPressable
          onPress={() => toggleEditing(true)}
          accessibilityRole="button"
          accessibilityLabel={`Rename ${label.name}`}
          hitSlop={hitSlop.text}
        >
          <Text style={[styles.rowAction, { color: color.accent }]}>Rename</Text>
        </AnimatedPressable>
        <AnimatedPressable
          onPress={() => onDelete(label.id, label.name)}
          accessibilityRole="button"
          accessibilityLabel={`Delete ${label.name}`}
          accessibilityHint="Asks for confirmation before deleting this label"
          hitSlop={hitSlop.text}
        >
          <Text style={[styles.rowAction, { color: color.danger }]}>Delete</Text>
        </AnimatedPressable>
      </View>
      <CountsTowardTotalsRow
        name={label.name}
        excluded={excluded}
        onToggle={(next) => onToggleExcluded(label.id, next)}
        color={color}
      />
    </View>
  );
}

function ColorSwatchRow({
  selected,
  onSelect,
  color,
}: {
  selected: string | null;
  onSelect: (color: string) => void;
  color: ReturnType<typeof useTheme>;
}) {
  return (
    <View style={styles.chipRow}>
      {LABEL_SWATCHES.map((hex) => (
        <AnimatedPressable
          key={hex}
          onPress={() => onSelect(hex)}
          accessibilityRole="button"
          accessibilityLabel={`Color ${hex}`}
          accessibilityState={{ selected: selected === hex }}
          // swatch is 28x28 -- under the ~44pt minimum touch target
          // (production readiness review, Medium); hitSlop extends the touch
          // target without changing the visible swatch size/layout.
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          style={[
            styles.swatch,
            { backgroundColor: hex },
            selected === hex && { borderColor: color.text, borderWidth: 3 },
          ]}
        />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  // Both were spelled out here character-for-character identically to
  // SettingsPrimitives' shared consts -- the same two objects the rest of
  // Settings already draws from.
  subtitle: captionStyle,
  label: rowLabelStyle,
  excludeLabel: { fontSize: 13, flexShrink: 1, paddingRight: 12, letterSpacing: typeScale.caption.letterSpacing, lineHeight: 18 },
  rowAction: { letterSpacing: typeScale.body.letterSpacing, lineHeight: typeScale.body.lineHeight },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  labelRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  swatch: { width: 28, height: 28, borderRadius: 14, borderWidth: 2, borderColor: 'transparent' },
  textInput: textInputStyle,
});
