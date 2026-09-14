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
import { Switch } from 'react-native';
import { useTheme } from '../../theme/useTheme';
import { useStore } from '../../store/useStore';
import { Section, Row } from '../SettingsPrimitives';
import { OverridePressPicker, OverrideCustomEntry } from '../OverridePressSection';
import { AngleCustomEntry } from '../ServoAngleSection';
import { OVR_MIN, OVR_MAX } from '../overridePresses';
import { OVR_TIMEOUT_OPTIONS_TENTHS, formatOverrideTimeout } from '../overrideTimeout';
import { PickerGroup } from './ChipPicker';
import type { Settings } from '../../ble/protocol';

// useStore doesn't export its `Conn` union type (it's a private type alias
// in useStore.ts, which this agent doesn't own -- see that file), so this
// derives the same type from the store's own state shape instead of
// duplicating the literal union here.
type Conn = ReturnType<typeof useStore.getState>['conn'];

// 0 is the box's "never sleep" option, not a zero-second timeout -- see
// lock_config.py's SLEEP_OPTIONS and code.py's sleep predicate, which guards
// on sleep_s > 0. Rendered as "Off" for the same reason the box's own row
// does: "0s" would describe the opposite of the behaviour it selects.
const SLEEP_OPTIONS = [0, 10, 20, 30, 60];
const formatSleep = (v: number) => (v <= 0 ? 'Off' : `${v}s`);
const BRIGHT_OPTIONS = [10, 30, 50, 70, 100];

export function BoxBehaviorSection({
  color,
  conn,
  boxSettings,
  pushBoxSettings,
  demoMode,
}: {
  color: ReturnType<typeof useTheme>;
  conn: Conn;
  boxSettings: Settings;
  pushBoxSettings: (patch: Partial<Settings>) => void;
  /** Whether these values came from the simulated box (ble/DemoBoxClient.ts)
   * rather than a real one. Wording only -- every control below behaves
   * identically either way, and does round-trip to the demo box. */
  demoMode: boolean;
}) {
  return (
    <Section
      title="Box behavior"
      // Said outright rather than left to be inferred: in demo mode these
      // are the SIMULATED box's values, and a reader who takes them for
      // their own box's would draw the wrong conclusion about a physical
      // lock -- "allow open from this phone" most of all. They are shown
      // rather than hidden because they are what the box you are actually
      // connected to is doing; they are not written over the real box's
      // saved mirror (see useSettingsStore's setBoxSettings).
      subtitle={
        demoMode
          ? "Simulated box -- your real box keeps its own settings"
          : conn !== 'connected'
            ? 'Showing last-known values -- connect to change live'
            : undefined
      }
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
      {/* Sits directly under the press count because the two only mean
          anything together: N presses within this window of each other.
          Values are in tenths of a second on the wire (protocol.ts's `ovrt`)
          and only ever rendered as seconds -- see overrideTimeout.ts. */}
      <PickerGroup
        label="Override window"
        options={OVR_TIMEOUT_OPTIONS_TENTHS}
        value={boxSettings.ovrt}
        format={formatOverrideTimeout}
        onSelect={(v) => pushBoxSettings({ ovrt: v })}
        color={color}
      />
      <PickerGroup
        label="Screen sleep"
        options={SLEEP_OPTIONS}
        value={boxSettings.sleep}
        format={formatSleep}
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
