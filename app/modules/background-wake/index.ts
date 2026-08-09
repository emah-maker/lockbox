// JS interface to the native BackgroundWake Expo module -- currently the
// only consumer is Feature B (background BLE-log drain, see
// docs/rfcs/ios-call-greenlist-and-force-quit-logging-technical-design.md
// §3.3). This module previously also carried PushKit VoIP registration
// (registerVoIPPush/onVoIPToken/onVoIPPushPayload) and a 'voip-push'
// LaunchReason for a planned call-greenlist feature -- that feature was
// cancelled (iOS gives third-party apps no caller-ID access on a normal
// cellular call, Contacts permission or not, so it couldn't do what it was
// meant to do), and that code has been removed rather than left dead.
//
// Deviation from the original background-wake RFC
// (docs/rfcs/ios-background-wake-and-call-notification-architecture.md §3.2)
// worth flagging: that doc listed `app/app.json` as an edited file ("register
// the new module's config plugin"). That turned out to be unnecessary --
// expo-modules-autolinking's nativeModulesDir search (the same mechanism
// that already links call-observer with zero app.json entries) picks up
// this module's `modules` and `appDelegateSubscribers` from
// expo-module.config.json automatically at prebuild time. A config plugin is
// only needed when a module must *mutate* app.json-derived native config
// (Info.plist keys, entitlements), which this module does not do.
// app.json is intentionally left untouched by this module.
import { NativeModule, requireNativeModule, EventSubscription } from 'expo-modules-core';

export type LaunchReason = 'normal' | 'ble-restoration';

type BackgroundWakeEvents = {
  onBackgroundWake: (event: { reason: LaunchReason }) => void;
};

declare class BackgroundWakeModule extends NativeModule<BackgroundWakeEvents> {
  getLaunchReason(): LaunchReason;
}

// requireNativeModule throws if the native module isn't linked (Expo Go,
// Android, or a dev-client build that hasn't been rebuilt since this module
// was added). Every export below degrades gracefully when it's null -- same
// pattern as call-observer/index.ts's isCallObserverAvailable().
let nativeModule: BackgroundWakeModule | null = null;
try {
  nativeModule = requireNativeModule<BackgroundWakeModule>('BackgroundWake');
} catch {
  nativeModule = null;
}

export function isBackgroundWakeAvailable(): boolean {
  return !!nativeModule;
}

/** 'normal' on Android/Expo Go, or if this cold launch wasn't a background wake. */
export function getLaunchReason(): LaunchReason {
  return nativeModule?.getLaunchReason() ?? 'normal';
}

// Fired once, early, on a cold launch the OS performed for a CoreBluetooth
// restoration reason. The native side may have already captured the reason
// before any JS listener attaches -- it's captured in AppDelegate, before
// the JS bundle even boots -- so the native module replays the buffered
// reason to the first listener that starts observing (see
// BackgroundWakeModule.swift's OnStartObserving), meaning subscribing from
// App.tsx's initial render still sees it.
export function onBackgroundWake(cb: (reason: LaunchReason) => void): EventSubscription {
  if (!nativeModule) return { remove() {} } as EventSubscription;
  return nativeModule.addListener('onBackgroundWake', (e) => cb(e.reason));
}
