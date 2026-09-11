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
  getCurrentCalls(): CallEvent[];
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

/** Every call iOS knows about right now, as a snapshot rather than a
 * transition -- the only half of this module that still reports anything
 * after iOS has suspended and resumed the app. See CallObserverModule.swift's
 * header for why that matters and app/src/calls/CallMonitor.ts for who polls
 * it.
 *
 * The `?.()` is not paranoia: a reloaded JS bundle can be newer than the
 * dev-client binary it is running against, and that older binary has an
 * isAvailable() but no getCurrentCalls(). Degrade to "no calls known" rather
 * than throwing, exactly as isCallObserverAvailable() does. */
export function getCurrentCalls(): CallEvent[] {
  try {
    return nativeModule?.getCurrentCalls?.() ?? [];
  } catch {
    // Keeps this a total function. Its caller (CallMonitor.checkNow) is fired
    // and forgotten from the BLE status handler, so anything thrown here
    // would surface as an unhandled rejection rather than a missed alert.
    return [];
  }
}
