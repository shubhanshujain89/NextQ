import crypto from 'node:crypto';
import { getPool, closePool } from '../server/db/connection.js';

const TOTAL_APPOINTMENTS = 200;
const WALK_IN_COUNT = 150;
const TEST_PREFIX = 'TEST-APPT-';

const names = [
  'Aarav Sharma', 'Ananya Patel', 'Vikram Singh', 'Meera Nair',
  'Rohan Gupta', 'Ishita Verma', 'Kabir Mehta', 'Diya Kapoor',
  'Arjun Reddy', 'Sara Khan',
];

const reasons = [
  'Routine consultation', 'Follow-up visit', 'Fever and cold symptoms',
  'Blood pressure review', 'General health check-up',
];

async function seedTestAppointments(): Promise<void> {
  const pool = getPool();
  const connection = await pool.getConnection();

  try {
    await connection.beginTransaction();

    const [clinicRows] = await connection.query<any[]>(
      `SELECT id, name FROM clinics ORDER BY created_at ASC LIMIT 1`,
    );
    const clinic = clinicRows[0];
    if (!clinic) throw new Error('No clinic exists. Create a clinic before seeding appointments.');

    const [doctorRows] = await connection.query<any[]>(
      `SELECT id, name FROM doctors WHERE clinic_id = ? AND status = 'active' ORDER BY created_at ASC LIMIT 1`,
      [clinic.id],
    );
    const doctor = doctorRows[0];
    if (!doctor) throw new Error(`No active doctor exists for clinic ${clinic.id}.`);

    const [sessionRows] = await connection.query<any[]>(
      `SELECT id FROM sessions WHERE clinic_id = ? AND date = CURRENT_DATE LIMIT 1`,
      [clinic.id],
    );
    let sessionId = sessionRows[0]?.id;
    if (!sessionId) {
      sessionId = crypto.randomUUID();
      await connection.execute(
        `INSERT INTO sessions (id, clinic_id, date, status) VALUES (?, ?, CURRENT_DATE, 'ACTIVE')`,
        [sessionId, clinic.id],
      );
    }

    const [sequenceRows] = await connection.query<any[]>(
      `SELECT COALESCE(MAX(token_sequence), 0) AS max_sequence
       FROM appointments WHERE clinic_id = ? AND session_id = ? AND doctor_id = ?`,
      [clinic.id, sessionId, doctor.id],
    );
    let nextSequence = Number(sequenceRows[0]?.max_sequence || 0) + 1;

    let inserted = 0;
    let skipped = 0;
    let tokensInserted = 0;
    let patientsInserted = 0;
    for (let serial = 1; serial <= TOTAL_APPOINTMENTS; serial += 1) {
      const serialText = String(serial).padStart(3, '0');
      const trackingId = `${TEST_PREFIX}${serialText}`;
      const [existingRows] = await connection.query<any[]>(
        `SELECT id FROM appointments WHERE tracking_id = ? LIMIT 1`,
        [trackingId],
      );
      if (existingRows.length > 0) {
        skipped += 1;
        continue;
      }

      const appointmentType = serial <= WALK_IN_COUNT ? 'WALK_IN' : 'ONLINE';
      const tokenSequence = nextSequence;
      const name = `${names[(serial - 1) % names.length]} ${serialText}`;
      const scheduledTime = new Date(Date.now() + serial * 10 * 60 * 1000);

      await connection.execute(
        `INSERT INTO appointments
          (id, clinic_id, doctor_id, session_id, tracking_id, patient_name,
           patient_phone, patient_age, visit_reason, appointment_type,
           token_number, token_sequence, scheduled_slot, status,
           scheduled_time, estimated_time)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'scheduled', ?, ?)`,
        [
          crypto.randomUUID(), clinic.id, doctor.id, sessionId, trackingId,
          name, `9000000${serialText}`, 18 + (serial % 53),
          reasons[(serial - 1) % reasons.length], appointmentType,
          `A-${String(tokenSequence).padStart(3, '0')}`, tokenSequence,
          appointmentType === 'WALK_IN' ? 'Walk-in' : `Online ${serialText}`,
          scheduledTime, scheduledTime,
        ],
      );
      nextSequence += 1;
      inserted += 1;
    }

    const [testAppointments] = await connection.query<any[]>(
      `SELECT id, clinic_id, doctor_id, session_id, tracking_id, patient_name,
              patient_phone, patient_age, appointment_type, token_number,
              token_sequence, scheduled_slot
       FROM appointments WHERE tracking_id LIKE ? ORDER BY token_sequence ASC`,
      [`${TEST_PREFIX}%`],
    );
    await connection.execute(
      `UPDATE appointments
       SET scheduled_time = DATE_SUB(CURRENT_TIMESTAMP, INTERVAL token_sequence MINUTE),
           estimated_time = DATE_SUB(CURRENT_TIMESTAMP, INTERVAL token_sequence MINUTE)
       WHERE tracking_id LIKE ?`,
      [`${TEST_PREFIX}%`],
    );
    for (const appointment of testAppointments) {
      const [patientResult] = await connection.execute(
        `INSERT IGNORE INTO patients
          (id, clinic_id, tracking_id, name, phone, age)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [
          `TEST-PATIENT-${appointment.tracking_id.slice(TEST_PREFIX.length)}`,
          appointment.clinic_id, appointment.tracking_id, appointment.patient_name,
          appointment.patient_phone, appointment.patient_age,
        ],
      );
      patientsInserted += Number((patientResult as { affectedRows?: number }).affectedRows || 0);

      const [tokenResult] = await connection.execute(
        `INSERT IGNORE INTO tokens
          (id, clinic_id, session_id, doctor_id, token_number, sequence_number,
           scheduled_slot, patient_name, patient_phone, patient_age, token_type, status)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'WAITING')`,
        [
          `TEST-TOKEN-${appointment.tracking_id.slice(TEST_PREFIX.length)}`,
          appointment.clinic_id, appointment.session_id, appointment.doctor_id,
          appointment.token_number, appointment.token_sequence,
          appointment.scheduled_slot || '', appointment.patient_name,
          appointment.patient_phone, appointment.patient_age, appointment.appointment_type,
        ],
      );
      tokensInserted += Number((tokenResult as { affectedRows?: number }).affectedRows || 0);

      await connection.execute(
        `UPDATE tokens t
         JOIN patients p ON p.tracking_id = ?
         SET t.patient_id = p.id
         WHERE t.id = ?`,
        [appointment.tracking_id, `TEST-TOKEN-${appointment.tracking_id.slice(TEST_PREFIX.length)}`],
      );
    }

    const [paymentResult] = await connection.execute(
      `UPDATE tokens
       SET payment_status = 'PAID', payment_mode = 'TEST', payment_method = 'TEST'
       WHERE id LIKE 'TEST-TOKEN-%'`,
    );
    const paymentsMarkedPaid = Number((paymentResult as { affectedRows?: number }).affectedRows || 0);

    await connection.execute(
      `UPDATE sessions SET total_tokens_issued = GREATEST(total_tokens_issued, ?) WHERE id = ?`,
      [nextSequence - 1, sessionId],
    );
    await connection.commit();
    console.log(JSON.stringify({ clinic: clinic.name, doctor: doctor.name, sessionId, inserted, skipped, patientsInserted, tokensInserted, paymentsMarkedPaid }));
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
    await closePool();
  }
}

seedTestAppointments().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});