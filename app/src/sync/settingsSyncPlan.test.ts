// Unit tests for the settings two-way merge decision -- the last of
// firestoreSync's three merges that was deciding inside its own I/O wrapper,
// where nothing could reach it.
//
// Both directions of getting this wrong are quiet. Picking the remote side
// when the local one is newer silently reverts a preference the user just
// set, on the next sign-in, with no error anywhere. Getting the TIE wrong
// writes a document on every sign-in forever for something nobody changed.
import { planSettingsSync, sanitizeRemoteSettings } from './settingsSyncPlan';
import { DEFAULT_ACCENT, DEFAULT_THEME_MODE } from '../theme/theme';

const remote = (over: Record<string, unknown> = {}) => ({
  themeMode: 'light' as const,
  accent: 'sky' as const,
  callAlertsEnabled: true,
  customLabels: [],
  updatedAt: 100,
  ...over,
});

describe('planSettingsSync', () => {
  it('takes the remote side when it is newer', () => {
    const plan = planSettingsSync(50, remote({ updatedAt: 100 }));
    expect(plan.action).toBe('apply');
    expect(plan.updatedAt).toBe(100);
    expect(plan.settings).toMatchObject({ themeMode: 'light', accent: 'sky' });
  });

  it('pushes this device when it is newer', () => {
    expect(planSettingsSync(200, remote({ updatedAt: 100 })).action).toBe('push');
  });

  // Equal clocks mean both sides already hold the same write. Treating that
  // as a push would write on every sign-in, forever, for nothing.
  it('does nothing at all when the clocks agree', () => {
    expect(planSettingsSync(100, remote({ updatedAt: 100 })).action).toBe('none');
  });

  // A document written without a clock is one this device should overwrite,
  // not tie with -- a zero-equals-zero read would leave both sides stuck.
  it('treats a missing or unusable remote clock as older than anything', () => {
    expect(planSettingsSync(0, remote({ updatedAt: undefined })).action).toBe('push');
    expect(planSettingsSync(0, remote({ updatedAt: 'soon' })).action).toBe('push');
    expect(planSettingsSync(0, remote({ updatedAt: NaN })).action).toBe('push');
    expect(planSettingsSync(0, undefined).action).toBe('push');
  });

  it('survives a local clock that is missing or unusable', () => {
    expect(planSettingsSync(NaN, remote({ updatedAt: 100 })).action).toBe('apply');
    expect(planSettingsSync(undefined as unknown as number, remote({ updatedAt: 100 })).action).toBe('apply');
  });
});

// The boundary this document never had. Its rule type-checks the fields
// rather than enumerating accepted values, on purpose, so the other client
// can legitimately store something this build has never heard of.
describe('sanitizeRemoteSettings', () => {
  it('keeps values this build knows', () => {
    expect(sanitizeRemoteSettings(remote())).toEqual({
      themeMode: 'light',
      accent: 'sky',
      callAlertsEnabled: true,
      customLabels: [],
      excludedTopicKeys: [],
    });
  });

  // The crash: ACCENTS[mode] is undefined for an unknown mode, so
  // ACCENTS[mode][accent] throws -- from the first themed render after
  // sign-in, which is every screen.
  it('falls back for a mode or accent from a newer client', () => {
    const settings = sanitizeRemoteSettings(remote({ themeMode: 'system', accent: 'chartreuse' }));
    expect(settings.themeMode).toBe(DEFAULT_THEME_MODE);
    expect(settings.accent).toBe(DEFAULT_ACCENT);
  });

  it('coerces callAlertsEnabled to a real boolean', () => {
    expect(sanitizeRemoteSettings(remote({ callAlertsEnabled: undefined })).callAlertsEnabled).toBe(false);
    expect(sanitizeRemoteSettings(remote({ callAlertsEnabled: 'yes' })).callAlertsEnabled).toBe(true);
  });

  it('answers with a real array for a label catalog that is not one', () => {
    // The shape the rule used to let through: size() is defined on strings.
    expect(sanitizeRemoteSettings(remote({ customLabels: 'xx' })).customLabels).toEqual([]);
    expect(sanitizeRemoteSettings(remote({ customLabels: undefined })).customLabels).toEqual([]);
  });

  // sanitizeExcludedTopicKeys's own counterpart to the customLabels coverage
  // just above -- same boundary, same reasoning (firestore.rules' settings/
  // app rule type-checks `is list` but cannot verify each entry is a real
  // TopicKey).
  it('answers with a clean excludedTopicKeys array, dropping garbage and duplicates', () => {
    expect(sanitizeRemoteSettings(remote({ excludedTopicKeys: 'work' })).excludedTopicKeys).toEqual([]);
    expect(sanitizeRemoteSettings(remote({ excludedTopicKeys: undefined })).excludedTopicKeys).toEqual([]);
    expect(
      sanitizeRemoteSettings(remote({ excludedTopicKeys: ['work', 'not-a-real-topic', 'work', 'study'] }))
        .excludedTopicKeys,
    ).toEqual(['work', 'study']);
  });

  it('drops label entries it cannot trust, keeping the rest', () => {
    const labels = sanitizeRemoteSettings(
      remote({ customLabels: [{ id: 'custom:1', name: 'Deep Work', color: '#123456' }, null, { id: 'custom:2' }] }),
    ).customLabels;
    expect(labels).toEqual([{ id: 'custom:1', name: 'Deep Work', color: '#123456' }]);
  });

  it('answers with a complete, renderable object for a wholly absent document', () => {
    expect(sanitizeRemoteSettings(undefined)).toEqual({
      themeMode: DEFAULT_THEME_MODE,
      accent: DEFAULT_ACCENT,
      callAlertsEnabled: false,
      customLabels: [],
      excludedTopicKeys: [],
    });
  });
});
