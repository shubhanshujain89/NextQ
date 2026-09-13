export type AuthRole = 'SUPER_ADMIN' | 'CLINIC_ADMIN' | 'DOCTOR' | 'STAFF';

export type AuthContext = {
  userId: string;
  role: AuthRole;
  clinicId: string | null;
  doctorId: string | null;
  email: string;
  authVersion?: string;
};

export const requireDatabaseAccess = (context: AuthContext | undefined, res?: { status(code: number): any; json(payload: any): any }) => {
  if (!context) {
    if (res) {
      res.status(401).json({ error: 'Authentication required.' });
    }
    return false;
  }
  return true;
};

export const canAccessRecord = (context: AuthContext, record: Record<string, any>, table: string) => {
  if (context.role === 'SUPER_ADMIN') return true;
  if (context.role === 'DOCTOR' && !['doctors', 'tokens', 'appointments', 'queue_events', 'doctor_status'].includes(table)) return false;

  const recordClinicId = table === 'clinics' ? record.id : (record.clinicId || record.clinic_id);
  if (!recordClinicId) return false;
  if (recordClinicId !== context.clinicId) return false;

  if (context.role === 'DOCTOR' && table === 'doctors') {
    return (record.id || record.doctorId) === context.doctorId;
  }

  if (context.role === 'DOCTOR' && record.doctorId && record.doctorId !== context.doctorId) return false;
  return recordClinicId === context.clinicId;
};

export const canMutateGenericRecord = (context: AuthContext, table: string) => {
  if (context.role === 'SUPER_ADMIN') return true;
  if (context.role !== 'CLINIC_ADMIN') return false;
  return ['clinics', 'doctors', 'staff_users', 'users', 'payments'].includes(table);
};

export const prepareDatabaseMutation = (
  context: AuthContext,
  table: string,
  value: Record<string, any>,
  current?: Record<string, any> | null,
) => {
  if (context.role === 'SUPER_ADMIN') return value;
  if (table !== 'staff_users') return value;
  if (context.role !== 'CLINIC_ADMIN') {
    throw new Error('This role cannot modify staff users.');
  }

  const next = { ...value };
  if (current) {
    if (current.clinicId !== context.clinicId && current.clinic_id !== context.clinicId) {
      throw new Error('Access denied.');
    }
    delete next.passwordHash;
    delete next.password_hash;
  }

  if (next.role && !['CLINIC_ADMIN', 'DOCTOR', 'STAFF'].includes(String(next.role).toUpperCase())) {
    throw new Error('Invalid staff role.');
  }

  if (next.clinicId !== undefined && next.clinicId !== context.clinicId) {
    throw new Error('A clinic admin cannot assign another clinic.');
  }
  if (next.clinic_id !== undefined && next.clinic_id !== context.clinicId) {
    throw new Error('A clinic admin cannot assign another clinic.');
  }

  next.clinicId = context.clinicId;
  delete next.clinic_id;
  delete next.passwordReset;
  delete next.password_reset;
  delete next.accessStatus;
  delete next.access_status;
  return next;
};

export const sanitizeDatabaseRecord = (table: string, record: Record<string, any>) => {
  if (table !== 'staff_users') return record;
  const { passwordHash, password_hash, passwordReset, password_reset, ...safeRecord } = record;
  return safeRecord;
};
