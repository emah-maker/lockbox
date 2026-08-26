// CustomLabelsSection.tsx -- the "Custom labels" section of SettingsScreen,
// split into its own file so SettingsScreen.tsx stays under this project's
// 500-line file-size guideline. Custom labels coexist with the six built-in
// topics (stats/topics.ts) -- this section only ever creates/renames/deletes
// entries in useSettingsStore.customLabels, which syncs cross-device the
// same last-write-wins way as the rest of SyncableSettings (see
// useSettingsStore.ts, sync/settingsSyncBridge.ts).
import React from 'react';
import { View, Text, StyleSheet, TextInput, Alert } from 'react-native';
import { useSettingsStore } from '../store/useSettingsStore';
import { useStore } from '../store/useStore';
import { useTheme } from '../theme/useTheme';
import { LABEL_SWATCHES, MAX_LABEL_NAME_LENGTH } from '../stats/customLabels';
import { Section, Button } from './SettingsPrimitives';
import { AnimatedPressable } from '../ui/AnimatedPressable';
import { useReducedMotion, configureLayoutAnimation } from '../ui/useReducedMotion';
import { typeScale } from '../theme/tokens';

export function CustomLabelsSection({ color }: { color: ReturnType<typeof useTheme> }) {
  const customLabels = useSettingsStore((s) => s.customLabels);
  const addCustomLabel = useSettingsStore((s) => s.addCustomLabel);
  const renameCustomLabel = useSettingsStore((s) => s.renameCustomLabel);
  const removeCustomLabel = useSettingsStore((s) => s.removeCustomLabel);

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

  return (
    <Section title="Custom labels" subtitle="Add your own focus categories, alongside the built-in ones" color={color}>
      {customLabels.map((label) => (
        <CustomLabelRow key={label.id} label={label} color={color} onRename={handleRename} onDelete={handleDelete} />
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
  );
}

function CustomLabelRow({
  label,
  color,
  onRename,
  onDelete,
}: {
  label: { id: string; name: string; color: string };
  color: ReturnType<typeof useTheme>;
  onRename: (id: string, name: string) => void;
  onDelete: (id: string, name: string) => void;
}) {
  const [editing, setEditing] = React.useState(false);
  const [draft, setDraft] = React.useState(label.name);
  const [error, setError] = React.useState<string | null>(null);
  const reducedMotion = useReducedMotion();

  const toggleEditing = (next: boolean) => {
    configureLayoutAnimation(reducedMotion);
    setError(null);
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
          <TextInput
            value={draft}
            onChangeText={setDraft}
            maxLength={MAX_LABEL_NAME_LENGTH}
            style={[styles.textInput, { flex: 1, color: color.text, borderColor: color.textDim }]}
            autoFocus
          />
          <AnimatedPressable onPress={handleSave}>
            <Text style={[styles.rowAction, { color: color.accent, fontWeight: '600' }]}>Save</Text>
          </AnimatedPressable>
          <AnimatedPressable
            onPress={() => {
              setDraft(label.name);
              toggleEditing(false);
            }}
          >
            <Text style={[styles.rowAction, { color: color.textDim }]}>Cancel</Text>
          </AnimatedPressable>
        </View>
        {error ? <Text style={[styles.subtitle, { color: color.danger }]}>{error}</Text> : null}
      </View>
    );
  }

  return (
    <View style={styles.labelRow}>
      <View style={[styles.swatch, { backgroundColor: label.color }]} />
      <Text style={[styles.label, { color: color.text, flex: 1 }]}>{label.name}</Text>
      <AnimatedPressable onPress={() => toggleEditing(true)}>
        <Text style={[styles.rowAction, { color: color.accent }]}>Rename</Text>
      </AnimatedPressable>
      <AnimatedPressable onPress={() => onDelete(label.id, label.name)}>
        <Text style={[styles.rowAction, { color: color.danger }]}>Delete</Text>
      </AnimatedPressable>
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
  subtitle: { fontSize: 12, marginTop: 2, letterSpacing: typeScale.caption.letterSpacing, lineHeight: typeScale.caption.lineHeight },
  label: { fontSize: 15, flexShrink: 1, paddingRight: 12, letterSpacing: typeScale.sectionTitle.letterSpacing, lineHeight: 20 },
  rowAction: { letterSpacing: typeScale.body.letterSpacing, lineHeight: typeScale.body.lineHeight },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  labelRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  swatch: { width: 28, height: 28, borderRadius: 14, borderWidth: 2, borderColor: 'transparent' },
  textInput: {
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
    // lineHeight is left off deliberately -- on Android it mis-centers text
    // inside a TextInput's padding box.
    letterSpacing: typeScale.sectionTitle.letterSpacing,
  },
});
