import { BaseRepository } from './base.js';
import { executeQuery } from '../connection.js';

export type QrCodeStatus = 'AVAILABLE' | 'ASSIGNED' | 'DISABLED';

export interface QrCode {
  id: string;
  code: string;
  label: string;
  notes?: string;
  status: QrCodeStatus;
  clinicId?: string | null;
  doctorId?: string | null;
  assignedAt?: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface QrCodeWithDoctor extends QrCode {
  doctorName?: string | null;
}

export class QrCodeRepository extends BaseRepository<QrCode> {
  protected tableName = 'qr_codes';
  protected primaryKey = 'id';

  protected mapRowToEntity(row: any): QrCode {
    return {
      id: row.id,
      code: row.code,
      label: row.label,
      notes: row.notes || undefined,
      status: row.status,
      clinicId: row.clinic_id || null,
      doctorId: row.doctor_id || null,
      assignedAt: row.assigned_at ? new Date(row.assigned_at) : null,
      createdAt: new Date(row.created_at),
      updatedAt: new Date(row.updated_at),
    };
  }

  protected mapEntityToColumns(entity: Partial<QrCode>): Record<string, any> {
    const columns: Record<string, any> = {};
    if (entity.id !== undefined) columns.id = entity.id;
    if (entity.code !== undefined) columns.code = entity.code;
    if (entity.label !== undefined) columns.label = entity.label;
    if (entity.notes !== undefined) columns.notes = entity.notes;
    if (entity.status !== undefined) columns.status = entity.status;
    if (entity.clinicId !== undefined) columns.clinic_id = entity.clinicId;
    if (entity.doctorId !== undefined) columns.doctor_id = entity.doctorId;
    if (entity.assignedAt !== undefined) columns.assigned_at = entity.assignedAt;
    return columns;
  }

  async findByCode(code: string): Promise<QrCode | null> {
    return this.findOne({ code });
  }

  async findAssignedToDoctor(doctorId: string): Promise<QrCode | null> {
    return this.findOne({ doctor_id: doctorId });
  }

  async findAllWithDoctorNames(): Promise<QrCodeWithDoctor[]> {
    const rows = await executeQuery(
      `SELECT q.*, d.name AS doctor_name
       FROM qr_codes q
       LEFT JOIN doctors d ON d.id = q.doctor_id
       ORDER BY q.updated_at DESC`
    );
    return rows.map((row) => ({ ...this.mapRowToEntity(row), doctorName: row.doctor_name || null }));
  }
}

export const qrCodeRepository = new QrCodeRepository();