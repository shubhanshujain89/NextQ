/**
 * Database API Layer
 * Provides the MySQL-backed repository and service interface used by the app.
 */

import { repositories } from './db/repositories/index.js';
import { services } from './db/services/index.js';
import crypto from 'crypto';
import { hashPassword, verifyPassword } from './db/password.js';

export { hashPassword, verifyPassword };

// User authentication
export const findUserByEmail = async (email: string) => {
  const user = await repositories.staffUsers.findByEmail(email)
    || await repositories.staffUsers.findByEmailOrName(email);
  if (!user) return null;
  return {
    id: user.id,
    clinicId: user.clinicId,
    doctorId: user.doctorId,
    email: user.email,
    passwordHash: user.passwordHash,
    role: user.role,
    displayName: user.displayName,
    status: user.status,
    clinicName: user.clinicName,
    accessStatus: user.accessStatus,
  };
};

export const resetUserPassword = async (userId: string, newPassword: string) => {
  const passwordHash = hashPassword(newPassword);
  await repositories.staffUsers.updatePassword(userId, passwordHash);
  return { ok: true };
};

// Public booking
export const createPublicBooking = async (input: {
  clinicId: string;
  doctorId: string;
  patientName: string;
  phone: string;
  age?: number;
  reason?: string;
  appointmentDate?: string;
  appointmentSlot?: string;
  amountPaid?: number;
  paymentMode?: 'PAY_NOW' | 'PAY_AT_CLINIC';
  paymentMethod?: string;
  paymentStatus?: 'PENDING' | 'PAID';
}) => {
  return services.booking.createPublicBooking(input);
};

// Generic database operations (for backward compatibility with existing API)
const tableMap: Record<string, string> = {
  clinics: 'clinics',
  doctors: 'doctors',
  users: 'staff_users',
  staff_users: 'staff_users',
  staff: 'staff_users',
  patients: 'patients',
  sessions: 'sessions',
  queue_sessions: 'sessions',
  appointments: 'appointments',
  tokens: 'tokens',
  queue_events: 'queue_events',
  doctor_status: 'doctor_status',
  settings: 'settings',
  whatsapp_logs: 'whatsapp_logs',
};

const extractTableName = (pathValue: string) => {
  const cleaned = pathValue.replace(/^\/+|\/+$/g, '').trim();
  const firstSegment = cleaned.split('/')[0] || '';
  return tableMap[firstSegment] || firstSegment || 'settings';
};

export { extractTableName };

const extractRecordId = (pathValue: string) => {
  const cleaned = pathValue.replace(/^\/+|\/+$/g, '').trim();
  const segments = cleaned.split('/').filter(Boolean);
  return segments.length > 1 ? segments[1] : null;
};

const normalizeKey = (key: string) => key.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase();
const isPaymentsPath = (pathValue: string) => extractTableName(pathValue) === 'payments';
const paymentFromSetting = (setting: any) => {
  try {
    return { id: setting.id, ...JSON.parse(setting.value || '{}') };
  } catch {
    return { id: setting.id, error: 'Invalid payment record' };
  }
};

// Map repository methods to generic CRUD operations
const repositoryMap: Record<string, any> = {
  clinics: repositories.clinics,
  doctors: repositories.doctors,
  staff_users: repositories.staffUsers,
  patients: repositories.patients,
  sessions: repositories.sessions,
  appointments: repositories.appointments,
  tokens: repositories.tokens,
  queue_events: repositories.queueEvents,
  doctor_status: repositories.doctorStatus,
  settings: repositories.settings,
  whatsapp_logs: repositories.whatsAppLogs,
};

export const listQuery = async (pathValue: string, clauses: Array<{ field: string; op?: string; value?: any }> = []) => {
  const table = extractTableName(pathValue);
  if (isPaymentsPath(pathValue)) {
    const settings = await repositories.settings.findAll({ where: { category: 'billing' }, orderBy: 'updated_at', orderDirection: 'DESC' });
    let payments = settings.map(paymentFromSetting);
    clauses.forEach((clause) => {
      const op = clause.op || '==';
      payments = payments.filter((payment) => {
        const fieldValue = payment[clause.field];
        switch (op) {
          case '==': return fieldValue === clause.value;
          case '!=': return fieldValue !== clause.value;
          case '>': return fieldValue > clause.value;
          case '<': return fieldValue < clause.value;
          case '>=': return fieldValue >= clause.value;
          case '<=': return fieldValue <= clause.value;
          case 'in': return Array.isArray(clause.value) && clause.value.includes(fieldValue);
          default: return true;
        }
      });
    });
    return payments;
  }
  const repo = repositoryMap[table];
  
  if (!repo) {
    // Fallback for unknown tables
    return [];
  }

  const where: Record<string, any> = {};
  clauses.forEach((clause) => {
    const field = normalizeKey(clause.field);
    const op = clause.op || '==';
    const value = clause.value;
    if (op === '==') {
      where[field] = value;
    }
  });

  return repo.findAll({ where });
};

export const readDoc = async (pathValue: string) => {
  const table = extractTableName(pathValue);
  const id = extractRecordId(pathValue);
  if (isPaymentsPath(pathValue) && id) {
    const setting = await repositories.settings.findById(id);
    return setting?.category === 'billing' ? paymentFromSetting(setting) : null;
  }
  if (!id) return null;

  const repo = repositoryMap[table];
  if (!repo) return null;

  return repo.findById(id);
};

export const writeDoc = async (pathValue: string, value: Record<string, any>) => {
  const table = extractTableName(pathValue);
  if (isPaymentsPath(pathValue)) {
    const id = value?.id || extractRecordId(pathValue) || crypto.randomUUID();
    const existing = await repositories.settings.findById(id);
    const payment = { ...value, id };
    if (existing) {
      await repositories.settings.update(id, { value: JSON.stringify(payment), category: 'billing' });
    } else {
      await repositories.settings.create({ id, key: `payment_${id}`, value: JSON.stringify(payment), category: 'billing', clinicId: null } as any);
    }
    return { id, path: `payments/${id}` };
  }
  const repo = repositoryMap[table];

  if (!repo) {
    throw new Error(`Unknown table: ${table}`);
  }

  const requestedId = extractRecordId(pathValue);
  const id = value?.id || requestedId || crypto.randomUUID();
  const payload = { ...value, id };

  const existing = await repo.findById(id);
  if (existing) {
    await repo.update(id, payload);
    return { id: existing.id, path: `${table}/${existing.id}` };
  }

  const result = await repo.create(payload);
  return { id: result.id, path: `${table}/${result.id}` };
};

export const updateDoc = async (pathValue: string, value: Record<string, any>) => {
  const table = extractTableName(pathValue);
  const id = extractRecordId(pathValue) || value?.id;
  if (!id) throw new Error(`Cannot update document without an id: ${pathValue}`);

  // Never allow the primary key to be replaced through a generic update.
  const { id: _ignoredId, ...safeValue } = value || {};

  if (isPaymentsPath(pathValue)) {
    const existing = await readDoc(pathValue);
    if (!existing) throw new Error(`Payment not found: ${id}`);
    await repositories.settings.update(id, { value: JSON.stringify({ ...existing, ...safeValue, id }), category: 'billing' });
    return { id };
  }

  const repo = repositoryMap[table];
  if (!repo) throw new Error(`Unknown table: ${table}`);

  await repo.update(id, safeValue);
  return { id };
};

export const deleteDoc = async (pathValue: string) => {
  const table = extractTableName(pathValue);
  const id = extractRecordId(pathValue);
  if (!id) return;

  if (isPaymentsPath(pathValue)) {
    await repositories.settings.delete(id);
    return;
  }

  const repo = repositoryMap[table];
  if (!repo) return;

  await repo.delete(id);
};

// Initialize database connection
export const getDatabase = async () => {
  // Test connection
  const { testConnection } = await import('./db/connection.js');
  const connected = await testConnection();
  if (!connected) {
    throw new Error('Cannot connect to MySQL database. Check your .env configuration.');
  }
  return true;
};

export const closeDatabase = async () => {
  const { closePool } = await import('./db/connection.js');
  await closePool();
};
