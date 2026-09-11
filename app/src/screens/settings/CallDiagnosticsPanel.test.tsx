// The panel's rendering is covered by screens.smoke/SettingsScreen; what is
// worth pinning down separately is wakeVerdict, because it is the one place
// that turns `backgroundTicks` into the conclusion a human acts on.
import { wakeVerdict } from './CallDiagnosticsPanel';
import type { CallDiagnostics } from '../../calls/callDiagnostics';

// Importing the panel at all pulls in SettingsPrimitives -> @expo/vector-icons
// -> expo-font, which resolves expo-asset (not installed here). Same stand-in
// as SettingsScreen.test.tsx and screens.smoke.test.tsx use, for the same
// reason: icons are opaque leaves to a suite that never renders them.
jest.mock('@expo/vector-icons', () => ({ Ionicons: 'Ionicons', Feather: 'Feather', MaterialIcons: 'MaterialIcons' }));

const diag = (over: Partial<CallDiagnostics> = {}): CallDiagnostics => ({
  ticks: 0,
  backgroundTicks: 0,
  lastTickAt: null,
  maxGapMs: 0,
  events: [],
  ...over,
});

describe('wakeVerdict', () => {
  it('confirms the design once any tick has arrived with the app closed', () => {
    const verdict = wakeVerdict(diag({ ticks: 90, backgroundTicks: 60 }));

    expect(verdict.ok).toBe(true);
    expect(verdict.text).toContain('60 of 90');
  });

  it('calls out ticks that only ever arrive in the foreground', () => {
    // This is the failure that kills alert-through entirely, so it must not
    // read as merely "no data yet".
    const verdict = wakeVerdict(diag({ ticks: 90, backgroundTicks: 0 }));

    expect(verdict.ok).toBe(false);
    expect(verdict.text).toContain('cannot work');
  });

  it('stays neutral before any tick has been seen', () => {
    const verdict = wakeVerdict(diag());

    expect(verdict.ok).toBeNull();
    expect(verdict.text).toContain('No status ticks');
  });
});
