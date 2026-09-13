import test from 'node:test';
import assert from 'node:assert/strict';

import { normalizeQrCodeValue, normalizeQrStatus, buildQrPublicUrl } from './qrInventory.js';

test('QR code values are normalized to NEXTQ identifiers', () => {
  assert.equal(normalizeQrCodeValue(' nq-8f4k2p '), 'NQ-8F4K2P');
  assert.equal(normalizeQrCodeValue('https://nextq.in/q/NQ-8F4K2P'), 'NQ-8F4K2P');
  assert.equal(normalizeQrCodeValue(''), 'NQ-0001');
});

test('QR inventory status values normalize to supported states', () => {
  assert.equal(normalizeQrStatus('UNASSIGNED'), 'AVAILABLE');
  assert.equal(normalizeQrStatus('ASSIGNED'), 'ASSIGNED');
  assert.equal(normalizeQrStatus('AVAILABLE', 'doctor-42'), 'ASSIGNED');
  assert.equal(normalizeQrStatus('DISABLED', 'doctor-42'), 'DISABLED');
  assert.equal(normalizeQrStatus('disabled'), 'DISABLED');
});

test('public QR URLs are stable and use the permanent code only', () => {
  const publicUrl = buildQrPublicUrl('NQ-8F4K2P', 'https://nextq.in');
  assert.equal(publicUrl, 'https://nextq.in/q/NQ-8F4K2P');
});
