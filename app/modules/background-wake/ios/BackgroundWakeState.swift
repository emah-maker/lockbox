// BackgroundWakeState.swift -- process-lifetime static state shared between
// BackgroundWakeAppDelegateSubscriber (captures the launch reason natively,
// before JS ever boots) and BackgroundWakeModule (the JS-facing Expo module,
// instantiated lazily the first time JS touches it). Neither object's
// lifecycle is guaranteed to start before the other one's data is needed, so
// the launch reason -- which must be readable the moment JS calls
// getLaunchReason() -- lives here instead of on either instance.
//
// This module previously also carried PushKit VoIP registration state for a
// planned call-greenlist feature (CallKit/PushKit routing a call through the
// app for per-contact caller identity). That feature was cancelled -- iOS
// gives third-party apps no caller-ID access on a normal cellular call
// regardless of the Contacts permission, so it couldn't do what it was
// meant to do. This module is now CoreBluetooth-restoration-only.
//
// See docs/rfcs/ios-background-wake-and-call-notification-architecture.md §3.
public enum LaunchReason: String {
  case normal
  case bleRestoration = "ble-restoration"
}

enum BackgroundWakeState {
  static var launchReason: LaunchReason = .normal
}
