// expoReceipts.test.ts -- redeeming ticket ids for delivery receipts.
//
// This is the half of the push path that DELETES things. A receipt reporting
// DeviceNotRegistered costs a token its document (index.ts's
// collectPushReceipts), so the cases below are mostly about the three ways
// this could delete something it shouldn't:
//
//   - reading "no receipt yet" as an answer,
//   - reading a transport failure as an answer,
//   - reading any delivery error as though it were about the registration.
//
// The safe direction is always to learn nothing and ask again: a token kept
// too long costs wasted requests, a token deleted wrongly silently
// unsubscribes a working device with nothing to re-arm it.
import { fetchExpoReceipts } from './expoPush';

const jsonResponse = (body: unknown, ok = true, status = 200) =>
  ({ ok, status, json: async () => body }) as Response;

const fetchMock = jest.fn();

beforeEach(() => {
  fetchMock.mockReset();
  global.fetch = fetchMock as unknown as typeof fetch;
});

describe('fetchExpoReceipts', () => {
  it('reports a delivered receipt', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ data: { 'ticket-1': { status: 'ok' } } }));
    expect(await fetchExpoReceipts(['ticket-1'])).toEqual([{ ticketId: 'ticket-1', ok: true, unregistered: false }]);
  });

  // The whole reason this second round trip exists: DeviceNotRegistered for an
  // app that was simply uninstalled shows up here, not in the send ticket.
  it('reports DeviceNotRegistered as a dead registration', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({
        data: { 'ticket-1': { status: 'error', message: 'gone', details: { error: 'DeviceNotRegistered' } } },
      }),
    );
    const [outcome] = await fetchExpoReceipts(['ticket-1']);
    expect(outcome).toMatchObject({ ticketId: 'ticket-1', ok: false, unregistered: true });
  });

  it('does not condemn a token over any other delivery error', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({
        data: { 'ticket-1': { status: 'error', message: 'oops', details: { error: 'MessageTooBig' } } },
      }),
    );
    const [outcome] = await fetchExpoReceipts(['ticket-1']);
    expect(outcome).toMatchObject({ ok: false, unregistered: false });
  });

  // An id Expo omits means "not available yet". Returning anything for it --
  // ok OR error -- would be inventing an answer: reported as delivered, the
  // ticket is dropped and the DeviceNotRegistered it was about is never seen;
  // reported as an error, a live token is at risk.
  it('says nothing at all about an id the response omits', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ data: { 'ticket-1': { status: 'ok' } } }));
    const outcomes = await fetchExpoReceipts(['ticket-1', 'ticket-2']);
    expect(outcomes.map((o) => o.ticketId)).toEqual(['ticket-1']);
  });

  it('learns nothing from an HTTP error rather than guessing', async () => {
    fetchMock.mockResolvedValue(jsonResponse({}, false, 502));
    expect(await fetchExpoReceipts(['ticket-1'])).toEqual([]);
  });

  it('learns nothing when the request fails or times out', async () => {
    fetchMock.mockRejectedValue(new Error('The operation was aborted due to timeout'));
    expect(await fetchExpoReceipts(['ticket-1'])).toEqual([]);
  });

  it('learns nothing from a response with no data object', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ errors: [{ code: 'INTERNAL_SERVER_ERROR' }] }));
    expect(await fetchExpoReceipts(['ticket-1'])).toEqual([]);
  });

  it('sends the ids it was given, with a timeout signal', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ data: {} }));
    await fetchExpoReceipts(['a', 'b']);
    const [, init] = fetchMock.mock.calls[0];
    expect(JSON.parse(init.body)).toEqual({ ids: ['a', 'b'] });
    expect(init).toMatchObject({ signal: expect.anything() });
  });

  it('chunks at the documented 1000-id cap', async () => {
    fetchMock.mockImplementation(async (_url: string, init: { body: string }) => {
      const { ids } = JSON.parse(init.body) as { ids: string[] };
      return jsonResponse({ data: Object.fromEntries(ids.map((id) => [id, { status: 'ok' }])) });
    });
    const outcomes = await fetchExpoReceipts(Array.from({ length: 2500 }, (_, i) => `t${i}`));
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(outcomes).toHaveLength(2500);
  });

  it('does not call the service at all when there is nothing to ask about', async () => {
    expect(await fetchExpoReceipts([])).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
