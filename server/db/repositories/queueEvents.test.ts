import test from 'node:test';
import assert from 'node:assert/strict';
import { QueueEventRepository } from './queueEvents.js';

class TestQueueEventRepository extends QueueEventRepository {
  mapRow(row: any) {
    return this.mapRowToEntity(row);
  }
}

const baseRow = {
  id: 'event-1',
  clinic_id: 'clinic-1',
  token_id: 'token-1',
  patient_id: 'patient-1',
  event_type: 'CANCELLED',
  created_at: '2026-09-15T13:17:09.746Z',
};

test('maps JSON strings in queue event details', () => {
  const details = { reason: 'PATIENT_NOT_PRESENT' };
  const event = new TestQueueEventRepository().mapRow({
    ...baseRow,
    details: JSON.stringify(details),
  });

  assert.deepEqual(event.details, details);
});

test('preserves queue event details already decoded by the database driver', () => {
  const details = { reason: 'PATIENT_NOT_PRESENT' };
  const event = new TestQueueEventRepository().mapRow({ ...baseRow, details });

  assert.strictEqual(event.details, details);
});