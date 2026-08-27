// useNav.ts -- cross-screen navigation/deep-linking store. App.tsx still owns
// the actual tab switcher (a trivial hand-rolled component, no
// react-navigation dependency -- see its own header comment); this store
// exists so a screen or popup on one tab can jump to another tab AND hand it
// a bit of context to act on once it lands (e.g. "open Calendar on this
// date", "open Settings on the Goals section") without every screen needing
// to import every other screen's internals. Shaped like useSettingsStore.ts's
// own zustand store.
import { create } from 'zustand';

export type Tab = 'dashboard' | 'stats' | 'calendar' | 'settings';

export interface NavIntent {
  calendarDate?: string; // 'YYYY-MM-DD'
  statsPeriod?: 'day' | 'week' | 'month' | 'all' | 'goals';
  goalId?: string;
  settingsSection?: 'account' | 'goals' | 'labels' | 'box' | 'appearance';
  topic?: string;
}

interface NavState {
  tab: Tab;
  intent: NavIntent | null;
  setTab: (t: Tab) => void;
  /** Switches tabs and hands the destination screen a one-shot intent to
   * act on once it's mounted (or already mounted and watching for it) --
   * see consumeIntent. Omit `intent` for a plain tab switch with nothing to
   * hand off (e.g. the bottom tab bar's own taps in App.tsx). */
  navigate: (t: Tab, intent?: NavIntent) => void;
  /** Reads the pending intent once and clears it, so a screen that consumes
   * this on focus/mount doesn't re-run the same navigation side effect
   * (e.g. re-opening the same day, re-scrolling to the same goal) on every
   * later render once the intent's already been acted on. */
  consumeIntent: () => NavIntent | null;
}

export const useNav = create<NavState>((set, get) => ({
  tab: 'dashboard',
  intent: null,

  setTab: (t) => set({ tab: t }),

  navigate: (t, intent) => set({ tab: t, intent: intent ?? null }),

  consumeIntent: () => {
    const intent = get().intent;
    if (intent) set({ intent: null });
    return intent;
  },
}));
