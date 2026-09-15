/**
 * Queue Events Repository
 * Handles all queue event logging operations
 */

import crypto from 'crypto';
import type mysql from 'mysql2/promise';
import { BaseRepository } from './base.js';

export interface QueueEvent {
  id: string;
  clinicId: string;
  tokenId?: string;
  patientId?: string;
  eventType: string;
  details?: any;
  createdAt: Date;
}

export class QueueEventRepository extends BaseRepository<QueueEvent> {
  protected tableName = 'queue_events';
  protected primaryKey = 'id';

  protected mapRowToEntity(row: any): QueueEvent {
    return {
      id: row.id,
      clinicId: row.clinic_id,
      tokenId: row.token_id,
      patientId: row.patient_id,
      eventType: row.event_type,
      details: row.details == null
        ? undefined
        : typeof row.details === 'string'
          ? JSON.parse(row.details)
          : row.details,
      createdAt: new Date(row.created_at),
    };
  }

  protected mapEntityToColumns(entity: Partial<QueueEvent>): Record<string, any> {
    const columns: Record<string, any> = {};
    
    if (entity.id !== undefined) columns.id = entity.id;
    if (entity.clinicId !== undefined) columns.clinic_id = entity.clinicId;
    if (entity.tokenId !== undefined) columns.token_id = entity.tokenId;
    if (entity.patientId !== undefined) columns.patient_id = entity.patientId;
    if (entity.eventType !== undefined) columns.event_type = entity.eventType;
    if (entity.details !== undefined) columns.details = JSON.stringify(entity.details);
    
    return columns;
  }

  /**
   * Log a queue event
   */
  async logEvent(data: Omit<QueueEvent, 'id' | 'createdAt'>): Promise<QueueEvent> {
    return this.create(data as any);
  }

  async logEventInTransaction(
    connection: mysql.PoolConnection,
    data: Omit<QueueEvent, 'id' | 'createdAt'>,
  ): Promise<QueueEvent> {
    const id = crypto.randomUUID();
    await connection.execute(
      `INSERT INTO \`queue_events\` (\`id\`, \`clinic_id\`, \`token_id\`, \`patient_id\`, \`event_type\`, \`details\`)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        id,
        data.clinicId,
        data.tokenId ?? null,
        data.patientId ?? null,
        data.eventType,
        data.details == null ? null : JSON.stringify(data.details),
      ],
    );

    return {
      ...data,
      id,
      createdAt: new Date(),
    };
  }

  /**
   * Find events by clinic ID
   */
  async findByClinicId(clinicId: string, limit: number = 100): Promise<QueueEvent[]> {
    return this.findAll({ 
      where: { clinic_id: clinicId },
      orderBy: 'created_at',
      orderDirection: 'DESC',
      limit
    });
  }

  /**
   * Find events by token ID
   */
  async findByTokenId(tokenId: string): Promise<QueueEvent[]> {
    return this.findAll({ 
      where: { token_id: tokenId },
      orderBy: 'created_at',
      orderDirection: 'ASC'
    });
  }

  /**
   * Find events by event type
   */
  async findByEventType(clinicId: string, eventType: string): Promise<QueueEvent[]> {
    return this.findAll({ 
      where: { clinic_id: clinicId, event_type: eventType },
      orderBy: 'created_at',
      orderDirection: 'DESC'
    });
  }
}

export const queueEventRepository = new QueueEventRepository();