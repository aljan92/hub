import assert from 'node:assert/strict';
import { getUploadFitPolicy } from '../src/server/services/uploadFitPolicy';

for (const fitDiscoveryStatus of ['SUCCESS', 'FAILED', undefined]) {
  assert.deepEqual(getUploadFitPolicy({ fitTypes: [], fitDiscoveryStatus }), { required: false, blocked: false });
}
assert.deepEqual(getUploadFitPolicy({ fitTypes: [{ id: 'women' }], fitDiscoveryStatus: 'FAILED' }), { required: true, blocked: true });
assert.deepEqual(getUploadFitPolicy({ fitTypes: [{ id: 'women' }], fitDiscoveryStatus: 'SUCCESS' }), { required: true, blocked: false });
console.log('PASS: empty catalog skips fits for every scan status; existing fits retain scan guard');
