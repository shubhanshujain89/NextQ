/**
 * Token Repository
 * Handles all token/queue-related database operations
 */

import { BaseRepository } from './base.js';
import { executeQuery, executeQueryOne, executeTransaction } from '../connection.js';
import crypto from 'crypto';

export interface Token {
  id: string;
  clinicId: string;
  sessionId: string;
  doctorId: string;
  tokenNumber: string;
  sequenceNumber: number;
  scheduledSlot?: string;
  patientId?: string;
  patientName: string;
  patientPhone: string;
  patientAge?: number;
  patientGender?: 'Male' | 'Female' | 'Other';
  tokenType: 'ONLINE' | 'WALK_IN' | 'EMERGENCY';
  status: 'WAITING' | 'CALLED' | 'IN_CONSULTATION' | 'SERVING' | 'COMPLETED' | 'HOLD' | 'CANCELLED' | 'NO_SHOW';
  isEmergency: boolean;
  isHold: boolean;
  priority: number;
  amountPaid: number;
  paymentMode?: string;
  paymentMethod?: string;
  paymentStatus: 'PENDING' | 'PAID' | 'FAILED' | 'REFUNDED';
  createdAt: Date;
  calledAt?: Date;
  completedAt?: Date;
  consultationDurationSeconds?: number;
  preConsultationNotes?: any;
  weight?: string;
  temperature?: string;
  oxygenSaturation?: string;
  bloodPressure?: string;
  triageNotes?: string;
  doctorNotes?: string;
  whatsappSentCount: number;
  whatsappLastSentAt?: Date;
}

export class TokenRepository extends BaseRepository<Token> {
  protected tableName = 'tokens';
  protected primaryKey = 'id';

  protected mapRowToEntity(row: any): Token {
    return {
      id: row.id,
      clinicId: row.clinic_id,
      sessionId: row.session_id,
      doctorId: row.doctor_id,
      tokenNumber: row.token_number,
      sequenceNumber: row.sequence_number,
      scheduledSlot: row.scheduled_slot || undefined,
      patientId: row.patient_id,
      patientName: row.patient_name,
      patientPhone: row.patient_phone,
      patientAge: row.patient_age,
      patientGender: row.patient_gender,
      tokenType: row.token_type,
      status: row.status,
      isEmergency: row.token_type === 'EMERGENCY' || Boolean(row.is_vip),
      isHold: Boolean(row.is_hold),
      priority: row.priority,
      amountPaid: parseFloat(row.amount_paid),
      paymentMode: row.payment_mode,
      paymentMethod: row.payment_method,
      paymentStatus: row.payment_status,
      createdAt: new Date(row.created_at),
      calledAt: row.called_at ? new Date(row.called_at) : undefined,
      completedAt: row.completed_at ? new Date(row.completed_at) : undefined,
      consultationDurationSeconds: row.consultation_duration_seconds,
      preConsultationNotes: row.pre_consultation_notes
        ? typeof row.pre_consultation_notes === 'string'
          ? JSON.parse(row.pre_consultation_notes)
          : row.pre_consultation_notes
        : undefined,
      weight: row.weight,
      temperature: row.temperature,
      oxygenSaturation: row.oxygen_saturation,
      bloodPressure: row.blood_pressure,
      triageNotes: row.triage_notes,
      doctorNotes: row.doctor_notes,
      whatsappSentCount: row.whatsapp_sent_count,
      whatsappLastSentAt: row.whatsapp_last_sent_at ? new Date(row.whatsapp_last_sent_at) : undefined,
    };
  }

  protected mapEntityToColumns(entity: Partial<Token>): Record<string, any> {
    const columns: Record<string, any> = {};
    
    if (entity.id !== undefined) columns.id = entity.id;
    if (entity.clinicId !== undefined) columns.clinic_id = entity.clinicId;
    if (entity.sessionId !== undefined) columns.session_id = entity.sessionId;
    if (entity.doctorId !== undefined) columns.doctor_id = entity.doctorId;
    if (entity.tokenNumber !== undefined) columns.token_number = entity.tokenNumber;
    if (entity.sequenceNumber !== undefined) columns.sequence_number = entity.sequenceNumber;
    if (entity.scheduledSlot !== undefined) columns.scheduled_slot = entity.scheduledSlot;
    if (entity.patientId !== undefined) columns.patient_id = entity.patientId;
    if (entity.patientName !== undefined) columns.patient_name = entity.patientName;
    if (entity.patientPhone !== undefined) columns.patient_phone = entity.patientPhone;
    if (entity.patientAge !== undefined) columns.patient_age = entity.patientAge;
    if (entity.patientGender !== undefined) columns.patient_gender = entity.patientGender;
    if (entity.tokenType !== undefined) columns.token_type = entity.tokenType;
    if (entity.status !== undefined) columns.status = entity.status;
    if (entity.isEmergency !== undefined) columns.is_vip = entity.isEmergency ? 1 : 0;
    if (entity.isHold !== undefined) columns.is_hold = entity.isHold ? 1 : 0;
    if (entity.priority !== undefined) columns.priority = entity.priority;
    if (entity.amountPaid !== undefined) columns.amount_paid = entity.amountPaid;
    if (entity.paymentMode !== undefined) columns.payment_mode = entity.paymentMode;
    if (entity.paymentMethod !== undefined) columns.payment_method = entity.paymentMethod;
    if (entity.paymentStatus !== undefined) columns.payment_status = entity.paymentStatus;
    if (entity.calledAt !== undefined) columns.called_at = entity.calledAt instanceof Date ? entity.calledAt : entity.calledAt;
    if (entity.completedAt !== undefined) columns.completed_at = entity.completedAt instanceof Date ? entity.completedAt : entity.completedAt;
    if (entity.consultationDurationSeconds !== undefined) columns.consultation_duration_seconds = entity.consultationDurationSeconds;
    if (entity.preConsultationNotes !== undefined) columns.pre_consultation_notes = JSON.stringify(entity.preConsultationNotes);
    if (entity.weight !== undefined) columns.weight = entity.weight;
    if (entity.temperature !== undefined) columns.temperature = entity.temperature;
    if (entity.oxygenSaturation !== undefined) columns.oxygen_saturation = entity.oxygenSaturation;
    if (entity.bloodPressure !== undefined) columns.blood_pressure = entity.bloodPressure;
    if (entity.triageNotes !== undefined) columns.triage_notes = entity.triageNotes;
    if (entity.doctorNotes !== undefined) columns.doctor_notes = entity.doctorNotes;
    if (entity.whatsappSentCount !== undefined) columns.whatsapp_sent_count = entity.whatsappSentCount;
    if (entity.whatsappLastSentAt !== undefined) columns.whatsapp_last_sent_at = entity.whatsappLastSentAt instanceof Date ? entity.whatsappLastSentAt : entity.whatsappLastSentAt;
    
    return columns;
  }

  /**
   * Find tokens by clinic ID
   */
  async findByClinicId(clinicId: string): Promise<Token[]> {
    return this.findAll({ 
      where: { clinic_id: clinicId },
      orderBy: 'sequence_number',
      orderDirection: 'ASC'
    });
  }

  /**
   * Find tokens by session ID
   */
  async findBySessionId(sessionId: string): Promise<Token[]> {
    return this.findAll({ 
      where: { session_id: sessionId },
      orderBy: 'sequence_number',
      orderDirection: 'ASC'
    });
  }

  async getCollectedRevenueByClinicAndSession(clinicId: string, sessionId: string): Promise<number> {
    const row = await executeQueryOne<{ total: number | string | null }>(
      `SELECT COALESCE(SUM(
         CASE
           WHEN t.status IN ('CANCELLED', 'NO_SHOW') THEN 0
           WHEN t.payment_status = 'PAID' THEN
             CASE
               WHEN t.amount_paid > 0 AND t.payment_mode = 'PAY_NOW' THEN GREATEST(t.amount_paid - 25, 0)
               WHEN t.amount_paid > 0 THEN t.amount_paid
               ELSE c.consultation_fee
             END
           WHEN t.status = 'COMPLETED' THEN c.consultation_fee
           ELSE 0
         END
       ), 0) AS total
       FROM \`tokens\` t
       JOIN \`clinics\` c ON c.id = t.clinic_id
       WHERE t.clinic_id = ? AND t.session_id = ?`,
      [clinicId, sessionId]
    );
    return Number(row?.total || 0);
  }

  /**
   * Find tokens by doctor ID and session ID
   */
  async findByDoctorAndSession(doctorId: string, sessionId: string): Promise<Token[]> {
    const sql = `
      SELECT t.*, a.scheduled_slot
      FROM \`tokens\` t
      LEFT JOIN \`appointments\` a
        ON a.session_id = t.session_id
       AND a.doctor_id = t.doctor_id
       AND a.token_number = t.token_number
      WHERE t.doctor_id = ? AND t.session_id = ?
      ORDER BY t.sequence_number ASC
    `;
    return this.query(sql, [doctorId, sessionId]);
  }

  async restoreAutoCancelledScheduledTokens(sessionId: string): Promise<void> {
    await executeQuery(
      `UPDATE \`tokens\` t
       JOIN \`appointments\` a ON a.session_id = t.session_id AND a.token_number = t.token_number
       SET t.status = 'WAITING', t.is_hold = 0, a.status = 'scheduled', a.updated_at = ?
       WHERE t.session_id = ? AND t.status = 'CANCELLED' AND a.status = 'cancelled'`,
      [new Date(), sessionId]
    );
  }

  /**
   * Find waiting tokens for a doctor/session
   */
  async findWaitingByDoctorAndSession(doctorId: string, sessionId: string): Promise<Token[]> {
    const sql = `
      SELECT * FROM \`tokens\`
      WHERE doctor_id = ? AND session_id = ? AND status IN ('WAITING', 'CALLED', 'IN_CONSULTATION', 'SERVING')
      ORDER BY priority ASC, sequence_number ASC
    `;
    return this.query(sql, [doctorId, sessionId]);
  }

  /**
   * Find token by patient ID
   */
  async findByPatientId(patientId: string): Promise<Token | null> {
    return this.findOne({ patient_id: patientId });
  }

  /**
   * Get next token sequence number for a doctor/session/clinic combination
   * Uses a transaction to ensure atomicity for concurrent bookings
   */
  async getNextTokenSequence(clinicId: string, sessionId: string, doctorId: string, date: Date): Promise<number> {
    const sql = `
      SELECT COALESCE(MAX(sequence_number), 0) as max_sequence
      FROM \`tokens\`
      WHERE clinic_id = ? AND session_id = ? AND doctor_id = ?
    `;
    
    void date;
    const result = await executeQueryOne<{ max_sequence: number }>(sql, [clinicId, sessionId, doctorId]);
    return (result?.max_sequence || 0) + 1;
  }

  /**
   * Create token with atomic sequence generation in a transaction
   * This prevents race conditions when multiple bookings happen simultaneously
   */
  async createWithSequence(data: Omit<Token, 'id' | 'createdAt' | 'tokenNumber' | 'sequenceNumber'>): Promise<Token> {
    return executeTransaction(async (connection) => {
      // Get next sequence number atomically
      const [seqResult] = await connection.execute(
        `SELECT COALESCE(MAX(sequence_number), 0) as max_sequence
         FROM \`tokens\`
         WHERE clinic_id = ? AND session_id = ? AND doctor_id = ?`,
        [data.clinicId, data.sessionId, data.doctorId]
      );
      const sequenceNumber = (seqResult as any[])[0]?.max_sequence + 1 || 1;
      
      // Generate token number (e.g., A-001, A-002)
      const tokenNumber = `A-${String(sequenceNumber).padStart(3, '0')}`;
      
      // Create token
      const id = crypto.randomUUID();
      const now = new Date();
      
      await connection.execute(
        `INSERT INTO \`tokens\` 
         (id, clinic_id, session_id, doctor_id, token_number, sequence_number, patient_id, patient_name, patient_phone, patient_age, patient_gender, token_type, status, is_vip, is_hold, priority, amount_paid, payment_mode, payment_method, payment_status, created_at, pre_consultation_notes)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          id, data.clinicId, data.sessionId, data.doctorId, tokenNumber, sequenceNumber,
          data.patientId, data.patientName, data.patientPhone, data.patientAge, data.patientGender,
          data.tokenType, data.status, data.isEmergency ? 1 : 0, data.isHold ? 1 : 0, data.priority,
          data.amountPaid, data.paymentMode, data.paymentMethod, data.paymentStatus, now,
          data.preConsultationNotes ? JSON.stringify(data.preConsultationNotes) : null
        ]
      );
      
      const token = await this.findById(id);
      if (!token) {
        throw new Error('Failed to create token');
      }
      
      return token;
    });
  }

  /**
   * Update token status
   */
  async updateStatus(id: string, status: Token['status'], additionalData?: Partial<Token>): Promise<Token | null> {
    const updates: Partial<Token> = { status, ...additionalData };
    
    // Set timestamps based on status
    if (status === 'CALLED' || status === 'IN_CONSULTATION' || status === 'SERVING') {
      updates.calledAt = new Date();
    }
    if (status === 'COMPLETED') {
      updates.completedAt = new Date();
    }
    
    return this.update(id, updates);
  }

  /**
   * Call next token (mark as CALLED)
   */
  async callNextToken(doctorId: string, sessionId: string): Promise<Token | null> {
    return executeTransaction(async (connection) => {
      const [rows] = await connection.execute(
        `SELECT * FROM \`tokens\`
         WHERE doctor_id = ? AND session_id = ? AND status IN ('WAITING', 'CALLED', 'IN_CONSULTATION', 'SERVING')
           AND NOT EXISTS (
             SELECT 1 FROM appointments a
             WHERE a.tracking_id = (SELECT p.tracking_id FROM patients p WHERE p.id = tokens.patient_id)
               AND a.scheduled_time > CURRENT_TIMESTAMP
           )
         ORDER BY priority ASC, sequence_number ASC
         LIMIT 1
         FOR UPDATE`,
        [doctorId, sessionId]
      );
      const nextToken = (rows as any[])[0];
      if (!nextToken || nextToken.status !== 'WAITING') return null;

      await connection.execute(
        `UPDATE \`tokens\` SET status = 'CALLED', called_at = CURRENT_TIMESTAMP WHERE id = ? AND status = 'WAITING'`,
        [nextToken.id]
      );

      return this.mapRowToEntity(nextToken);
    });
  }

  /**
   * Get queue statistics for a doctor/session
   */
  async getQueueStats(doctorId: string, sessionId: string): Promise<{
    waiting: number;
    serving: number;
    completed: number;
    total: number;
  }> {
    const sql = `
      SELECT 
        SUM(CASE WHEN status IN ('WAITING', 'CALLED') THEN 1 ELSE 0 END) as waiting,
        SUM(CASE WHEN status IN ('IN_CONSULTATION', 'SERVING') THEN 1 ELSE 0 END) as serving,
        SUM(CASE WHEN status = 'COMPLETED' THEN 1 ELSE 0 END) as completed,
        COUNT(*) as total
      FROM \`tokens\`
      WHERE doctor_id = ? AND session_id = ?
    `;
    
    const result = await executeQueryOne<{
      waiting: number;
      serving: number;
      completed: number;
      total: number;
    }>(sql, [doctorId, sessionId]);
    
    return {
      waiting: result?.waiting || 0,
      serving: result?.serving || 0,
      completed: result?.completed || 0,
      total: result?.total || 0,
    };
  }

  async getClinicQueueStats(clinicId: string, sessionId: string): Promise<{
    waiting: number;
    serving: number;
    completed: number;
    total: number;
  }> {
    const sql = `
      SELECT
        SUM(CASE WHEN status IN ('WAITING', 'CALLED') THEN 1 ELSE 0 END) as waiting,
        SUM(CASE WHEN status IN ('IN_CONSULTATION', 'SERVING') THEN 1 ELSE 0 END) as serving,
        SUM(CASE WHEN status = 'COMPLETED' THEN 1 ELSE 0 END) as completed,
        COUNT(*) as total
      FROM \`tokens\`
      WHERE clinic_id = ? AND session_id = ?
    `;
    const result = await executeQueryOne<{
      waiting: number;
      serving: number;
      completed: number;
      total: number;
    }>(sql, [clinicId, sessionId]);
    return {
      waiting: result?.waiting || 0,
      serving: result?.serving || 0,
      completed: result?.completed || 0,
      total: result?.total || 0,
    };
  }

  /**
   * Get average consultation duration for completed tokens
   */
  async getAverageConsultationDuration(doctorId: string, sessionId: string, limit: number = 5): Promise<number> {
    const sql = `
      SELECT consultation_duration_seconds
      FROM \`tokens\`
      WHERE doctor_id = ? AND session_id = ? AND status = 'COMPLETED' AND consultation_duration_seconds > 0
      ORDER BY completed_at DESC
      LIMIT ?
    `;
    
    const rows = await executeQuery<{ consultation_duration_seconds: number }>(sql, [doctorId, sessionId, limit]);
    const durations = rows.map(r => r.consultation_duration_seconds / 60).filter(d => d > 0);
    
    if (durations.length === 0) return 5; // Default 5 minutes per waiting patient
    
    return durations.reduce((sum, d) => sum + d, 0) / durations.length;
  }
}

export const tokenRepository = new TokenRepository();