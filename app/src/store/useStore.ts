// useStore.ts -- global app state (zustand). Owns the single BLE client + call
// monitor and exposes connection lifecycle + live box data to the screens.
import { create } from 'zustand';
import { PhoneBoxClient } from '../ble/PhoneBoxClient';
import { CallMonitor } from '../calls/CallMonitor';
import type { Status, Stats, BoxState } from '../ble/protocol';

type Conn = 'idle' | 'scanning' | 'connecting' | 'connected' | 'error';

interface AppState {
  conn: Conn;
  error: string | null;
  status: Status | null;
  stats: Stats | null;
  callAlertsEnabled: boolean;
  lastAlert: string | null;

  connect: () => Promise<void>;
  disconnect: () => Promise<void>;
  startLock: (seconds: number) => Promise<void>;
  setCallAlerts: (on: boolean) => void;
}

const client = new PhoneBoxClient();

export const useStore = create<AppState>((set, get) => {
  const monitor = new CallMonitor({
    client,
    getBoxState: (): BoxState => get().status?.st ?? 'idle',
    isEnabled: () => get().callAlertsEnabled,
    onAlertSent: (label) => set({ lastAlert: label }),
  });

  return {
    conn: 'idle',
    error: null,
    status: null,
    stats: null,
    callAlertsEnabled: true,
    lastAlert: null,

    connect: async () => {
      try {
        set({ conn: 'scanning', error: null });
        await client.waitForPoweredOn();
        const device = await client.scanForBox();
        set({ conn: 'connecting' });
        await client.connect(device, {
          onStatus: (status) => set({ status }),
          onStats: (stats) => set({ stats }),
          onDisconnect: () => set({ conn: 'idle', status: null }),
        });
        set({ conn: 'connected' });
        monitor.start();
      } catch (e: any) {
        set({ conn: 'error', error: e?.message ?? 'Connection failed' });
      }
    },

    disconnect: async () => {
      monitor.stop();
      await client.disconnect();
      set({ conn: 'idle', status: null });
    },

    startLock: async (seconds) => {
      await client.startLock(seconds);
    },

    setCallAlerts: (on) => set({ callAlertsEnabled: on }),
  };
});
