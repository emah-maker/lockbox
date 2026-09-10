// legalLinks.ts -- the app's outward-facing legal URLs, and the one helper
// that opens them.
//
// App Store Review Guideline 5.1.1(i) requires an app that creates accounts
// and stores user data (this one does: see sync/firestoreSync.ts's schema) to
// link to its privacy policy "within the app in an easily accessible manner",
// not only in App Store Connect metadata. That link is rendered by
// screens/settings/AboutSection.tsx -- reachable signed IN or OUT, which is
// why it lives in the Settings hub rather than only on the Account page --
// and re-used by screens/account/DataPrivacySection.tsx so the disclosure
// text and the policy it summarizes sit together.
//
// The URL must resolve: a link to a 404 is itself a rejection (Guideline 2.1,
// "broken links"). website/privacy.html is the page it points at; it ships
// with the marketing site (firebase.json's `hosting.public`) and must be
// deployed BEFORE a build goes to Beta App Review. If the site ever moves to
// a custom domain, this constant is the only place in the app that changes,
// and the value here must stay identical to the Privacy Policy URL entered in
// App Store Connect -- reviewers compare them.
import { Linking } from 'react-native';

/** Firebase Hosting's default domain for the `phonebox-d14b7` project (see
 * .firebaserc) -- the site's live origin until a custom domain exists. */
export const PRIVACY_POLICY_URL = 'https://phonebox-d14b7.web.app/privacy.html';

/**
 * Opens `url` in the system browser. Never throws: an external link is a
 * leaf action, and no caller has anything useful to do about a failure
 * beyond what this reports -- same "an optional capability must not crash
 * the screen that offers it" posture goals/goalNotifications.ts takes.
 * Returns whether the handoff succeeded so a caller can surface it.
 */
export async function openExternalUrl(url: string): Promise<boolean> {
  try {
    await Linking.openURL(url);
    return true;
  } catch (e: any) {
    console.warn('[legalLinks] could not open', url, '--', e?.message ?? e);
    return false;
  }
}
