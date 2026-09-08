// accountLinking.test.ts -- unit tests for the cross-provider link-conflict
// handler. Mocks only 'firebase/auth' (linkWithCredential + the error-code
// constant); everything else is this module's own real logic.
import { linkWithCredential } from 'firebase/auth';
import {
  signInDetectingLinkConflict,
  completePendingLink,
  getPendingLink,
  clearPendingLink,
  AccountExistsError,
} from './accountLinking';

jest.mock('firebase/auth', () => ({
  AuthErrorCodes: { NEED_CONFIRMATION: 'auth/account-exists-with-different-credential' },
  linkWithCredential: jest.fn(),
}));

const mockLinkWithCredential = linkWithCredential as jest.Mock;

function conflictError(email: string | null): any {
  const e: any = new Error('conflict');
  e.code = 'auth/account-exists-with-different-credential';
  e.customData = email ? { email } : {};
  return e;
}

const fakeCredential = { providerId: 'apple.com', signInMethod: 'oauth' } as any;
const fakeUser = { uid: 'uid-1' } as any;

afterEach(() => {
  clearPendingLink();
  jest.clearAllMocks();
});

describe('signInDetectingLinkConflict', () => {
  it('returns the attempt result on success without touching pending state', async () => {
    const result = await signInDetectingLinkConflict('google', fakeCredential, async () => 'ok');
    expect(result).toBe('ok');
    expect(getPendingLink()).toBeNull();
  });

  it('stashes the credential and throws AccountExistsError on conflict', async () => {
    const attempt = () => Promise.reject(conflictError('user@example.com'));
    await expect(signInDetectingLinkConflict('apple', fakeCredential, attempt)).rejects.toBeInstanceOf(
      AccountExistsError,
    );

    const pending = getPendingLink();
    expect(pending).not.toBeNull();
    expect(pending!.attemptedProvider).toBe('apple');
    expect(pending!.email).toBe('user@example.com');
    expect(pending!.credential).toBe(fakeCredential);
  });

  // candidateProviders REPLACES the old single linkWithProvider field from
  // when this app supported only two providers (see accountLinking.ts's
  // PendingAccountLink doc comment) -- with three, "the other one" is a list,
  // not a single answer.
  it('computes candidateProviders as every OTHER supported provider, excluding only the one that just conflicted', async () => {
    await expect(
      signInDetectingLinkConflict('apple', fakeCredential, () => Promise.reject(conflictError(null))),
    ).rejects.toBeInstanceOf(AccountExistsError);
    expect(getPendingLink()!.candidateProviders).toEqual(['google', 'password']);

    clearPendingLink();

    await expect(
      signInDetectingLinkConflict('google', fakeCredential, () => Promise.reject(conflictError(null))),
    ).rejects.toBeInstanceOf(AccountExistsError);
    expect(getPendingLink()!.candidateProviders).toEqual(['apple', 'password']);
  });

  it('defaults email to null when the error has no customData.email', async () => {
    await expect(
      signInDetectingLinkConflict('google', fakeCredential, () => Promise.reject(conflictError(null))),
    ).rejects.toBeInstanceOf(AccountExistsError);
    expect(getPendingLink()!.email).toBeNull();
  });

  it('rethrows non-conflict errors unchanged and does not stash anything', async () => {
    const otherError = new Error('network down');
    await expect(
      signInDetectingLinkConflict('google', fakeCredential, () => Promise.reject(otherError)),
    ).rejects.toBe(otherError);
    expect(getPendingLink()).toBeNull();
  });
});

describe('completePendingLink', () => {
  it('is a no-op when nothing is pending', async () => {
    await completePendingLink(fakeUser);
    expect(mockLinkWithCredential).not.toHaveBeenCalled();
  });

  it('calls linkWithCredential with the stashed credential, then clears it', async () => {
    await expect(
      signInDetectingLinkConflict('apple', fakeCredential, () => Promise.reject(conflictError('a@b.com'))),
    ).rejects.toBeInstanceOf(AccountExistsError);
    expect(getPendingLink()).not.toBeNull();

    mockLinkWithCredential.mockResolvedValueOnce({ user: fakeUser });
    await completePendingLink(fakeUser);

    expect(mockLinkWithCredential).toHaveBeenCalledWith(fakeUser, fakeCredential);
    expect(getPendingLink()).toBeNull();
  });

  it('a failed completePendingLink still clears the pending credential (no stale retry)', async () => {
    await expect(
      signInDetectingLinkConflict('apple', fakeCredential, () => Promise.reject(conflictError('a@b.com'))),
    ).rejects.toBeInstanceOf(AccountExistsError);

    mockLinkWithCredential.mockRejectedValueOnce(new Error('link failed'));
    await expect(completePendingLink(fakeUser)).rejects.toThrow('link failed');

    expect(getPendingLink()).toBeNull();
  });
});

describe('clearPendingLink', () => {
  // End-to-end proof (against this module's real, unmocked logic) that
  // dismissing a conflict actually closes the exploit useAuthStore.ts's
  // dismissPendingLink was added to fix: a credential stashed by one
  // conflict, abandoned (not completed), must never be available for a
  // LATER, unrelated sign-in to have linked onto it. The
  // deleteAccount.test.ts suite asserts useAuthStore.ts *calls*
  // clearPendingLink at the right points; this asserts the call actually
  // removes the credential, not just that some mock recorded an invocation.
  it('removes the stashed credential, so a later completePendingLink for an unrelated user is a no-op', async () => {
    await expect(
      signInDetectingLinkConflict('google', fakeCredential, () => Promise.reject(conflictError('a@b.com'))),
    ).rejects.toBeInstanceOf(AccountExistsError);
    expect(getPendingLink()).not.toBeNull();

    clearPendingLink(); // the dismissal useAuthStore.ts's dismissPendingLink performs

    expect(getPendingLink()).toBeNull();
    const unrelatedUser = { uid: 'someone-else-entirely' } as any;
    await completePendingLink(unrelatedUser);
    expect(mockLinkWithCredential).not.toHaveBeenCalled();
  });
});
