import test from 'node:test';
import assert from 'node:assert/strict';

import { serializeStaffQueueToken } from './responsePolicy.js';
import { isValidTrackingId } from '../db/services/trackingService.js';

const token = {
  id: 'token-1',
  clinicId: 'clinic-1',
  sessionId: 'session-1',
  tokenNumber: 'A-001',
  sequenceNumber: 1,
  patientName: 'Test Patient',
  patientPhone: '9876543210',
  patientAge: 30,
  patientGender: 'Female',
  tokenType: 'ONLINE',
  status: 'WAITING',
  isEmergency: false,
  isHold: false,
  priority: 10,
  amountPaid: 0,
  paymentStatus: 'PENDING',
  createdAt: new Date('2026-09-13T08:00:00Z'),
  preConsultationNotes: { symptoms: 'fever' },
  doctorNotes: 'private clinical note',
  weight: '60 kg',
  temperature: '98 F',
  bloodPressure: '120/80 mmHg',
  oxygenSaturation: '98%',
  triageNotes: 'priority review',
};

test('staff queue DTO redacts clinical details from clinic admins', () => {
  const response = serializeStaffQueueToken(token, 'CLINIC_ADMIN');
  assert.equal(response.patientPhone, undefined);
  assert.equal(response.preConsultationNotes, undefined);
  assert.equal(response.doctorNotes, undefined);
  assert.equal(response.patientName, 'Test Patient');
});

test('doctor queue DTO includes only doctor workflow details', () => {
  const response = serializeStaffQueueToken(token, 'DOCTOR');
  assert.equal(response.patientPhone, '9876543210');
  assert.deepEqual(response.preConsultationNotes, { symptoms: 'fever' });
  assert.equal(response.doctorNotes, 'private clinical note');
  assert.equal(response.whatsappSentCount, undefined);
});

test('tracking requires an opaque booking identifier', () => {
  assert.equal(isValidTrackingId('track_abc12345'), true);
  assert.equal(isValidTrackingId('9876543210'), false);
  assert.equal(isValidTrackingId(''), false);
  assert.equal(isValidTrackingId('phone number'), false);
});