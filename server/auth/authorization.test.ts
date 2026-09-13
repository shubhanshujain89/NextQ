import test from 'node:test';
import assert from 'node:assert/strict';

import {
  canAccessRecord,
  canMutateGenericRecord,
  prepareDatabaseMutation,
  requireDatabaseAccess,
} from './authorization.js';

const makeResponse = () => {
  const res: any = {
    statusCode: 200,
    payload: undefined,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(payload: any) {
      this.payload = payload;
      return this;
    },
  };
  return res;
};

test('unauthenticated database access is rejected with 401', () => {
  const res = makeResponse();
  const allowed = requireDatabaseAccess(undefined, res);

  assert.equal(allowed, false);
  assert.equal(res.statusCode, 401);
  assert.deepEqual(res.payload, { error: 'Authentication required.' });
});

test('clinic A admin cannot mutate clinic B records and doctor A cannot access doctor B resources', () => {
  const clinicAdminContext = { userId: 'ca-1', role: 'CLINIC_ADMIN', clinicId: 'clinic-a', doctorId: null, email: 'admin@clinic-a.test' } as const;
  const doctorContext = { userId: 'doc-1', role: 'DOCTOR', clinicId: 'clinic-a', doctorId: 'doctor-a', email: 'doctor-a@clinic-a.test' } as const;

  assert.equal(canAccessRecord(clinicAdminContext, { clinicId: 'clinic-b' }, 'patients'), false);
  assert.equal(canAccessRecord(clinicAdminContext, { clinicId: 'clinic-a' }, 'patients'), true);
  assert.equal(canAccessRecord(doctorContext, { clinicId: 'clinic-a', doctorId: 'doctor-b' }, 'doctors'), false);
  assert.equal(canAccessRecord(doctorContext, { clinicId: 'clinic-a', doctorId: 'doctor-a' }, 'doctors'), true);
});

test('staff users cannot perform admin-only mutations and clinic admins cannot assign another clinic', () => {
  const staffContext = { userId: 'staff-1', role: 'STAFF', clinicId: 'clinic-a', doctorId: null, email: 'staff@clinic-a.test' } as const;
  const clinicAdminContext = { userId: 'ca-1', role: 'CLINIC_ADMIN', clinicId: 'clinic-a', doctorId: null, email: 'admin@clinic-a.test' } as const;

  assert.equal(canMutateGenericRecord(staffContext, 'staff_users'), false);
  assert.equal(canMutateGenericRecord(clinicAdminContext, 'patients'), false);
  assert.throws(() => prepareDatabaseMutation(clinicAdminContext, 'staff_users', { clinicId: 'clinic-b', role: 'STAFF' }), /A clinic admin cannot assign another clinic\./);
  assert.throws(() => prepareDatabaseMutation(staffContext, 'staff_users', { clinicId: 'clinic-a', role: 'STAFF' }), /This role cannot modify staff users\./);
});
