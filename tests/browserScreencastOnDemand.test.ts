import assert from 'node:assert/strict';
import { BrowserSessionService } from '../src/server/services/browserSessionService';

const service = BrowserSessionService as any;
const original = {
  sessions: service.sessions,
  latestFrames: service.latestFrames,
  frameBroadcasters: service.frameBroadcasters
};

try {
  let cdpCalls: string[] = [];
  let listenerCount = 0;

  const mockCdp = {
    send: async (cmd: string, args?: any) => {
      cdpCalls.push(cmd);
      return {};
    },
    on: (event: string, handler: any) => {
      if (event === 'Page.screencastFrame') listenerCount++;
    },
    removeAllListeners: (event: string) => {
      if (event === 'Page.screencastFrame') listenerCount = 0;
    }
  };

  const mockSession = {
    type: 'upload',
    page: { isClosed: () => false },
    cdp: mockCdp,
    currentUrl: 'https://merch.amazon.com',
    title: 'Amazon',
    isStreaming: false
  };

  service.sessions = new Map([['upload', mockSession]]);

  // 1. Initial state
  assert.equal(mockSession.isStreaming, false, 'Session must not stream initially');
  assert.equal(listenerCount, 0, 'No listeners registered initially');

  // 2. Start screencast
  await BrowserSessionService.startScreencast('upload');
  assert.equal(mockSession.isStreaming, true, 'isStreaming must be true after start');
  assert.equal(listenerCount, 1, 'Exactly one screencast listener registered');
  assert.deepEqual(cdpCalls, ['Page.startScreencast'], 'Page.startScreencast sent to CDP');

  // 3. Duplicate start must be a no-op
  await BrowserSessionService.startScreencast('upload');
  assert.equal(listenerCount, 1, 'Duplicate start must not add additional listener');
  assert.equal(cdpCalls.length, 1, 'Duplicate start must not send Page.startScreencast again');

  // 4. Stop screencast
  await BrowserSessionService.stopScreencast('upload');
  assert.equal(mockSession.isStreaming, false, 'isStreaming must be false after stop');
  assert.equal(listenerCount, 0, 'Screencast listener must be removed');
  assert.deepEqual(cdpCalls, ['Page.startScreencast', 'Page.stopScreencast'], 'Page.stopScreencast sent to CDP');

  // 5. Duplicate stop must be a no-op
  await BrowserSessionService.stopScreencast('upload');
  assert.equal(cdpCalls.length, 2, 'Duplicate stop must not send Page.stopScreencast again');

  // 6. Restarting screencast after stop works seamlessly
  await BrowserSessionService.startScreencast('upload');
  assert.equal(mockSession.isStreaming, true, 'isStreaming must be true after restart');
  assert.equal(listenerCount, 1, 'Screencast listener re-registered');
  assert.equal(cdpCalls[2], 'Page.startScreencast', 'Page.startScreencast sent again');

  // 7. Closing session page stops screencast
  let pageClosed = false;
  mockSession.page.close = async () => { pageClosed = true; };
  await BrowserSessionService.closeSessionPage('upload');
  assert.equal(mockSession.isStreaming, false, 'closeSessionPage must stop screencast');
  assert.equal(cdpCalls[3], 'Page.stopScreencast', 'Page.stopScreencast sent during closeSessionPage');
  assert.equal(pageClosed, true, 'Page close called');

  console.log('PASS: on-demand screencast lifecycle, duplicate prevention, and clean teardown');
} finally {
  Object.assign(service, original);
}
