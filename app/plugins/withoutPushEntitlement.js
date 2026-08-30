// Phone Box's iOS builds ship with LOCAL scheduled reminders only (see
// src/goals/goalNotifications.ts and src/schedule/sessionReminders.ts).
//
// NOTE, because this is no longer the whole story: the app DOES contain
// remote-push code now (src/push/pushRegistration.ts, and the backend in
// functions/). It is deliberately dormant on iOS while this plugin is
// active -- getExpoPushTokenAsync throws without the entitlement, and that
// module treats the failure like any other unavailability, so nothing
// breaks and nothing is scheduled server-side for this device. Android is
// unaffected by this file. See docs/push-notifications.md for how to turn
// iOS push on, which starts with deleting this plugin.
//
// expo-notifications' own config plugin
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
// TO ENABLE iOS PUSH: delete this file and its `plugins` entry, then set up an
// APNs key (`eas credentials --platform ios` -> Push Notifications) AND
// regenerate the provisioning profile. Both, not just the first -- a profile
// cached from before the capability existed is what produces:
//
//   Provisioning profile "...AdHoc..." doesn't support the Push Notifications
//   capability. / doesn't include the aps-environment entitlement.
//
// which is exactly how this file came to be restored after having been
// deleted once. EAS syncs the App ID capability from these entitlements
// automatically; it does not re-mint an already-cached profile.
const { withEntitlementsPlist } = require('expo/config-plugins');

module.exports = function withoutPushEntitlement(config) {
  return withEntitlementsPlist(config, (cfg) => {
    delete cfg.modResults['aps-environment'];
    return cfg;
  });
};
