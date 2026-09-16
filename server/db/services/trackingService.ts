/**
 * Tracking Service
 * Handles public patient tracking (no authentication required)
 */

import { repositories } from '../repositories/index.js';
import { executeQuery, executeQueryOne } from '../connection.js';
import { getClinicBusinessDate, isClinicSlotStarted } from './clinicTime.js';
import { getPublicTrackingEstimatedWaitMinutes, QueueService } from './queueService.js';

export interface TrackingResult {
  clinic: string;
  doctor: string;
  token: string;
  status: string;
  patientsAhead: number;
  estimatedWaitMinutes: number;
  estimatedConsultationTime: string;
  estimatedConsultationMinutes: number;
  doctorStatus: string;
  delayMinutes: number;
  appointmentSlot?: string;
  appointmentDate?: string;
  currentlyServingToken?: string;
}

export const calculatePatientsAhead = (
  tokens: Array<{ sequenceNumber: number; status: string }>,
  currentSequenceNumber: number,
): number => tokens.filter((token) => (
  token.status === 'WAITING'
  && token.sequenceNumber < currentSequenceNumber
)).length;

export const isValidTrackingId = (trackingId: string): boolean => /^(?=.*[A-Za-z_-])[A-Za-z0-9_-]{8,128}$/.test(String(trackingId || '').trim());

export class TrackingService {
  /**
   * Get public tracking information using the patient's mobile number.
   * This endpoint intentionally returns queue status only.
   */
  async getPublicTrackingByTrackingId(trackingId: string): Promise<TrackingResult | null> {
    const normalizedTrackingId = String(trackingId || '').trim();
    if (!isValidTrackingId(normalizedTrackingId)) {
      return null;
    }

    const sql = `
      SELECT
        c.name AS clinic_name,
        d.name AS doctor_name,
        t.token_number,
        t.status,
        t.sequence_number,
        t.called_at,
        t.consultation_duration_seconds,
        c.doctor_status,
        c.delay_minutes,
        c.avg_consultation_minutes,
        c.operating_hours,
        d.available_hours AS doctor_available_hours,
        a.scheduled_slot AS appointment_slot,
        a.scheduled_time AS scheduled_time,
        t.session_id,
        t.clinic_id,
        t.doctor_id,
        s.date AS session_date,
        c.timezone
      FROM patients p
      JOIN tokens t ON t.patient_id = p.id
      JOIN sessions s ON s.id = t.session_id
      JOIN clinics c ON c.id = t.clinic_id
      JOIN doctors d ON d.id = t.doctor_id
      LEFT JOIN appointments a ON a.tracking_id = p.tracking_id
      WHERE p.tracking_id = ?
      ORDER BY p.created_at DESC LIMIT 20
    `;

    const candidates = await executeQuery<any>(sql, [normalizedTrackingId]);
    const result = candidates.find((candidate) =>
      getClinicBusinessDate(new Date(candidate.session_date), candidate.timezone) === getClinicBusinessDate(new Date(), candidate.timezone)
    );
    if (!result) return null;

    await new QueueService().syncDoctorStatusForEmptyQueue(result.clinic_id, result.doctor_id, new Date());

    // Position counts only waiting patients; an active consultation is shown separately.
    const aheadResult = await executeQueryOne<{ count: number }>(
      `SELECT COUNT(*) AS count FROM tokens 
       WHERE clinic_id = ? AND session_id = ? AND doctor_id = ? 
      AND scheduled_slot = ? AND status = 'WAITING'
      AND sequence_number < ?`,
          [result.clinic_id, result.session_id, result.doctor_id, result.appointment_slot || '', result.sequence_number]
    );
    const patientsAhead = Number(aheadResult?.count || 0);

    const servingResult = await executeQueryOne<{ token_number: string }>(
      `SELECT token_number FROM tokens
       WHERE clinic_id = ? AND session_id = ? AND doctor_id = ? AND scheduled_slot = ?
         AND status IN ('IN_CONSULTATION', 'SERVING')
       ORDER BY called_at ASC, sequence_number ASC
       LIMIT 1`,
      [result.clinic_id, result.session_id, result.doctor_id, result.appointment_slot || '']
    );

    // Get average consultation duration from recent completed tokens
    const completedResult = await executeQuery<{ consultation_duration_seconds: number }>(
      `SELECT consultation_duration_seconds FROM tokens 
       WHERE clinic_id = ? AND session_id = ? AND doctor_id = ? 
        AND status = ? AND consultation_duration_seconds > 0
        ORDER BY completed_at DESC LIMIT 5`,
          [result.clinic_id, result.session_id, result.doctor_id, 'COMPLETED']
    );
    
    const durations = completedResult
      .map(item => Number(item.consultation_duration_seconds) / 60)
      .filter(value => Number.isFinite(value) && value > 0);
    
    const averageMinutes = durations.length
      ? durations.reduce((sum, value) => sum + value, 0) / durations.length
      : 5;

    // Calculate elapsed time for currently serving patient
    const activeStates = ['IN_CONSULTATION', 'SERVING'];
    const calledAt = result.called_at ? Date.parse(result.called_at) : NaN;
    const elapsedMinutes = Number.isFinite(calledAt) 
      ? Math.max(0, (Date.now() - calledAt) / 60000) 
      : 0;
    
    const currentRemaining = activeStates.includes(result.status) 
      ? Math.max(0, averageMinutes - elapsedMinutes) 
      : 0;

    const rawEstimatedWaitMinutes = Math.max(0, Math.round(
      currentRemaining + (patientsAhead * averageMinutes) + (servingResult ? 0 : (Number(result.delay_minutes) || 0))
    ));

    const slotStarted = isClinicSlotStarted(result.appointment_slot, new Date(), result.timezone);
    const effectiveDoctorStatus = slotStarted ? result.doctor_status : 'OUT';
    const estimatedWaitMinutes = getPublicTrackingEstimatedWaitMinutes({
      doctorStatus: effectiveDoctorStatus,
      status: result.status,
      operatingHours: result.operating_hours,
      queueWaitMinutes: rawEstimatedWaitMinutes,
      now: new Date(),
      timezone: result.timezone,
    });
    const scheduledTime = result.scheduled_time ? new Date(result.scheduled_time) : null;
    const slotStart = scheduledTime && Number.isFinite(scheduledTime.getTime()) ? scheduledTime : null;
    const queueEstimatedTime = new Date(Date.now() + estimatedWaitMinutes * 60 * 1000);
    const estimatedTime = !slotStarted && slotStart
      ? new Date(slotStart.getTime() + rawEstimatedWaitMinutes * 60 * 1000)
      : slotStart
        ? new Date(Math.max(queueEstimatedTime.getTime(), slotStart.getTime()))
        : queueEstimatedTime;
    const estimatedConsultationTime = new Intl.DateTimeFormat('en-IN', {
      timeZone: result.timezone || 'Asia/Kolkata',
      hour: 'numeric',
      minute: '2-digit',
    }).format(estimatedTime);
    const appointmentDate = scheduledTime && Number.isFinite(scheduledTime.getTime())
      ? new Intl.DateTimeFormat('en-IN', {
          timeZone: result.timezone || 'Asia/Kolkata',
          weekday: 'short',
          day: 'numeric',
          month: 'short',
        }).format(scheduledTime)
      : undefined;

    // Map status for public display
    const publicStatus = result.status === 'SERVING' ? 'IN_CONSULTATION' : result.status;

    return {
      clinic: result.clinic_name,
      doctor: /^Dr\.\s*/i.test(result.doctor_name)
        ? result.doctor_name
        : `Dr. ${result.doctor_name}`,
      token: result.token_number,
      status: publicStatus,
      patientsAhead,
      estimatedWaitMinutes,
      estimatedConsultationTime,
      estimatedConsultationMinutes: Math.max(1, Math.round(averageMinutes)),
      doctorStatus: effectiveDoctorStatus,
      delayMinutes: servingResult ? 0 : (Number(result.delay_minutes) || 0),
      appointmentSlot: result.appointment_slot || undefined,
      appointmentDate,
      currentlyServingToken: servingResult?.token_number || undefined,
    };
  }

  async getPublicTrackingByPhone(phone: string): Promise<TrackingResult | null> {
    const normalizedPhone = phone.replace(/\D/g, '').replace(/^91/, '').slice(-10);
    if (!/^\d{10}$/.test(normalizedPhone)) return null;
    const candidates = await executeQuery<any>(
      `SELECT p.tracking_id FROM patients p
       WHERE p.phone IN (?, ?, ?)
       ORDER BY p.created_at DESC LIMIT 20`,
      [normalizedPhone, `+91${normalizedPhone}`, `91${normalizedPhone}`]
    );
    const currentBooking = candidates.find((candidate) => candidate.tracking_id);
    return currentBooking ? this.getPublicTrackingByTrackingId(currentBooking.tracking_id) : null;
  }
}

export const trackingService = new TrackingService();