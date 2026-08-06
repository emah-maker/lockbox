// JS interface to the native CallObserver Expo module.
import { NativeModule, requireNativeModule, EventSubscription } from 'expo-modules-core';

export type CallState = 'incoming' | 'connected' | 'ended' | 'dialing';

export interface CallEvent {
  state: CallState;
  outgoing: boolean;
  uuid: string;
}

// SDK 52+: the native module extends NativeModule with a typed events map, so it
// is its own event emitter (the standalone `new EventEmitter(module)` shape was
// removed). addListener('onCall', ...) is type-checked against CallEvent.
type CallObserverEvents = {
  onCall: (event: CallEvent) => void;
};

declare class CallObserverModule extends NativeModule<CallObserverEvents> {
  isAvailable(): boolean;
}

// requireNativeModule throws if the native module isn't linked (e.g. running in
// Expo Go or on Android). Callers should guard with isCallObserverAvailable().
let nativeModule: CallObserverModule | null = null;
try {
  nativeModule = requireNativeModule<CallObserverModule>('CallObserver');
} catch {
  nativeModule = null;
}

export function isCallObserverAvailable(): boolean {
  return !!nativeModule && nativeModule.isAvailable?.() === true;
}

export function addCallListener(listener: (e: CallEvent) => void): EventSubscription {
  if (!nativeModule) {
    return { remove() {} } as EventSubscription;
  }
  return nativeModule.addListener('onCall', listener);
}
