import assert from 'node:assert/strict';
import { BrowserSessionService } from '../src/server/services/browserSessionService';
import { subscribeBrowserStream } from '../src/server/services/browserStreamSubscription';

// Exercise the production replay path with already-running, completely idle pages.
// No Chromium, navigation, profile, network or persistent application data is used.
const service = BrowserSessionService as any;
const original = {
  sessions: service.sessions,
  latestFrames: service.latestFrames,
  frameBroadcasters: service.frameBroadcasters
};
try {
  const subscriptions = new WeakMap<object, 'sync' | 'upload'>();
  let currentViewer = {};
  const received: string[] = [];
  const syncPage = { isClosed: () => false };
  const uploadPage = { isClosed: () => false };
  service.sessions = new Map([
    ['sync', { page: syncPage }],
    ['upload', { page: uploadPage }]
  ]);
  service.latestFrames = new Map([
    ['sync', { data: 'idle-sync', metadata: {} }],
    ['upload', { data: 'idle-upload', metadata: {} }]
  ]);
  service.frameBroadcasters = [(session: 'sync' | 'upload', data: string) => {
    if (subscriptions.get(currentViewer) === session) received.push(data);
  }];
  const watch = (session: string) => subscribeBrowserStream(
    subscriptions, currentViewer, session, type => BrowserSessionService.getSession(type)
  );

  await watch('sync');
  assert.deepEqual(received, ['idle-sync'], 'Initial subscription must receive an idle frame');
  // Simulate closing the viewer and opening a new WebSocket, without any CDP event.
  currentViewer = {};
  await watch('sync');
  await watch('upload');
  await watch('sync');
  assert.deepEqual(received, ['idle-sync', 'idle-sync', 'idle-upload', 'idle-sync']);
  assert.equal(service.sessions.get('sync').page, syncPage, 'Sync must keep running');
  assert.equal(service.sessions.get('upload').page, uploadPage, 'Upload must keep running');
  assert.equal(service.sessions.size, 2, 'Watching must not replace or close background pages');
  console.log('PASS: initial attach, reopen, session switching and background-page preservation');
} finally {
  Object.assign(service, original);
}
