/**
 * Queue Service
 * Handles active queue management operations
 */

import { repositories } from '../repositories/index.js';
import type { Token } from '../repositories/tokens.js';
import { executeQuery, executeQueryOne, executeTransaction } from '../connection.js';
import { getClinicLocalMinutes, getClinicTimezone, getSlotEndMinutes } from './clinicTime.js';

export interface QueueStats {
  waiting: number;
  serving: number;
  completed: number;
  total: number;
}

export interface TokenWithDetails {
  id: string;
  tokenNumber: string;
  sequenceNumber: number;
  patientName: string;
  patientPhone: string;
  patientAge?: number;
  tokenType: Token['tokenType'];
  status: Token['status'];
  isEmergency: boolean;
  isHold: boolean;
  priority: number;
  amountPaid: number;
  paymentMode?: Token['paymentMode'];
  paymentMethod?: Token['paymentMethod'];
  paymentStatus: Token['paymentStatus'];
  createdAt: Date;
  calledAt?: Date;
  completedAt?: Date;
  consultationDurationSeconds?: number;
  preConsultationNotes?: any;
  doctorNotes?: string;
}

export interface CalledTokenResult {
  id: string;
  clinicId: string;
  sessionId: string;
  doctorId: string;
  tokenNumber: string;
  status: Token['status'];
  patientName: string;
}

export interface CompletedTokenResult {
  id: string;
  clinicId: string;
  sessionId: string;
  doctorId: string;
  tokenNumber: string;
  status: Token['status'];
  completedAt: Date;
  consultationDurationSeconds: number;
  nextTokenNumber?: string;
}

export interface CancelledTokenResult {
  id: string;
  tokenNumber: string;
  patientName: string;
  status: 'CANCELLED';
}

export interface QueueTokenActionResult {
  id: string;
  clinicId: string;
  sessionId: string;
  doctorId: string;
  tokenNumber: string;
  status: Token['status'];
  isEmergency: boolean;
  isHold: boolean;
  priority: number;
}

export const calculateConsultationDurationSeconds = (
  calledAt: Date | string | number | null | undefined,
  completedAt: Date | string | number | null | undefined,
): number => {
  const calledMs = calledAt ? new Date(calledAt).getTime() : Number.NaN;
  const completedMs = completedAt ? new Date(completedAt).getTime() : Number.NaN;

  if (!Number.isFinite(calledMs) || !Number.isFinite(completedMs)) {
    return 480;
  }

  const elapsedSeconds = Math.floor((completedMs - calledMs) / 1000);
  return Math.min(Math.max(1, elapsedSeconds), 60 * 60);
};

export const calculateAverageConsultationMinutes = (durationsSeconds: Array<number | string>): number => {
  const normalized = durationsSeconds
    .map((value) => Number(value))
    .filter((value) => Number.isFinite(value) && value > 0)
    .map((value) => value / 60);

  if (!normalized.length) return 10;

  const total = normalized.reduce((sum, value) => sum + value, 0);
  return Number((total / normalized.length).toFixed(1));
};

export const estimateQueueWaitMinutes = ({
  patientsAhead,
  activeTokenElapsedMinutes,
  averageConsultationMinutes,
  delayMinutes,
  status,
}: {
  patientsAhead: number;
  activeTokenElapsedMinutes: number;
  averageConsultationMinutes: number;
  delayMinutes: number;
  status: string;
}): number => {
  if (status === 'COMPLETED') return 0;

  const activeRemaining = ['CALLED', 'IN_CONSULTATION', 'SERVING'].includes(status)
    ? Math.max(0, averageConsultationMinutes - activeTokenElapsedMinutes)
    : 0;

  return Math.max(0, Math.round(activeRemaining + (patientsAhead * averageConsultationMinutes) + delayMinutes));
};

export const shouldAutoMarkDoctorOut = ({
  operatingHours,
  hasQueuePatients,
  now = new Date(),
}: {
  operatingHours?: string;
  hasQueuePatients: boolean;
  now?: Date;
}): boolean => {
  if (hasQueuePatients) return false;

  const matches = Array.from(
    String(operatingHours || '').matchAll(/(\d{1,2}:\d{2})\s*(AM|PM)?\s*-\s*(\d{1,2}:\d{2})\s*(AM|PM)?/gi)
  );
  if (!matches.length) return false;

  const lastMatch = matches[matches.length - 1];
  if (!lastMatch) return false;

  const parseTime = (time: string, meridiem?: string) => {
    const match = time.match(/^(\d{1,2}):(\d{2})$/);
    if (!match) return 0;

    let hours = Number(match[1]);
    const minutes = Number(match[2]);
    const normalizedMeridiem = String(meridiem || '').toUpperCase();

    if (normalizedMeridiem === 'PM' && hours < 12) hours += 12;
    if (normalizedMeridiem === 'AM' && hours === 12) hours = 0;

    return hours * 60 + minutes;
  };

  const openMinutes = parseTime(lastMatch[1], lastMatch[2]);
  const closeMinutes = parseTime(lastMatch[3], lastMatch[4]);
  const normalizedClose = closeMinutes <= openMinutes ? closeMinutes + (24 * 60) : closeMinutes;
  const minuteOfDay = now.getHours() * 60 + now.getMinutes();

  return minuteOfDay >= normalizedClose;
};

const parseTimeStringToMinutes = (timeText: string, meridiem?: string): number => {
  const normalized = String(timeText || '').trim();
  if (!normalized) return 0;

  const match = normalized.match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return 0;

  let hours = Number(match[1]);
  const minutes = Number(match[2]);
  const suffix = String(meridiem || '').toUpperCase();

  if (suffix === 'PM' && hours < 12) hours += 12;
  if (suffix === 'AM' && hours === 12) hours = 0;

  return hours * 60 + minutes;
};

const parseClinicOperatingWindows = (operatingHours?: string): Array<{ openMinutes: number; closeMinutes: number }> => {
  if (!operatingHours || /24\s*hours/i.test(operatingHours) || /open\s*24/i.test(operatingHours)) {
    return [];
  }

  const matches = Array.from(
    operatingHours.matchAll(/(\d{1,2}:\d{2})\s*(AM|PM)?\s*-\s*(\d{1,2}:\d{2})\s*(AM|PM)?/gi)
  );

  return matches
    .map((match) => {
      const openMinutes = parseTimeStringToMinutes(match[1], match[2]);
      const closeMinutes = parseTimeStringToMinutes(match[3], match[4]);
      return {
        openMinutes,
        closeMinutes: closeMinutes <= openMinutes ? closeMinutes + (24 * 60) : closeMinutes,
      };
    })
    .filter((window) => window.openMinutes > 0 || window.closeMinutes > 0)
    .sort((left, right) => left.openMinutes - right.openMinutes);
};

const getMinutesInTimezone = (now: Date, timezone?: string): number => {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: getClinicTimezone(timezone),
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(now);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return Number(values.hour || 0) * 60 + Number(values.minute || 0);
};

export const adjustWaitForClinicSchedule = ({
  queueWaitMinutes,
  operatingHours,
  now = new Date(),
  timezone,
}: {
  queueWaitMinutes: number;
  operatingHours?: string;
  now?: Date;
  timezone?: string;
}): number => {
  const parsedWindows = parseClinicOperatingWindows(operatingHours);
  if (!parsedWindows.length) return Math.max(0, Math.round(queueWaitMinutes));

  const nowMinutes = getMinutesInTimezone(now, timezone);
  const activeWindow = parsedWindows.find((window) => nowMinutes >= window.openMinutes && nowMinutes < window.closeMinutes);
  if (activeWindow) {
    return Math.max(0, Math.round(queueWaitMinutes));
  }

  const nextWindow = parsedWindows.find((window) => window.openMinutes > nowMinutes);
  const nextOpenMinutes = nextWindow?.openMinutes ?? parsedWindows[0].openMinutes + (24 * 60);
  return Math.max(0, Math.round(queueWaitMinutes + (nextOpenMinutes - nowMinutes)));
};

export const getPublicTrackingEstimatedWaitMinutes = ({
  doctorStatus,
  status,
  operatingHours,
  queueWaitMinutes,
  now = new Date(),
  timezone,
  patientsAhead,
  averageConsultationMinutes,
  delayMinutes,
}: {
  doctorStatus?: string;
  status?: string;
  operatingHours?: string;
  queueWaitMinutes: number;
  now?: Date;
  timezone?: string;
  patientsAhead?: number;
  averageConsultationMinutes?: number;
  delayMinutes?: number;
}): number => {
  void patientsAhead;
  void averageConsultationMinutes;
  void delayMinutes;

  const isConsultationActive = doctorStatus === 'IN' && ['CALLED', 'IN_CONSULTATION', 'SERVING'].includes(String(status || ''));

  if (!isConsultationActive) {
    return adjustWaitForClinicSchedule({
      queueWaitMinutes: Math.max(0, Math.round(queueWaitMinutes)),
      operatingHours,
      now,
      timezone,
    });
  }

  return Math.max(0, Math.round(queueWaitMinutes));
};

export class QueueService {
  /**
   * Get all tokens for a doctor/session with details
   */
  async getQueueTokens(doctorId: string, sessionId: string): Promise<TokenWithDetails[]> {
    const tokens = await repositories.tokens.findByDoctorAndSession(doctorId, sessionId);
    return tokens.map(t => ({
      id: t.id,
      tokenNumber: t.tokenNumber,
      sequenceNumber: t.sequenceNumber,
      patientName: t.patientName,
      patientPhone: t.patientPhone,
      patientAge: t.patientAge,
      tokenType: t.tokenType,
      status: t.status,
      isEmergency: t.isEmergency,
      isHold: t.isHold,
      priority: t.priority,
      amountPaid: t.amountPaid,
      paymentMode: t.paymentMode,
      paymentMethod: t.paymentMethod,
      paymentStatus: t.paymentStatus,
      createdAt: t.createdAt,
      calledAt: t.calledAt,
      completedAt: t.completedAt,
      consultationDurationSeconds: t.consultationDurationSeconds,
      preConsultationNotes: t.preConsultationNotes,
      doctorNotes: t.doctorNotes,
    }));
  }

  /**
   * Get queue statistics
   */
  async getQueueStats(doctorId: string, sessionId: string): Promise<QueueStats> {
    return repositories.tokens.getQueueStats(doctorId, sessionId);
  }

  async markPaymentPaidForClinic(tokenId: string, clinicId: string): Promise<TokenWithDetails | null> {
    const token = await repositories.tokens.findById(tokenId);
    if (!token || token.clinicId !== clinicId || ['CANCELLED', 'NO_SHOW'].includes(token.status)) return null;

    const clinic = await repositories.clinics.findById(clinicId);
    if (!clinic) return null;

    const updatedToken = await repositories.tokens.update(tokenId, {
      amountPaid: Number(clinic.consultationFee || 0),
      paymentMode: 'PAY_AT_CLINIC',
      paymentMethod: 'CASH',
      paymentStatus: 'PAID',
    });
    if (!updatedToken) return null;

    return (await this.getQueueTokens(updatedToken.doctorId, updatedToken.sessionId))
      .find((queueToken) => queueToken.id === updatedToken.id) || null;
  }

  /**
   * Call next token in queue
   */
  async callNextToken(doctorId: string, sessionId: string): Promise<TokenWithDetails | null> {
    const token = await repositories.tokens.callNextToken(doctorId, sessionId);
    if (!token) return null;

    // Log queue event
    await repositories.queueEvents.logEvent({
      clinicId: token.clinicId,
      tokenId: token.id,
      eventType: 'TOKEN_CALLED',
      details: { tokenNumber: token.tokenNumber, sequenceNumber: token.sequenceNumber },
    });

    return {
      id: token.id,
      tokenNumber: token.tokenNumber,
      sequenceNumber: token.sequenceNumber,
      patientName: token.patientName,
      patientPhone: token.patientPhone,
      patientAge: token.patientAge,
      tokenType: token.tokenType,
      status: token.status,
      isEmergency: token.isEmergency,
      isHold: token.isHold,
      priority: token.priority,
      amountPaid: token.amountPaid,
      paymentMode: token.paymentMode,
      paymentMethod: token.paymentMethod,
      paymentStatus: token.paymentStatus,
      createdAt: token.createdAt,
      calledAt: token.calledAt,
      completedAt: token.completedAt,
      consultationDurationSeconds: token.consultationDurationSeconds,
      preConsultationNotes: token.preConsultationNotes,
      doctorNotes: token.doctorNotes,
    };
  }

  async callTokenForClinic(tokenId: string, clinicId: string, doctorId?: string): Promise<CalledTokenResult | null> {
    return executeTransaction(async (connection) => {
      const [tokenRows] = await connection.execute(
        `SELECT t.id, t.clinic_id, t.session_id, t.doctor_id, t.token_number,
          t.scheduled_slot, t.status, t.patient_name
         FROM \`tokens\` t
         JOIN \`sessions\` s ON s.id = t.session_id
         WHERE t.id = ? AND t.clinic_id = ? AND s.clinic_id = ? AND s.status = 'ACTIVE'
           AND NOT EXISTS (
             SELECT 1 FROM appointments a
             WHERE a.tracking_id = (SELECT p.tracking_id FROM patients p WHERE p.id = t.patient_id)
                 AND a.scheduled_time > CURRENT_TIMESTAMP
           )
         FOR UPDATE`,
        [tokenId, clinicId, clinicId]
      );
      const token = (tokenRows as any[])[0];
      if (!token || (doctorId && token.doctor_id !== doctorId) || token.status !== 'WAITING') return null;

      // Serialize calls for this doctor. Locking the doctor row also covers the
      // no-active-token case, where a token-row lock alone cannot prevent a race.
      await connection.execute(
        'SELECT id FROM `doctors` WHERE id = ? AND clinic_id = ? FOR UPDATE',
        [token.doctor_id, clinicId]
      );

      const [activeRows] = await connection.execute(
         `SELECT id FROM \`tokens\`
         WHERE clinic_id = ? AND session_id = ? AND doctor_id = ?
           AND scheduled_slot = ?
           AND status IN ('CALLED', 'IN_CONSULTATION', 'SERVING')
         LIMIT 1`,
        [clinicId, token.session_id, token.doctor_id, token.scheduled_slot || '']
      );
      if ((activeRows as any[]).length > 0) return null;

      const [updateResult] = await connection.execute(
        `UPDATE \`tokens\`
         SET status = 'CALLED', called_at = CURRENT_TIMESTAMP
         WHERE id = ? AND clinic_id = ? AND session_id = ? AND status = 'WAITING'`,
        [tokenId, clinicId, token.session_id]
      );
      if ((updateResult as any).affectedRows !== 1) return null;

      return {
        id: token.id,
        clinicId: token.clinic_id,
        sessionId: token.session_id,
        doctorId: token.doctor_id,
        tokenNumber: token.token_number,
        status: 'CALLED',
        patientName: token.patient_name,
      };
    });
  }

  async startTokenForClinic(tokenId: string, clinicId: string, doctorId?: string): Promise<CalledTokenResult | null> {
    return executeTransaction(async (connection) => {
      const [tokenRows] = await connection.execute(
        `SELECT t.id, t.clinic_id, t.session_id, t.doctor_id, t.token_number,
                t.status, t.patient_name
         FROM \`tokens\` t
         JOIN \`sessions\` s ON s.id = t.session_id
         WHERE t.id = ? AND t.clinic_id = ? AND s.clinic_id = ? AND s.status = 'ACTIVE'
         FOR UPDATE`,
        [tokenId, clinicId, clinicId]
      );
      const token = (tokenRows as any[])[0];
      if (!token || (doctorId && token.doctor_id !== doctorId) || token.status !== 'CALLED') return null;

      const [updateResult] = await connection.execute(
        `UPDATE \`tokens\`
         SET status = 'IN_CONSULTATION', called_at = CURRENT_TIMESTAMP
         WHERE id = ? AND clinic_id = ? AND session_id = ? AND status = 'CALLED'`,
        [tokenId, clinicId, token.session_id]
      );
      if ((updateResult as any).affectedRows !== 1) return null;

      await connection.execute(
        `UPDATE \`clinics\` SET delay_minutes = 0, delay_reason = '' WHERE id = ?`,
        [clinicId]
      );

      return {
        id: token.id,
        clinicId: token.clinic_id,
        sessionId: token.session_id,
        doctorId: token.doctor_id,
        tokenNumber: token.token_number,
        status: 'IN_CONSULTATION',
        patientName: token.patient_name,
      };
    });
  }

  async completeTokenForClinic(
    tokenId: string,
    clinicId: string,
    doctorId?: string,
    doctorNotes = ''
  ): Promise<CompletedTokenResult | null> {
    return executeTransaction(async (connection) => {
      const [tokenRows] = await connection.execute(
        `SELECT t.id, t.clinic_id, t.session_id, t.doctor_id, t.token_number,
          t.status, t.called_at,
          TIMESTAMPDIFF(SECOND, t.called_at, CURRENT_TIMESTAMP) AS elapsed_seconds
         FROM \`tokens\` t
         JOIN \`sessions\` s ON s.id = t.session_id
         WHERE t.id = ? AND t.clinic_id = ? AND s.clinic_id = ? AND s.status = 'ACTIVE'
         FOR UPDATE`,
        [tokenId, clinicId, clinicId]
      );
      const token = (tokenRows as any[])[0];
      if (!token || (doctorId && token.doctor_id !== doctorId) || token.status !== 'IN_CONSULTATION') return null;

      const elapsedSeconds = Number(token.elapsed_seconds);
      const consultationDurationSeconds = Number.isFinite(elapsedSeconds) && elapsedSeconds >= 0
        ? calculateConsultationDurationSeconds(token.called_at, new Date())
        : 480;
      const [updateResult] = await connection.execute(
        `UPDATE \`tokens\`
         SET status = 'COMPLETED', completed_at = CURRENT_TIMESTAMP,
             consultation_duration_seconds = ?, doctor_notes = ?
         WHERE id = ? AND clinic_id = ? AND session_id = ? AND status = 'IN_CONSULTATION'`,
        [consultationDurationSeconds, doctorNotes, tokenId, clinicId, token.session_id]
      );
      if ((updateResult as any).affectedRows !== 1) return null;

      const [durationRows] = await connection.execute(
        `SELECT consultation_duration_seconds
         FROM \`tokens\`
         WHERE clinic_id = ? AND session_id = ? AND doctor_id = ?
           AND status = 'COMPLETED' AND consultation_duration_seconds > 0
         ORDER BY completed_at DESC LIMIT 5`,
        [clinicId, token.session_id, token.doctor_id]
      );
      const durations = (durationRows as any[]).map((row) => Number(row.consultation_duration_seconds));
      const rollingAverage = calculateAverageConsultationMinutes(durations);

      const [nextRows] = await connection.execute(
        `SELECT id, token_number
         FROM \`tokens\`
         WHERE clinic_id = ? AND session_id = ? AND doctor_id = ? AND status = 'WAITING'
         ORDER BY priority ASC, sequence_number ASC
         LIMIT 1
         FOR UPDATE`,
        [clinicId, token.session_id, token.doctor_id]
      );
      const nextToken = (nextRows as any[])[0];
      // Do NOT auto-advance the next token to SERVING — the doctor/receptionist
      // explicitly calls the next patient when ready.
      await connection.execute(
        `UPDATE \`clinics\` SET avg_consultation_minutes = ? WHERE id = ?`,
        [rollingAverage, clinicId]
      );

      await this.syncDoctorStatusForEmptyQueue(clinicId, doctorId, new Date());

      return {
        id: token.id,
        clinicId: token.clinic_id,
        sessionId: token.session_id,
        doctorId: token.doctor_id,
        tokenNumber: token.token_number,
        status: 'COMPLETED',
        completedAt: new Date(),
        consultationDurationSeconds,
        nextTokenNumber: nextToken?.token_number,
      };
    });
  }

  async syncDoctorStatusForEmptyQueue(clinicId: string, doctorId?: string, now = new Date()): Promise<boolean> {
    const clinic = await executeQueryOne<{ operating_hours: string; doctor_status: string; timezone?: string }>(
      `SELECT operating_hours, doctor_status, timezone FROM clinics WHERE id = ?`,
      [clinicId]
    );
    if (!clinic || ['OUT', 'ON_BREAK', 'EMERGENCY'].includes(clinic.doctor_status)) {
      return false;
    }

    const queueQuery = `
      SELECT COUNT(*) AS total
      FROM tokens
      WHERE clinic_id = ?
        AND status IN ('WAITING', 'CALLED', 'IN_CONSULTATION', 'SERVING')
        ${doctorId ? 'AND doctor_id = ?' : ''}
    `;
    const params = doctorId ? [clinicId, doctorId] : [clinicId];
    const queueResult = await executeQueryOne<{ total: number }>(queueQuery, params);
    const hasQueuePatients = Number(queueResult?.total || 0) > 0;

    const doctorQuery = doctorId
      ? 'SELECT available_hours FROM doctors WHERE id = ? AND clinic_id = ?'
      : 'SELECT available_hours FROM doctors WHERE clinic_id = ? AND status = \'active\'';
    const doctorParams = doctorId ? [doctorId, clinicId] : [clinicId];
    const doctors = await executeQuery<{ available_hours?: string }>(doctorQuery, doctorParams);
    const timingEnds = doctors
      .flatMap((doctor) => String(doctor.available_hours || '').split(',').map((slot) => getSlotEndMinutes(slot.trim())))
      .filter((endMinutes): endMinutes is number => endMinutes !== null);
    const clinicMinutes = getClinicLocalMinutes(now, getClinicTimezone(clinic.timezone));
    const timingsCompleted = timingEnds.length > 0 && timingEnds.every((endMinutes) => clinicMinutes >= endMinutes);

    if (hasQueuePatients || !timingsCompleted) {
      return false;
    }

    await executeQuery(
      `UPDATE clinics SET doctor_status = 'OUT', updated_at = CURRENT_TIMESTAMP WHERE id = ? AND doctor_status <> 'OUT'`,
      [clinicId]
    );
    return true;
  }

  async syncAllDoctorStatuses(now = new Date()): Promise<void> {
    const clinics = await executeQuery<{ id: string }>(
      `SELECT id FROM clinics WHERE doctor_status = 'IN'`
    );
    for (const clinic of clinics) {
      await this.syncDoctorStatusForEmptyQueue(clinic.id, undefined, now);
    }
  }

  async cancelTokenForClinic(
    tokenId: string,
    clinicId: string,
    doctorId?: string,
  ): Promise<CancelledTokenResult | null> {
    return executeTransaction(async (connection) => {
      const [tokenRows] = await connection.execute(
        `SELECT t.id, t.token_number, t.patient_name, t.doctor_id, t.status, t.session_id
         FROM \`tokens\` t
         JOIN \`sessions\` s ON s.id = t.session_id
         WHERE t.id = ? AND t.clinic_id = ? AND s.clinic_id = ?
         FOR UPDATE`,
        [tokenId, clinicId, clinicId]
      );
      const token = (tokenRows as any[])[0];
      if (
        !token ||
        (doctorId && token.doctor_id !== doctorId) ||
        !['WAITING', 'HOLD'].includes(token.status)
      ) return null;

      const [updateResult] = await connection.execute(
        `UPDATE \`tokens\`
         SET status = 'CANCELLED'
         WHERE id = ? AND clinic_id = ? AND session_id = ? AND status IN ('WAITING', 'HOLD')`,
        [tokenId, clinicId, token.session_id]
      );
      if ((updateResult as any).affectedRows !== 1) return null;

      await connection.execute(
        `UPDATE \`appointments\`
         SET status = 'cancelled', updated_at = CURRENT_TIMESTAMP
         WHERE session_id = ? AND token_number = ? AND clinic_id = ?`,
        [token.session_id, token.token_number, clinicId]
      );

      try {
        await repositories.queueEvents.logEventInTransaction(connection, {
          clinicId,
          tokenId: token.id,
          eventType: 'TOKEN_CANCELLED',
          details: { tokenNumber: token.token_number, reason: 'PATIENT_NOT_PRESENT' },
        });
      } catch (error) {
        console.error('Unable to record cancellation event:', error);
      }

      return {
        id: token.id,
        tokenNumber: token.token_number,
        patientName: token.patient_name,
        status: 'CANCELLED',
      };
    });
  }

  async holdTokenForClinic(tokenId: string, clinicId: string, doctorId?: string): Promise<QueueTokenActionResult | null> {
    return executeTransaction(async (connection) => {
      const [tokenRows] = await connection.execute(
        `SELECT t.id, t.clinic_id, t.session_id, t.doctor_id, t.token_number, t.status
         FROM \`tokens\` t
         JOIN \`sessions\` s ON s.id = t.session_id
         WHERE t.id = ? AND t.clinic_id = ? AND s.clinic_id = ? AND s.status = 'ACTIVE'
         FOR UPDATE`,
        [tokenId, clinicId, clinicId]
      );
      const token = (tokenRows as any[])[0];
      if (!token || (doctorId && token.doctor_id !== doctorId) || !['CALLED', 'IN_CONSULTATION', 'SERVING'].includes(token.status)) {
        return null;
      }

      await connection.execute(
        `UPDATE \`tokens\` SET status = 'HOLD', is_hold = 1
         WHERE id = ? AND clinic_id = ? AND session_id = ? AND status IN ('CALLED', 'IN_CONSULTATION', 'SERVING')`,
        [tokenId, clinicId, token.session_id]
      );
      return {
        id: token.id,
        clinicId: token.clinic_id,
        sessionId: token.session_id,
        doctorId: token.doctor_id,
        tokenNumber: token.token_number,
        status: 'HOLD',
        isEmergency: false,
        isHold: true,
        priority: 2,
      };
    });
  }

  async resumeTokenForClinic(tokenId: string, clinicId: string, doctorId?: string): Promise<QueueTokenActionResult | null> {
    return executeTransaction(async (connection) => {
      const [tokenRows] = await connection.execute(
        `SELECT t.id, t.clinic_id, t.session_id, t.doctor_id, t.token_number, t.status, t.is_vip, t.priority
         FROM \`tokens\` t
         JOIN \`sessions\` s ON s.id = t.session_id
         WHERE t.id = ? AND t.clinic_id = ? AND s.clinic_id = ? AND s.status = 'ACTIVE'
         FOR UPDATE`,
        [tokenId, clinicId, clinicId]
      );
      const token = (tokenRows as any[])[0];
      if (!token || (doctorId && token.doctor_id !== doctorId) || token.status !== 'HOLD') return null;

      await connection.execute(
        `UPDATE \`tokens\` SET status = 'WAITING', is_hold = 0, priority = 2
         WHERE id = ? AND clinic_id = ? AND session_id = ? AND status = 'HOLD'`,
        [tokenId, clinicId, token.session_id]
      );
      return {
        id: token.id,
        clinicId: token.clinic_id,
        sessionId: token.session_id,
        doctorId: token.doctor_id,
        tokenNumber: token.token_number,
        status: 'WAITING',
        isEmergency: Boolean(token.is_vip),
        isHold: false,
        priority: 2,
      };
    });
  }

  async promoteEmergencyForClinic(tokenId: string, clinicId: string, doctorId?: string): Promise<QueueTokenActionResult | null> {
    return executeTransaction(async (connection) => {
      const [tokenRows] = await connection.execute(
        `SELECT t.id, t.clinic_id, t.session_id, t.doctor_id, t.token_number, t.status
         FROM \`tokens\` t
         JOIN \`sessions\` s ON s.id = t.session_id
         WHERE t.id = ? AND t.clinic_id = ? AND s.clinic_id = ? AND s.status = 'ACTIVE'
         FOR UPDATE`,
        [tokenId, clinicId, clinicId]
      );
      const token = (tokenRows as any[])[0];
      if (!token || (doctorId && token.doctor_id !== doctorId) || !['WAITING', 'HOLD'].includes(token.status)) return null;

      await connection.execute(
        `UPDATE \`tokens\` SET token_type = 'EMERGENCY', is_vip = 1, priority = 1
         WHERE id = ? AND clinic_id = ? AND session_id = ?`,
        [tokenId, clinicId, token.session_id]
      );
      return {
        id: token.id,
        clinicId: token.clinic_id,
        sessionId: token.session_id,
        doctorId: token.doctor_id,
        tokenNumber: token.token_number,
        status: token.status,
        isEmergency: true,
        isHold: token.status === 'HOLD',
        priority: 1,
      };
    });
  }

  /**
   * Update token status (e.g., start consultation, complete, hold)
   * Validates the state transition to protect the token state machine.
   */
  async updateTokenStatus(
    tokenId: string, 
    status: Token['status'],
    additionalData?: {
      consultationDurationSeconds?: number;
      doctorNotes?: string;
    }
  ): Promise<TokenWithDetails | null> {
    const token = await repositories.tokens.findById(tokenId);
    if (!token) return null;

    const allowedTransitions: Record<Token['status'], Token['status'][]> = {
      WAITING: ['CALLED', 'HOLD', 'CANCELLED', 'NO_SHOW'],
      CALLED: ['IN_CONSULTATION', 'HOLD'],
      IN_CONSULTATION: ['COMPLETED', 'HOLD'],
      SERVING: ['HOLD', 'COMPLETED'],
      HOLD: ['WAITING', 'CALLED'],
      COMPLETED: [],
      CANCELLED: [],
      NO_SHOW: [],
    };
    const permitted = allowedTransitions[token.status] || [];
    // Allow updating an existing status in place (e.g. metadata-only writes).
    if (status !== token.status && !permitted.includes(status)) {
      throw new Error(`Invalid status transition: ${token.status} -> ${status}`);
    }

    const updatedToken = await repositories.tokens.updateStatus(tokenId, status, additionalData);
    if (!updatedToken) return null;

    // Log queue event
    await repositories.queueEvents.logEvent({
      clinicId: updatedToken.clinicId,
      tokenId: updatedToken.id,
      eventType: `TOKEN_${status.toUpperCase()}`,
      details: { 
        tokenNumber: updatedToken.tokenNumber, 
        sequenceNumber: updatedToken.sequenceNumber,
        ...additionalData 
      },
    });

    // If completed, update session stats
    if (status === 'COMPLETED' && additionalData?.consultationDurationSeconds) {
      const session = await repositories.sessions.findById(updatedToken.sessionId);
      if (session) {
        const avgDuration = await repositories.tokens.getAverageConsultationDuration(
          updatedToken.doctorId, 
          updatedToken.sessionId
        );
        await repositories.sessions.updateStats(session.id, avgDuration, updatedToken.amountPaid);
      }
    }

    return {
      id: updatedToken.id,
      tokenNumber: updatedToken.tokenNumber,
      sequenceNumber: updatedToken.sequenceNumber,
      patientName: updatedToken.patientName,
      patientPhone: updatedToken.patientPhone,
      patientAge: updatedToken.patientAge,
      tokenType: updatedToken.tokenType,
      status: updatedToken.status,
      isEmergency: updatedToken.isEmergency,
      isHold: updatedToken.isHold,
      priority: updatedToken.priority,
      amountPaid: updatedToken.amountPaid,
      paymentMode: updatedToken.paymentMode,
      paymentMethod: updatedToken.paymentMethod,
      paymentStatus: updatedToken.paymentStatus,
      createdAt: updatedToken.createdAt,
      calledAt: updatedToken.calledAt,
      completedAt: updatedToken.completedAt,
      consultationDurationSeconds: updatedToken.consultationDurationSeconds,
      preConsultationNotes: updatedToken.preConsultationNotes,
      doctorNotes: updatedToken.doctorNotes,
    };
  }

  /**
   * Get average consultation duration
   */
  async getAverageConsultationDuration(doctorId: string, sessionId: string): Promise<number> {
    return repositories.tokens.getAverageConsultationDuration(doctorId, sessionId);
  }

  /**
   * Reorder queue (change priority/sequence)
   */
  async reorderQueue(tokenId: string, newPriority: number): Promise<TokenWithDetails | null> {
    const token = await repositories.tokens.findById(tokenId);
    if (!token) return null;

    const updatedToken = await repositories.tokens.update(tokenId, { priority: newPriority });
    if (!updatedToken) return null;

    await repositories.queueEvents.logEvent({
      clinicId: updatedToken.clinicId,
      tokenId: updatedToken.id,
      eventType: 'TOKEN_REORDERED',
      details: { tokenNumber: updatedToken.tokenNumber, newPriority },
    });

    return {
      id: updatedToken.id,
      tokenNumber: updatedToken.tokenNumber,
      sequenceNumber: updatedToken.sequenceNumber,
      patientName: updatedToken.patientName,
      patientPhone: updatedToken.patientPhone,
      patientAge: updatedToken.patientAge,
      tokenType: updatedToken.tokenType,
      status: updatedToken.status,
      isEmergency: updatedToken.isEmergency,
      isHold: updatedToken.isHold,
      priority: updatedToken.priority,
      amountPaid: updatedToken.amountPaid,
      paymentMode: updatedToken.paymentMode,
      paymentMethod: updatedToken.paymentMethod,
      paymentStatus: updatedToken.paymentStatus,
      createdAt: updatedToken.createdAt,
      calledAt: updatedToken.calledAt,
      completedAt: updatedToken.completedAt,
      consultationDurationSeconds: updatedToken.consultationDurationSeconds,
      preConsultationNotes: updatedToken.preConsultationNotes,
      doctorNotes: updatedToken.doctorNotes,
    };
  }

  /**
   * Get current running token for a clinic
   */
  async getCurrentRunningToken(clinicId: string): Promise<TokenWithDetails | null> {
    const clinic = await repositories.clinics.findById(clinicId);
    if (!clinic || !clinic.currentRunningTokenId) return null;

    const token = await repositories.tokens.findById(clinic.currentRunningTokenId);
    if (!token) return null;

    return {
      id: token.id,
      tokenNumber: token.tokenNumber,
      sequenceNumber: token.sequenceNumber,
      patientName: token.patientName,
      patientPhone: token.patientPhone,
      patientAge: token.patientAge,
      tokenType: token.tokenType,
      status: token.status,
      isEmergency: token.isEmergency,
      isHold: token.isHold,
      priority: token.priority,
      amountPaid: token.amountPaid,
      paymentMode: token.paymentMode,
      paymentMethod: token.paymentMethod,
      paymentStatus: token.paymentStatus,
      createdAt: token.createdAt,
      calledAt: token.calledAt,
      completedAt: token.completedAt,
      consultationDurationSeconds: token.consultationDurationSeconds,
      preConsultationNotes: token.preConsultationNotes,
      doctorNotes: token.doctorNotes,
    };
  }
}

export const queueService = new QueueService();