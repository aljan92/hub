import type { BrowserSessionType } from './browserSessionService';

/** Subscribe before replaying: an idle page need not produce another CDP frame. */
export async function subscribeBrowserStream<Client extends object>(
  subscriptions: WeakMap<Client, BrowserSessionType>,
  client: Client,
  requestedSession: unknown,
  replaySession: (session: BrowserSessionType) => Promise<unknown>
): Promise<void> {
  const session = requestedSession === 'upload' ? 'upload' : 'sync';
  subscriptions.set(client, session);
  await replaySession(session);
}
