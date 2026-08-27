// BoxBehaviorSection.tsx -- the settings hub's "Box behavior" sheet: every
// control that round-trips over BLE via useStore.pushBoxSettings, mirrored
// locally in useSettingsStore.boxSettings so this still has something to
// show even before a connection is made. Extracted out of SettingsScreen.tsx
// (previously its own inline "Box behaviors" Section) once the hub/sheet
// restructure needed it as a standalone mountable unit, same content as
// before -- see that file's git history for the pre-extraction version.
//
// Mirrors Box-code/lib/lock_config.py -- keep OVR_MIN/OVR_MAX/OVR_STEP
// (overridePresses.ts) and SLEEP_OPTIONS/BRIGHT_OPTIONS below in lockstep
// with the firmware side.
import React from 'react';
import { Switch } from 'react-native';
import { useTheme } from '../../theme/useTheme';
import { useStore } from '../../store/useStore';
import { Section, Row } from '../SettingsPrimitives';
import { OverridePressPicker, OverrideCustomEntry } from '../OverridePressSection';
import { AngleCustomEntry } from '../ServoAngleSection';
import { OVR_MIN, OVR_MAX } from '../overridePresses';
import { PickerGroup } from './ChipPicker';
import type { Settings } from '../../ble/protocol';

// useStore doesn't export its `Conn` union type (it's a private type alias
// in useStore.ts, which this agent doesn't own -- see that file), so this
// derives the same type from the store's own state shape instead of
// duplicating the literal union here.
type Conn = ReturnType<typeof useStore.getState>['conn'];

const SLEEP_OPTIONS = [10, 20, 30, 60];
const BRIGHT_OPTIONS = [10, 30, 50, 70, 100];

export function BoxBehaviorSection({
  color,
  conn,
  boxSettings,
  pushBoxSettings,
}: {
  color: ReturnType<typeof useTheme>;
  conn: Conn;
  boxSettings: Settings;
  pushBoxSettings: (patch: Partial<Settings>) => void;
}) {
  return (
    <Section
      title="Box behavior"
      subtitle={conn !== 'connected' ? 'Showing last-known values -- connect to change live' : undefined}
      color={color}
    >
      <Row label="Auto-open when done" color={color}>
        <Switch
          value={!!boxSettings.auto}
          onValueChange={(v) => pushBoxSettings({ auto: v ? 1 : 0 })}
          accessibilityLabel="Auto-open when done"
        />
      </Row>
      <OverridePressPicker value={boxSettings.ovr} onChange={(v) => pushBoxSettings({ ovr: v })} color={color} />
      <OverrideCustomEntry
        value={boxSettings.ovr}
        min={OVR_MIN}
        max={OVR_MAX}
        onChange={(v) => pushBoxSettings({ ovr: v })}
        color={color}
      />
      <PickerGroup
        label="Screen sleep"
        options={SLEEP_OPTIONS}
        value={boxSettings.sleep}
        format={(v) => `${v}s`}
        onSelect={(v) => pushBoxSettings({ sleep: v })}
        color={color}
      />
      <PickerGroup
        label="Brightness"
        options={BRIGHT_OPTIONS}
        value={boxSettings.bright}
        format={(v) => `${v}%`}
        onSelect={(v) => pushBoxSettings({ bright: v })}
        color={color}
      />
      <AngleCustomEntry
        label="Lock angle"
        value={boxSettings.langle}
        onChange={(v) => pushBoxSettings({ langle: v })}
        color={color}
      />
      <AngleCustomEntry
        label="Unlock angle"
        value={boxSettings.uangle}
        onChange={(v) => pushBoxSettings({ uangle: v })}
        color={color}
      />
      <Row label="Flip screen upside down" color={color}>
        <Switch
          value={!!boxSettings.flip}
          onValueChange={(v) => pushBoxSettings({ flip: v ? 1 : 0 })}
          accessibilityLabel="Flip screen upside down"
        />
      </Row>
      <Row label="Allow open/close from this phone" color={color}>
        <Switch
          value={!!boxSettings.unlk}
          onValueChange={(v) => pushBoxSettings({ unlk: v ? 1 : 0 })}
          accessibilityLabel="Allow open/close from this phone"
        />
      </Row>
      <Row label="Unlock box when called" color={color}>
        <Switch
          value={!!boxSettings.ucal}
          onValueChange={(v) => pushBoxSettings({ ucal: v ? 1 : 0 })}
          accessibilityLabel="Unlock box when called"
        />
      </Row>
    </Section>
  );
}

/** One-line hub summary for the Box behavior row -- the override-press count
 * while connected (the value people tune most often), or a plain
 * disconnected note otherwise, matching this section's own
 * connect-to-change-live subtitle above. */
export function boxBehaviorSummary(conn: Conn, boxSettings: Settings): string {
  return conn === 'connected' ? `${boxSettings.ovr} presses` : 'Not connected';
}
