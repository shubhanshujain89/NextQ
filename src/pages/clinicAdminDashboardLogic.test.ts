import test from 'node:test';
import assert from 'node:assert/strict';

import { getDashboardTabs } from './clinicAdminDashboardLogic.js';

test('clinic admin dashboard excludes website-content tab', () => {
  const tabs = getDashboardTabs('clinic-admin');
  assert.ok(!tabs.some((tab) => tab.key === 'content'));
  assert.ok(tabs.some((tab) => tab.key === 'clinics'));
});

test('site admin dashboard includes website-content tab', () => {
  const tabs = getDashboardTabs('site-admin');
  assert.ok(tabs.some((tab) => tab.key === 'content'));
  assert.deepEqual(tabs.find((tab) => tab.key === 'barcode-inventory'), {
    key: 'barcode-inventory',
    label: 'QR Code Inventory',
  });
  assert.ok(tabs.some((tab) => tab.key === 'audit'));
});
