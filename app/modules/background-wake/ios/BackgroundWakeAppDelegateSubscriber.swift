// BackgroundWakeAppDelegateSubscriber.swift -- the native seam for detecting
// why iOS cold-launched this process, so App.tsx can decide whether to
// opportunistically drain the box's pending BLE history (see
// docs/rfcs/ios-background-wake-and-call-notification-architecture.md §3.1,
// §3.4). Currently owns exactly one thing: CoreBluetooth-restoration
// launch-reason detection.
//
// (This module previously also owned PushKit VoIP registration for a
// planned call-greenlist feature; that feature was cancelled -- see
// BackgroundWakeState.swift's header comment -- so there is no PushKit code
// here anymore.)
//
// This hooks into app launch via Expo's AppDelegate-subscriber mechanism
// (https://docs.expo.dev/modules/appdelegate-subscribers/), registered
// declaratively in ../expo-module.config.json ("appDelegateSubscribers"),
// rather than hand-editing the generated ios/*/AppDelegate.swift -- this is
// an Expo-managed (prebuild) project, so a hand-edit to the generated
// AppDelegate would be silently discarded on the next `expo prebuild`.
// Autolinking wires this class into the generated ExpoModulesProvider
// automatically; no app.json change is needed for that wiring.
import ExpoModulesCore
import UIKit

public class BackgroundWakeAppDelegateSubscriber: ExpoAppDelegateSubscriber {
  public func application(
    _ application: UIApplication,
    didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil
  ) -> Bool {
    // Launch-reason detection (RFC §3.4). CoreBluetooth state restoration
    // surfaces as a `.bluetoothCentrals` key in launchOptions on a cold
    // launch the OS performed because a BLE peripheral event occurred while
    // this process was terminated. Must be captured here, before JS boots --
    // by the time App.tsx calls getLaunchReason(), this needs to already be
    // set on BackgroundWakeState.
    if launchOptions?[.bluetoothCentrals] != nil {
      BackgroundWakeState.launchReason = .bleRestoration
    }
    return true
  }
}
