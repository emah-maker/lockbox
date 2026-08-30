// expoPush.test.ts -- the never-throws contract, and what each kind of
// failure does to the token.
//
// The stakes are asymmetric and that is the whole point of these cases. A
// result carrying `unregistered: true` makes the caller DELETE that token
// document (index.ts's removeDeadTokens), so a transport problem misreported
// as a dead token silently unsubscribes a real device -- with nothing to
// re-arm it until the user reinstalls. Every failure that is not
// specifically about the registration itself must therefore come back
// `unregistered: false`.
import { sendExpoPush, type ExpoMessage } from './expoPush';

const message = (to: string): ExpoMessage => ({ to, title: 'Focus session in 10 min', body: 'Starts at 9:00 AM.' });

const jsonResponse = (body: unknown, ok = true, status = 200) =>
  ({ ok, status, json: async () => body }) as Response;

const fetchMock = jest.fn();

beforeEach(() => {
  fetchMock.mockReset();
  global.fetch = fetchMock as unknown as typeof fetch;
});

describe('sendExpoPush', () => {
  it('reports one ok result per message, in the order given', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ data: [{ status: 'ok' }, { status: 'ok' }] }));
    const results = await sendExpoPush([message('a'), message('b')]);
    expect(results.map((r) => [r.token, r.ok])).toEqual([
      ['a', true],
      ['b', true],
    ]);
  });

  // The one error worth acting on: this app instance is gone.
  it('marks a DeviceNotRegistered ticket as unregistered', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({
        data: [{ status: 'error', message: 'not registered', details: { error: 'DeviceNotRegistered' } }],
      }),
    );
    const [result] = await sendExpoPush([message('gone')]);
    expect(result).toMatchObject({ ok: false, unregistered: true });
  });

  it('leaves a token in place for any other ticket error', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ data: [{ status: 'error', message: 'rate limited', details: { error: 'MessageRateExceeded' } }] }),
    );
    const [result] = await sendExpoPush([message('busy')]);
    expect(result).toMatchObject({ ok: false, unregistered: false });
  });

  it('does not throw, or delete anything, when the push service is down', async () => {
    fetchMock.mockResolvedValue(jsonResponse({}, false, 503));
    const results = await sendExpoPush([message('a'), message('b')]);
    // Both reported, neither condemned: a 503 says nothing about any token.
    expect(results).toHaveLength(2);
    expect(results.every((r) => !r.ok && !r.unregistered)).toBe(true);
  });

  // Covers the request timeout too -- an aborted fetch rejects, and this is
  // the path that rejection takes.
  it('does not throw, or delete anything, when the request fails outright', async () => {
    fetchMock.mockRejectedValue(new Error('The operation was aborted due to timeout'));
    const [result] = await sendExpoPush([message('a')]);
    expect(result).toMatchObject({ ok: false, unregistered: false });
    expect(result.error).toMatch(/timeout/);
  });

  it('sends with a timeout signal rather than waiting forever', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ data: [{ status: 'ok' }] }));
    await sendExpoPush([message('a')]);
    expect(fetchMock.mock.calls[0][1]).toMatchObject({ signal: expect.anything() });
  });

  // A protocol surprise is not evidence about a token either.
  it('treats a short ticket array as a plain failure', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ data: [{ status: 'ok' }] }));
    const results = await sendExpoPush([message('a'), message('b')]);
    expect(results[0]).toMatchObject({ token: 'a', ok: true });
    expect(results[1]).toMatchObject({ token: 'b', ok: false, unregistered: false });
  });

  it('chunks at the documented 100-message cap', async () => {
    fetchMock.mockImplementation(async (_url: string, init: { body: string }) => {
      const batch = JSON.parse(init.body) as ExpoMessage[];
      return jsonResponse({ data: batch.map(() => ({ status: 'ok' })) });
    });
    const results = await sendExpoPush(Array.from({ length: 250 }, (_, i) => message(`t${i}`)));
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(results).toHaveLength(250);
    expect(results.every((r) => r.ok)).toBe(true);
  });
});
