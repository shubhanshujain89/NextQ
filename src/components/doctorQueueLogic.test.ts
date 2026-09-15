import test from 'node:test';
import assert from 'node:assert/strict';

import { getDoctorQueueAction } from './doctorQueueLogic.js';
import { getAverageWaitSummary } from './waitMetrics.js';
import { makeDoctorBookingUrl, extractBookingTokenNumber } from '../lib/doctorQr.js';
import { getEarliestBookingSchedule, resolveLinkedBookingSelection, isDuplicateBookingError } from '../pages/PatientBooking.js';

test('doctor queue action is CALL_NEXT when no consultation is active but a patient is waiting', () => {
  const action = getDoctorQueueAction({
    activeToken: null,
    nextToken: { id: 'tok_2', tokenNumber: 'T-2', patientName: 'Rahul' },
  } as any);

  assert.equal(action, 'CALL_NEXT');
});

test('doctor queue action is COMPLETE_AND_CALL_NEXT when a consultation is active and a next patient exists', () => {
  const action = getDoctorQueueAction({
    activeToken: { id: 'tok_1', tokenNumber: 'T-1', patientName: 'Asha' },
    nextToken: { id: 'tok_2', tokenNumber: 'T-2', patientName: 'Rahul' },
  } as any);

  assert.equal(action, 'COMPLETE_AND_CALL_NEXT');
});

test('doctor queue action is COMPLETE_ONLY when no next patient is waiting', () => {
  const action = getDoctorQueueAction({
    activeToken: { id: 'tok_1', tokenNumber: 'T-1', patientName: 'Asha' },
    nextToken: null,
  } as any);

  assert.equal(action, 'COMPLETE_ONLY');
});

test('doctor QR booking URLs stay clinic-specific and doctor-specific', () => {
  const bookingUrl = makeDoctorBookingUrl('clinic-001', 'doctor-42', 'https://example.com');
  assert.equal(bookingUrl, 'https://example.com/booking?clinicId=clinic-001&doctorId=doctor-42');
});

test('patient booking payloads surface the generated token number for the confirmation screen', () => {
  assert.equal(extractBookingTokenNumber({ tokenNumber: 'A-001' }), 'A-001');
  assert.equal(extractBookingTokenNumber({}), '');
});

test('average wait is hidden until the doctor is checked in', () => {
  const summary = getAverageWaitSummary('OUT', [
    { id: '1', createdAt: '2025-01-01T09:00:00.000Z' },
    { id: '2', createdAt: '2025-01-01T09:05:00.000Z' },
  ] as any);

  assert.equal(summary.averageWaitMinutes, 0);
  assert.equal(summary.label, 'Doctor not in yet');
  assert.equal(summary.suffix, '');
});

test('average wait uses the rolling consultation average per waiting patient', () => {
  const summary = getAverageWaitSummary('IN', [
    { id: '1' },
    { id: '2' },
    { id: '3' },
  ] as any, 7.5);

  assert.equal(summary.averageWaitMinutes, 22.5);
});

test('average wait falls back to five minutes per waiting patient', () => {
  const summary = getAverageWaitSummary('IN', [
    { id: '1' },
    { id: '2' },
  ] as any, 0);

  assert.equal(summary.averageWaitMinutes, 10);
});

test('direct booking links resolve straight to the appointment details step', () => {
  const result = resolveLinkedBookingSelection('demo-clinic-1', 'demo-doctor-1', [
    {
      id: 'demo-clinic-1',
      name: 'NEXTQ Care Clinic',
      address: '12 Green Park, New Delhi',
      phone: '+91 98765 43210',
      email: 'care@nextq.in',
      specializations: ['General Medicine'],
      operatingHours: 'Mon-Sat • 9:00 AM - 8:00 PM',
    },
  ], [
    {
      id: 'demo-doctor-1',
      name: 'Dr. Ananya Verma',
      specialization: 'General Medicine',
      clinicId: 'demo-clinic-1',
      consultationFee: 499,
      availableDays: ['Mon', 'Tue'],
      availableHours: '9:00 AM - 1:00 PM',
      rating: 4.8,
    },
  ]);

  assert.equal(result.step, 'booking');
  assert.equal(result.selectedClinic?.id, 'demo-clinic-1');
  assert.equal(result.selectedDoctor?.id, 'demo-doctor-1');
});

test('doctors unavailable today cannot produce a booking schedule', () => {
  assert.equal(getEarliestBookingSchedule({
    availableDays: ['never'],
    availableHours: '10:00 AM - 11:00 AM',
  }), null);
});

test('duplicate mobile-number booking errors do not trigger a fake local token', () => {
  assert.equal(isDuplicateBookingError('A booking is already registered for this mobile number today.'), true);
  assert.equal(isDuplicateBookingError('Clinic not found'), false);
});
