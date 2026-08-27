// Phone Box uses expo-notifications for LOCAL scheduled reminders only (see
// src/goals/goalNotifications.ts) -- there is no push token registration
// anywhere in the app. But expo-notifications' own config plugin
// unconditionally writes `aps-environment` into the entitlements
// (node_modules/expo-notifications/plugin/build/withNotificationsIOS.js), and
// @expo/prebuild-config auto-applies that plugin whenever the module is
// autolinked -- listing or not listing it in app.json's `plugins` makes no
// difference. The Apple App ID has no Push Notifications capability, so the
// AdHoc provisioning profile has no `aps-environment`, and the entitlement
// being present in the binary but absent from the profile fails codesign:
//
//   Provisioning profile "...AdHoc..." doesn't support the Push Notifications
//   capability. / doesn't include the aps-environment entitlement.
//
// The app config can't express this (@expo/config-plugins' entitlements base
// mod merges `ios.entitlements` OVER the plist, so it can add but never
// remove), hence this plugin.
//
// ORDERING TRAP: entitlements mods run in REVERSE registration order, so this
// plugin only wins because expo-notifications is NOT listed in app.json's
// `plugins`. Re-adding it there ahead of this entry makes its mod run AFTER
// this one and the entitlement comes back -- verified. Leaving it unlisted
// costs nothing: prebuild-config auto-applies it, and app.json configures no
// notification icon/color/sound/channel for the listed form to pick up.
//
// If remote push is ever added, delete this file and its `plugins` entry, then
// enable Push Notifications on the App ID and regenerate the profile with
// `eas credentials`.
const { withEntitlementsPlist } = require('expo/config-plugins');

module.exports = function withoutPushEntitlement(config) {
  return withEntitlementsPlist(config, (cfg) => {
    delete cfg.modResults['aps-environment'];
    return cfg;
  });
};
