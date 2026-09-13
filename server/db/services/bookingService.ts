/**
 * Booking Service
 * Handles patient booking business logic
 */

import { repositories } from '../repositories/index.js';
import { executeTransaction } from '../connection.js';
import type mysql from 'mysql2/promise';
import type { Session } from '../repositories/sessions.js';
import crypto from 'crypto';
import { assertActiveClinicPlan } from './planService.js';
import { getClinicBusinessDate, getClinicDateTimeUtc, getClinicLocalMinutes, getSlotEndMinutes } from './clinicTime.js';

export interface BookingInput {
  clinicId: string;
  doctorId: string;
  patientName: string;
  phone: string;
  age?: number;
  reason?: string;
  appointmentSlot?: string;
  appointmentDate?: string;
  amountPaid?: number;
  paymentMode?: 'PAY_NOW' | 'PAY_AT_CLINIC';
  paymentMethod?: string;
  paymentStatus?: 'PENDING' | 'PAID';
}

export interface BookingResult {
  trackingId: string;
  tokenId: string;
  tokenNumber: string;
  sequenceNumber: number;
  sessionId: string;
  clinicId: string;
  doctorId: string;
  tokenType: 'ONLINE' | 'WALK_IN' | 'EMERGENCY';
  clinicName: string;
  doctorName: string;
}

export const isSameClinicBusinessDate = (appointmentDate: string | undefined, businessDate: string): boolean =>
  !appointmentDate || appointmentDate === businessDate;

export const isBookingSlotAvailable = (
  availableHours: string,
  appointmentSlot: string,
  now = new Date(),
  timezone = 'Asia/Kolkata',
): boolean => {
  const requestedSlot = String(appointmentSlot || '').trim();
  const configuredSlots = String(availableHours || '').split(',').map((slot) => slot.trim()).filter(Boolean);
  const configuredSlot = configuredSlots.find((slot) => slot.toLowerCase() === requestedSlot.toLowerCase());
  if (!configuredSlot) return false;

  const endMinutes = getSlotEndMinutes(configuredSlot);
  return endMinutes !== null && getClinicLocalMinutes(now, timezone) < endMinutes;
};

export class BookingService {
  /**
   * Atomically get or create today's active session for a clinic.
   * Runs inside a transaction (the passed connection) with FOR UPDATE locking
   * so concurrent bookings cannot both create a duplicate session.
   */
  private async getOrCreateSession(
    connection: mysql.PoolConnection,
    clinicId: string,
    todayDate: string
  ): Promise<Session> {
    const [existingRows] = await connection.execute(
      `SELECT * FROM \`sessions\`
       WHERE clinic_id = ? AND status = 'ACTIVE' AND date = ?
       LIMIT 1 FOR UPDATE`,
      [clinicId, todayDate]
    );
    const existing = (existingRows as any[])[0];
    if (existing) return existing;

    // No active session — create one. If two requests race, one INSERT will
    // fail with a duplicate-key error on uk_sessions_clinic_date and retry.
    const sessionId = crypto.randomUUID();
    try {
      await connection.execute(
        `INSERT INTO \`sessions\` (id, clinic_id, date, status, total_tokens_issued, rolling_avg_minutes, completed_count, total_revenue)
         VALUES (?, ?, ?, 'ACTIVE', 0, 8, 0, 0)
         ON DUPLICATE KEY UPDATE id = LAST_INSERT_ID(id)`,
        [sessionId, clinicId, todayDate]
      );
    } catch (error: any) {
      const message = error?.message || String(error);
      if (message.includes('Duplicate')) {
        const [retryRows] = await connection.execute(
          `SELECT * FROM \`sessions\`
           WHERE clinic_id = ? AND status = 'ACTIVE' AND date = ? LIMIT 1`,
          [clinicId, todayDate]
        );
        const retry = (retryRows as any[])[0];
        if (retry) return retry;
      }
      throw error;
    }

    await connection.execute(
      `UPDATE \`clinics\` SET active_session_id = ? WHERE id = ?`,
      [sessionId, clinicId]
    );

    const [createdRows] = await connection.execute(
      `SELECT * FROM \`sessions\` WHERE id = ? LIMIT 1`,
      [sessionId]
    );
    const created = (createdRows as any[])[0];
    if (!created) throw new Error('Failed to create session');
    return created;
  }

  /**
   * Create a public booking (patient self-booking)
   */
  async createPublicBooking(input: BookingInput): Promise<BookingResult> {
    // Validate clinic exists
    const clinic = await repositories.clinics.findById(input.clinicId);
    if (!clinic) {
      throw new Error('Clinic not found');
    }
    assertActiveClinicPlan(clinic);

    // Validate doctor exists and is active
    const doctor = await repositories.doctors.findById(input.doctorId);
    if (!doctor || doctor.clinicId !== input.clinicId || doctor.status !== 'active') {
      throw new Error('Doctor not available');
    }

    const today = new Date();
    const businessDate = getClinicBusinessDate(today, clinic.timezone);
    if (!isSameClinicBusinessDate(input.appointmentDate, businessDate)) {
      throw new Error('Bookings are currently available for today only.');
    }
    if (!input.appointmentSlot || !isBookingSlotAvailable(doctor.availableHours || '', input.appointmentSlot, today, clinic.timezone)) {
      throw new Error('This appointment slot is no longer available. Please choose another timing.');
    }
    const normalizedPhone = input.phone.replace(/\D/g, '').replace(/^91/, '').slice(-10);
    if (!/^\d{10}$/.test(normalizedPhone)) {
      throw new Error('Enter a valid 10-digit mobile number.');
    }

    // Create patient, token, session (if needed), and appointment in a transaction
    return executeTransaction(async (connection) => {
      await connection.execute('SELECT id FROM `clinics` WHERE id = ? FOR UPDATE', [input.clinicId]);
      const [existingPatientRows] = await connection.execute(
        `SELECT p.id
         FROM \`patients\` p
         JOIN \`tokens\` t ON t.patient_id = p.id
         JOIN \`sessions\` s ON s.id = t.session_id
         WHERE RIGHT(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(p.phone, ' ', ''), '+', ''), '-', ''), '(', ''), ')', ''), 10) = ?
           AND p.clinic_id = ?
           AND t.clinic_id = ?
           AND s.date = ?
         LIMIT 1`,
        [normalizedPhone, input.clinicId, input.clinicId, businessDate]
      );
      if ((existingPatientRows as any[]).length > 0) {
        throw new Error('A booking is already registered for this mobile number today.');
      }

      const session = await this.getOrCreateSession(connection, input.clinicId, businessDate);

      // Generate tracking ID
      const trackingId = crypto.randomBytes(9).toString('base64url');
      const patientId = crypto.randomUUID();
      const tokenId = crypto.randomUUID();
      const now = new Date();
      const scheduledTime = getClinicDateTimeUtc(input.appointmentDate, input.appointmentSlot, clinic.timezone) || now;

      // The clinic row lock serializes bookings before calculating MAX + 1.
      const [seqResult] = await connection.execute(
        `SELECT COALESCE(MAX(sequence_number), 0) as max_sequence
         FROM \`tokens\`
         WHERE clinic_id = ? AND session_id = ? AND doctor_id = ?`,
        [input.clinicId, session.id, input.doctorId]
      );
      const sequenceNumber = (seqResult as any[])[0]?.max_sequence + 1 || 1;
      const tokenNumber = `A-${String(sequenceNumber).padStart(3, '0')}`;

      // Create patient
      await connection.execute(
        `INSERT INTO \`patients\` (id, clinic_id, tracking_id, name, phone, age, gender, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [patientId, input.clinicId, trackingId, input.patientName.trim(), `+91${normalizedPhone}`, input.age || null, null, now, now]
      );

      // Create token
      await connection.execute(
        `INSERT INTO \`tokens\` 
         (id, clinic_id, session_id, doctor_id, token_number, sequence_number, patient_id, patient_name, patient_phone, patient_age, token_type, status, is_vip, is_hold, priority, amount_paid, payment_mode, payment_method, payment_status, created_at, pre_consultation_notes)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          tokenId, input.clinicId, session.id, input.doctorId, tokenNumber, sequenceNumber,
          patientId, input.patientName.trim(), `+91${normalizedPhone}`, input.age || null,
          'ONLINE', 'WAITING', 0, 0, 10, Number(input.amountPaid || 0), input.paymentMode || 'PAY_AT_CLINIC', input.paymentMethod || 'PAY_AT_CLINIC', input.paymentStatus === 'PAID' ? 'PAID' : 'PENDING', now,
          input.reason?.trim() ? JSON.stringify({ symptoms: input.reason.trim() }) : null
        ]
      );

      // Create appointment
      await connection.execute(
        `INSERT INTO \`appointments\` 
         (id, clinic_id, doctor_id, session_id, tracking_id, patient_name, patient_phone, patient_age, visit_reason, appointment_type, token_number, token_sequence, scheduled_slot, status, scheduled_time, estimated_time, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          crypto.randomUUID(), input.clinicId, input.doctorId, session.id, trackingId,
          input.patientName.trim(), `+91${normalizedPhone}`, input.age || null, input.reason?.trim() || null,
          'ONLINE', tokenNumber, sequenceNumber, input.appointmentSlot || null, 'scheduled', scheduledTime, scheduledTime, now, now
        ]
      );

      // Update session token count
      await connection.execute(
        `UPDATE \`sessions\` SET total_tokens_issued = total_tokens_issued + 1, updated_at = ? WHERE id = ?`,
        [now, session.id]
      );

      return {
        trackingId,
        tokenId,
        tokenNumber,
        sequenceNumber,
        sessionId: session.id,
        clinicId: input.clinicId,
        doctorId: input.doctorId,
        tokenType: 'ONLINE',
        clinicName: clinic.name,
        doctorName: doctor.name,
      };
    });
  }

  /**
   * Create a walk-in token (receptionist booking)
   */
  async createWalkInToken(input: BookingInput & { tokenType: 'WALK_IN' | 'EMERGENCY' }): Promise<BookingResult> {
    // Similar to public booking but with different token type
    const clinic = await repositories.clinics.findById(input.clinicId);
    if (!clinic) throw new Error('Clinic not found');

    const doctor = await repositories.doctors.findById(input.doctorId);
    if (!doctor || doctor.clinicId !== input.clinicId || doctor.status !== 'active') {
      throw new Error('Doctor not available');
    }

    const today = new Date();
    const businessDate = getClinicBusinessDate(today, clinic.timezone);

    return executeTransaction(async (connection) => {
      const session = await this.getOrCreateSession(connection, input.clinicId, businessDate);
      const trackingId = crypto.randomBytes(9).toString('base64url');
      const patientId = crypto.randomUUID();
      const tokenId = crypto.randomUUID();
      const now = new Date();
      await connection.execute('SELECT id FROM `clinics` WHERE id = ? FOR UPDATE', [input.clinicId]);
      const [seqResult] = await connection.execute(
        `SELECT COALESCE(MAX(sequence_number), 0) as max_sequence
         FROM \`tokens\`
         WHERE clinic_id = ? AND session_id = ? AND doctor_id = ?`,
        [input.clinicId, session.id, input.doctorId]
      );
      const sequenceNumber = (seqResult as any[])[0]?.max_sequence + 1 || 1;
      
      const prefix = input.tokenType === 'EMERGENCY' ? 'E' : 'W';
      const tokenNumber = `${prefix}-${String(sequenceNumber).padStart(3, '0')}`;

      await connection.execute(
        `INSERT INTO \`patients\` (id, clinic_id, tracking_id, name, phone, age, gender, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [patientId, input.clinicId, trackingId, input.patientName.trim(), input.phone.trim(), input.age || null, null, now, now]
      );

      await connection.execute(
        `INSERT INTO \`tokens\` 
         (id, clinic_id, session_id, doctor_id, token_number, sequence_number, patient_id, patient_name, patient_phone, patient_age, token_type, status, is_vip, is_hold, priority, amount_paid, payment_mode, payment_method, payment_status, created_at, pre_consultation_notes)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          tokenId, input.clinicId, session.id, input.doctorId, tokenNumber, sequenceNumber,
          patientId, input.patientName.trim(), input.phone.trim(), input.age || null,
          input.tokenType, 'WAITING', 0, 0,
          input.tokenType === 'EMERGENCY' ? 1 : 10, Number(doctor.consultationFee || 0), 'PAY_AT_CLINIC', 'CASH', 'PAID', now,
          input.reason?.trim() ? JSON.stringify({ symptoms: input.reason.trim() }) : null
        ]
      );

      await connection.execute(
        `INSERT INTO \`appointments\` 
         (id, clinic_id, doctor_id, session_id, tracking_id, patient_name, patient_phone, patient_age, visit_reason, appointment_type, token_number, token_sequence, status, scheduled_time, estimated_time, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          crypto.randomUUID(), input.clinicId, input.doctorId, session.id, trackingId,
          input.patientName.trim(), input.phone.trim(), input.age || null, input.reason?.trim() || null,
          input.tokenType, tokenNumber, sequenceNumber, 'scheduled', now, now, now, now
        ]
      );

      await connection.execute(
        `UPDATE \`sessions\` SET total_tokens_issued = total_tokens_issued + 1, updated_at = ? WHERE id = ?`,
        [now, session.id]
      );

      return {
        trackingId,
        tokenId,
        tokenNumber,
        sequenceNumber,
        sessionId: session.id,
        clinicId: input.clinicId,
        doctorId: input.doctorId,
        tokenType: input.tokenType,
        clinicName: clinic.name,
        doctorName: doctor.name,
      };
    });
  }
}

export const bookingService = new BookingService();