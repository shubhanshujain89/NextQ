import express from 'express';
import * as QRCode from 'qrcode';
import path from 'path';
import crypto from 'crypto';
import dotenv from 'dotenv';
import { getDatabase, readDoc, listQuery, writeDoc, updateDoc, deleteDoc, findUserByEmail, verifyPassword, createPublicBooking, resetUserPassword, extractTableName } from './server/db.js';
import { executeQuery, executeQueryOne } from './server/db/connection.js';
import { repositories } from './server/db/repositories/index.js';
import { services } from './server/db/services/index.js';
import { getClinicPlanSnapshot, getPlanLimits } from './server/db/services/planService.js';
import { getClinicBusinessDate } from './server/db/services/clinicTime.js';
import { validateSessionSecret, validateSuperAdminBootstrapPassword } from './server/bootstrap.js';
import { canAccessRecord, canMutateGenericRecord, prepareDatabaseMutation, requireDatabaseAccess, sanitizeDatabaseRecord } from './server/auth/authorization.js';
import { classifyRateLimitCount, type RateLimitStatus } from './server/rateLimit.js';

dotenv.config();

const app = express();
app.set('trust proxy', process.env.TRUST_PROXY === 'true' ? 1 : false);

const PORT = Number(process.env.BACKEND_PORT || process.env.PORT || 4000);
const SESSION_TTL_SECONDS = Number(process.env.SESSION_MAX_AGE || 8 * 60 * 60);
const SESSION_SECRET = process.env.SESSION_SECRET || (process.env.NODE_ENV === 'development' ? 'nextq-development-session-secret' : '');

const sessionSecretError = validateSessionSecret(SESSION_SECRET, process.env.NODE_ENV);
if (sessionSecretError) {
  throw new Error(sessionSecretError);
}

const databaseReady = getDatabase().then(() => {
  return true;
}).catch((error) => {
  console.warn('Database unavailable at startup; continuing in degraded mode.', error instanceof Error ? error.message : error);
  return false;
});

const isDatabaseReady = async (): Promise<boolean> => {
  if (!await databaseReady) return false;
  try {
    await executeQueryOne('SELECT 1 AS ready');
    return true;
  } catch (error) {
    console.warn('Database readiness check failed:', error instanceof Error ? error.message : error);
    return false;
  }
};

const rateLimitTableReady = databaseReady.then(async () => {
  try {
    await executeQueryOne(`
      CREATE TABLE IF NOT EXISTS rate_limits (
        rate_key VARCHAR(255) PRIMARY KEY,
        request_count INT NOT NULL DEFAULT 0,
        reset_at TIMESTAMP NOT NULL,
        INDEX idx_rate_limits_reset_at (reset_at)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
  } catch (error) {
    console.warn('Rate limit table initialization skipped because the database is unavailable:', error instanceof Error ? error.message : error);
  }
});

const runQueueRetention = async () => {
  try {
    await services.retention.removeExpiredQueueData();
    await services.queue.syncAllDoctorStatuses();
  } catch (error) {
    console.error('Queue retention cleanup failed:', error);
  }
};

setInterval(() => {
  void runQueueRetention();
}, 60 * 60 * 1000);

type AuthContext = {
  userId: string;
  role: 'SUPER_ADMIN' | 'CLINIC_ADMIN' | 'DOCTOR' | 'STAFF';
  clinicId: string | null;
  doctorId: string | null;
  email: string;
  authVersion?: string;
};

const RATE_LIMIT_MAX = 30;

app.use((_req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; media-src 'self' https:; connect-src 'self' https:; frame-ancestors 'none'; base-uri 'self'; form-action 'self'");
  if (process.env.NODE_ENV === 'production') {
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  }
  next();
});

const checkRateLimit = async (key: string, max = RATE_LIMIT_MAX): Promise<{ allowed: boolean; status: RateLimitStatus }> => {
  try {
    await rateLimitTableReady;
    await executeQueryOne(
      `INSERT INTO rate_limits (rate_key, request_count, reset_at)
       VALUES (?, 1, DATE_ADD(CURRENT_TIMESTAMP, INTERVAL 60 SECOND))
       ON DUPLICATE KEY UPDATE
         request_count = IF(reset_at <= CURRENT_TIMESTAMP, 1, request_count + 1),
         reset_at = IF(reset_at <= CURRENT_TIMESTAMP, DATE_ADD(CURRENT_TIMESTAMP, INTERVAL 60 SECOND), reset_at)`,
      [key]
    );
    const record = await executeQueryOne<{ request_count: number }>(
      'SELECT request_count FROM rate_limits WHERE rate_key = ?',
      [key]
    );
    const status = classifyRateLimitCount(record?.request_count, max);
    return { allowed: status === 'ok', status };
  } catch (error) {
    console.error('Rate limit storage unavailable:', error instanceof Error ? error.message : error);
    return { allowed: false, status: 'unavailable' };
  }
};

const enforceRateLimit = async (res: express.Response, key: string, max = RATE_LIMIT_MAX): Promise<boolean> => {
  const result = await checkRateLimit(key, max);
  if (result.status === 'unavailable') {
    res.status(503).json({ error: 'Rate limit service temporarily unavailable. Please try again later.' });
    return false;
  }
  if (result.status === 'rate_limited') {
    res.status(429).json({ error: 'Too many requests. Please try again later.' });
    return false;
  }
  return true;
};

const cookieValue = (req: express.Request, name: string) => {
  const cookies = String(req.headers.cookie || '').split(';');
  const entry = cookies.find((item) => item.trim().startsWith(`${name}=`));
  return entry ? decodeURIComponent(entry.trim().slice(name.length + 1)) : '';
};

const resolveDoctorId = async (account: { clinicId?: string; doctorId?: string; email: string; displayName?: string }) => {
  if (account.doctorId || !account.clinicId) return account.doctorId || null;
  const linkedDoctor = await repositories.doctors.findByEmail(account.email);
  if (linkedDoctor) return linkedDoctor.id;
  const clinicDoctors = await repositories.doctors.findActiveByClinicId(account.clinicId);
  const normalizedAccountName = String(account.displayName || '').trim().toLowerCase();
  const namedDoctor = normalizedAccountName
    ? clinicDoctors.find((doctor) => doctor.name.trim().toLowerCase() === normalizedAccountName)
    : undefined;
  return namedDoctor?.id || (clinicDoctors.length === 1 ? clinicDoctors[0].id : null);
};

const createSessionToken = (context: AuthContext) => {
  if (!SESSION_SECRET) throw new Error('SESSION_SECRET must be configured in production.');
  const issuedAt = Math.floor(Date.now() / 1000);
  const payload = Buffer.from(JSON.stringify({ ...context, iat: issuedAt, exp: issuedAt + SESSION_TTL_SECONDS })).toString('base64url');
  const signature = crypto.createHmac('sha256', SESSION_SECRET).update(payload).digest('base64url');
  return `${payload}.${signature}`;
};

const authContext = async (req: express.Request) => {
  const token = cookieValue(req, 'nextq_session');
  if (!token || !SESSION_SECRET) return undefined;
  const [payload, signature] = token.split('.');
  if (!payload || !signature) return undefined;
  const expectedSignature = crypto.createHmac('sha256', SESSION_SECRET).update(payload).digest('base64url');
  if (!secureEqual(signature, expectedSignature)) return undefined;
  try {
    const session = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as AuthContext & { exp?: number; iat?: number };
    if (!session.exp || session.exp <= Math.floor(Date.now() / 1000)) return undefined;
    if (!session.iat || session.iat > Math.floor(Date.now() / 1000)) return undefined;
    if (!session.userId || !session.role || !session.email) return undefined;
    if (session.userId !== 'super-admin') {
      const account = await repositories.staffUsers.findById(session.userId);
      const authVersion = account
        ? crypto.createHash('sha256').update(account.passwordHash).digest('base64url')
        : '';
      if (!account || !session.authVersion || !secureEqual(session.authVersion, authVersion)) return undefined;
      if (session.role === 'DOCTOR' && !session.doctorId) {
        session.doctorId = await resolveDoctorId(account);
      }
    }
    return session;
  } catch {
    return undefined;
  }
};

const getClinicAccessStatus = async (clinicId: string | null, clinicName?: string) => {
  let resolvedClinicId = clinicId;
  if (!resolvedClinicId && clinicName) {
    const clinic = await repositories.clinics.findOne({ name: clinicName });
    resolvedClinicId = clinic?.id || null;
  }
  if (!resolvedClinicId) return 'Granted';
  const record = await repositories.settings.findOne({ key: `clinic_access_${resolvedClinicId}`, clinic_id: null });
  return record?.value || 'Granted';
};

const requireActivePlan = async (res: express.Response, clinicId: string, role?: AuthContext['role']) => {
  const clinic = await repositories.clinics.findById(clinicId);
  if (!clinic) {
    res.status(404).json({ error: 'Clinic not found.' });
    return null;
  }
  const plan = getClinicPlanSnapshot(clinic);
  if (role !== 'SUPER_ADMIN' && plan.status !== 'ACTIVE') {
    res.status(403).json({ error: `Clinic subscription is ${plan.status.toLowerCase()}. Please renew the ${plan.plan} plan.`, plan });
    return null;
  }
  return { clinic, plan };
};

const isPlanGatedRead = (table: string) => ['doctors', 'patients', 'sessions', 'appointments', 'tokens', 'queue_events', 'doctor_status', 'whatsapp_logs'].includes(table);

const enforcePlanWrite = async (
  context: AuthContext | undefined,
  table: string,
  value: Record<string, any>,
  current: Record<string, any> | null,
) => {
  if (!context || context.role === 'SUPER_ADMIN') return;
  const clinicId = table === 'clinics'
    ? String(current?.id || value.id || '')
    : String(value.clinicId || value.clinic_id || current?.clinicId || current?.clinic_id || '');
  if (!clinicId) return;
  const clinic = await repositories.clinics.findById(clinicId);
  if (!clinic) throw new Error('Clinic not found.');
  const plan = getClinicPlanSnapshot(clinic);
  if (plan.status !== 'ACTIVE') throw new Error(`Clinic subscription is ${plan.status.toLowerCase()}. Please renew the ${plan.plan} plan.`);
  if (table === 'whatsapp_logs' || table === 'payments') throw new Error(`${table === 'payments' ? 'Payments' : 'WhatsApp notifications'} are not enabled for the current launch plans.`);
  if (!current && table === 'doctors') {
    const limits = getPlanLimits(plan.plan);
    const doctors = await repositories.doctors.findByClinicId(clinicId);
    if (doctors.length >= limits.maxDoctors) throw new Error(`${plan.plan} plan allows up to ${limits.maxDoctors} doctor${limits.maxDoctors === 1 ? '' : 's'}.`);
  }
  if (!current && table === 'staff_users') {
    const limits = getPlanLimits(plan.plan);
    const users = await repositories.staffUsers.findByClinicId(clinicId);
    const clinicUsers = users.filter((user) => user.role !== 'SUPER_ADMIN');
    if (clinicUsers.length >= limits.maxStaffUsers) throw new Error(`${plan.plan} plan allows up to ${limits.maxStaffUsers} clinic users.`);
  }
};
const databaseMutationErrorStatus = (error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  return /plan allows|subscription is|not enabled for the current launch plans|Clinic not found/i.test(message) ? 403 : 500;
};
const serverTableMap: Record<string, string> = {
  clinics: 'clinics', doctors: 'doctors', users: 'staff_users', staff_users: 'staff_users', staff: 'staff_users',
  patients: 'patients', sessions: 'sessions', queue_sessions: 'sessions', appointments: 'appointments',
  tokens: 'tokens', queue_events: 'queue_events', doctor_status: 'doctor_status', settings: 'settings', whatsapp_logs: 'whatsapp_logs',
};
const tableForPath = (value: string) => {
  const raw = String(value).replace(/^\/+|\/+$/g, '').split('/')[0];
  return serverTableMap[raw] || raw;
};
const secureEqual = (left: string, right: string) => {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && crypto.timingSafeEqual(leftBuffer, rightBuffer);
};

const requireDatabaseAccessMiddleware = async (req: express.Request, res: express.Response, next: express.NextFunction) => {
  const context = await authContext(req);
  const requestedPath = String(req.query.path || req.body?.path || '');
  if (!requireDatabaseAccess(context, res)) {
    return;
  }
  (req as express.Request & { auth?: AuthContext }).auth = context;
  next();
};

app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true }));

app.use((req, res, next) => {
  const stateChangingMethod = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method);
  const hasSessionCookie = Boolean(cookieValue(req, 'nextq_session'));
  const origin = String(req.headers.origin || '');
  if (stateChangingMethod && hasSessionCookie && origin) {
    const forwardedProto = String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim();
    const protocol = forwardedProto || req.protocol;
    const forwardedHost = String(req.headers['x-forwarded-host'] || '').split(',')[0].trim();
    const host = forwardedHost || req.get('host');
    const expectedOrigin = `${protocol}://${host}`;
    if (origin !== expectedOrigin) {
      res.status(403).json({ error: 'Cross-site request blocked.' });
      return;
    }
  }
  next();
});

app.use((req, res, next) => {
  res.removeHeader('X-Powered-By');
  next();
});

app.get('/api/health', (_req, res) => {
  res.status(200).json({
    status: 'ok',
    app: 'NEXTQ',
    timestamp: new Date().toISOString(),
  });
});

app.get('/api/ready', async (_req, res) => {
  const ready = await isDatabaseReady();
  res.status(ready ? 200 : 503).json({
    status: ready ? 'ready' : 'not_ready',
    app: 'NEXTQ',
    database: ready ? 'ok' : 'unavailable',
    timestamp: new Date().toISOString(),
  });
});

app.get('/api/status', (_req, res) => {
  res.status(200).json({
    service: 'clinic-queue-backend',
    mode: 'operational',
    platform: 'NEXTQ',
    features: [
      'Queue orchestration',
      'Patient intake',
      'WhatsApp automation',
      'Doctor and reception operations',
    ],
  });
});

const normalizeSettingKey = (key: string) => String(key || '')
  .replace(/_([a-z])/g, (_, letter: string) => letter.toUpperCase())
  .replace(/-([a-z])/g, (_, letter: string) => letter.toUpperCase());

const parseSpecializationList = (value: unknown): string[] => {
  if (Array.isArray(value)) return value.filter(Boolean).map(String);
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return [];
    try {
      const parsed = JSON.parse(trimmed);
      if (Array.isArray(parsed)) return parsed.filter(Boolean).map(String);
    } catch {
      // Fall through to comma-splitting
    }
    return trimmed
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean);
  }
  return [];
};

app.get('/api/clinics', async (req, res) => {
  try {
    const clientIp = req.ip || req.socket.remoteAddress || 'unknown';
    if (!(await enforceRateLimit(res, `public-clinics:${clientIp}`, 60))) {
      return;
    }
    const clinics = await repositories.clinics.findActive();
    const publicClinics = clinics.map((clinic) => ({
      id: clinic.id,
      name: clinic.name,
      address: clinic.address || '',
      phone: clinic.phone || '',
      email: clinic.email || '',
      specializations: parseSpecializationList(clinic.specializations),
      operatingHours: clinic.operatingHours || '',
    }));
    res.status(200).json(publicClinics);
  } catch (error) {
    res.status(500).json({ error: 'Unable to load clinics.' });
  }
});

app.get('/api/clinics/:clinicId/doctors', async (req, res) => {
  try {
    const clientIp = req.ip || req.socket.remoteAddress || 'unknown';
    if (!(await enforceRateLimit(res, `public-doctors:${clientIp}`, 60))) {
      return;
    }
    const { clinicId } = req.params;
    if (!await requireActivePlan(res, clinicId)) return;
    const specializationFilter = String(req.query.specialization || '').trim();
    const doctors = await repositories.doctors.findActiveByClinicId(clinicId);
    const publicDoctors = doctors
      .filter((doctor) => !specializationFilter || !doctor.specialization || doctor.specialization.toLowerCase() === specializationFilter.toLowerCase())
      .map((doctor) => ({
        id: doctor.id,
        clinicId: doctor.clinicId,
        name: doctor.name,
        specialization: doctor.specialization || '',
        consultationFee: Number(doctor.consultationFee || 0),
        availableDays: Array.isArray(doctor.availableDays) ? doctor.availableDays : [],
        availableHours: doctor.availableHours || '',
        rating: Number(doctor.rating || 0),
      }));
    res.status(200).json(publicDoctors);
  } catch (error) {
    res.status(500).json({ error: 'Unable to load doctors.' });
  }
});

app.get('/api/staff/queue/:clinicId', async (req, res) => {
  try {
    const context = await authContext(req);
    const requestedClinicId = String(req.params.clinicId || '');
    if (!context || (context.role !== 'SUPER_ADMIN' && context.clinicId !== requestedClinicId)) {
      res.status(403).json({ error: 'Clinic access denied.' });
      return;
    }

    const clinic = await repositories.clinics.findById(requestedClinicId);
    if (!clinic) {
      res.status(404).json({ error: 'Clinic not found.' });
      return;
    }
    const plan = getClinicPlanSnapshot(clinic);
    if (context.role !== 'SUPER_ADMIN' && plan.status !== 'ACTIVE') {
      res.status(403).json({ error: `Clinic subscription is ${plan.status.toLowerCase()}.`, plan });
      return;
    }

    const todaySession = await repositories.sessions.findByClinicAndDate(requestedClinicId, getClinicBusinessDate(new Date(), clinic.timezone));
    const session = todaySession?.status === 'ACTIVE' ? todaySession : null;
    const doctors = await repositories.doctors.findByClinicId(requestedClinicId);
    const activeDoctors = doctors.filter((doctor) => doctor.status === 'active');
    const scopedDoctors = context.role === 'DOCTOR'
      ? doctors.filter((doctor) => doctor.id === context.doctorId)
      : doctors;
    const scopedActiveDoctors = context.role === 'DOCTOR'
      ? activeDoctors.filter((doctor) => doctor.id === context.doctorId)
      : activeDoctors;
    const displayedDoctor = context.role === 'DOCTOR'
      ? scopedDoctors[0]
      : scopedActiveDoctors[0];
    const tokens = session
      ? (await Promise.all(scopedDoctors.map((doctor) => repositories.tokens.findByDoctorAndSession(doctor.id, session.id)))).flat()
      : [];
    const clinicRevenue = todaySession
      ? await repositories.tokens.getCollectedRevenueByClinicAndSession(requestedClinicId, todaySession.id)
      : 0;
    const doctorIdForQr = context.role === 'DOCTOR'
      ? context.doctorId || displayedDoctor?.id || ''
      : displayedDoctor?.id || scopedActiveDoctors[0]?.id || '';
    const primaryDoctorForClinic = displayedDoctor || scopedActiveDoctors[0] || null;

    res.status(200).json({
      clinic: {
        id: clinic.id,
        name: clinic.name,
        doctorId: context.role === 'DOCTOR' ? context.doctorId || '' : primaryDoctorForClinic?.id || '',
        doctorName: displayedDoctor?.name || clinic.doctorName || '',
        doctorPhoto: displayedDoctor?.photo || '',
        specialty: displayedDoctor?.specialization || clinic.specialty || '',
        cabinNumber: clinic.cabinNumber || '',
        doctorStatus: clinic.doctorStatus,
        delayMinutes: clinic.delayMinutes || 0,
        delayReason: clinic.delayReason || '',
        avgConsultationMinutes: clinic.avgConsultationMinutes || 0,
        consultationFee: displayedDoctor?.consultationFee ?? clinic.consultationFee ?? 0,
        activeSessionId: clinic.activeSessionId || session?.id || '',
        totalPatientsToday: clinic.totalPatientsToday || 0,
        revenueToday: clinicRevenue,
        featurePlan: clinic.featurePlan,
        subscriptionStatus: plan.status,
        subscriptionStartedAt: plan.startedAt.toISOString(),
        subscriptionExpiresAt: plan.expiresAt.toISOString(),
        maxDoctors: plan.maxDoctors,
        maxStaffUsers: plan.maxStaffUsers,
        paymentsEnabled: plan.paymentsEnabled,
        whatsappEnabled: plan.whatsappEnabled,
        patientNotesEnabled: plan.patientNotesEnabled,
        whatsappNotificationsEnabled: clinic.whatsappNotificationsEnabled,
        hasPaymentGateway: clinic.hasPaymentGateway,
        clinicUpiId: clinic.clinicUpiId || '',
        qrCodeUrl: await makeDoctorBookingQrCodeUrl(req, clinic.id, doctorIdForQr || ''),
      },
      session: session ? {
        id: session.id,
        clinicId: session.clinicId,
        date: session.date.toISOString(),
        activeTokenId: session.activeTokenId || '',
        activeTokenNumber: session.activeTokenNumber || '',
        status: session.status,
        totalTokensIssued: session.totalTokensIssued,
        rollingAvgMinutes: session.rollingAvgMinutes,
        completedCount: session.completedCount,
        totalRevenue: session.totalRevenue,
      } : null,
      tokens: tokens.map((token) => ({
        id: token.id,
        clinicId: token.clinicId,
        sessionId: token.sessionId,
        tokenNumber: token.tokenNumber,
        sequenceNumber: token.sequenceNumber,
        patientId: token.patientId,
        patientName: token.patientName,
        patientPhone: token.patientPhone,
        patientAge: token.patientAge,
        patientGender: token.patientGender,
        tokenType: token.tokenType,
        status: token.status,
        isEmergency: token.isEmergency,
        isHold: token.isHold,
        priority: token.priority,
        amountPaid: token.amountPaid,
        paymentMode: token.paymentMode,
        paymentMethod: token.paymentMethod,
        paymentStatus: token.paymentStatus,
        createdAt: token.createdAt.toISOString(),
        calledAt: token.calledAt?.toISOString(),
        completedAt: token.completedAt?.toISOString(),
        consultationDurationSeconds: token.consultationDurationSeconds,
        preConsultationNotes: token.preConsultationNotes,
        weight: token.weight,
        temperature: token.temperature,
        bloodPressure: token.bloodPressure,
        triageNotes: token.triageNotes,
        doctorNotes: token.doctorNotes,
        whatsappSentCount: token.whatsappSentCount,
        whatsappLastSentAt: token.whatsappLastSentAt?.toISOString(),
      })),
    });
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : 'Unable to load queue.' });
  }
});

app.post('/api/staff/queue/:tokenId/call', async (req, res) => {
  try {
    const context = await authContext(req);
    if (!context || !context.clinicId) {
      res.status(401).json({ error: 'Authentication required.' });
      return;
    }
    if (!await requireActivePlan(res, context.clinicId, context.role)) return;
    const token = await services.queue.callTokenForClinic(
      String(req.params.tokenId || ''),
      context.clinicId,
      context.role === 'DOCTOR' ? context.doctorId || undefined : undefined
    );
    if (!token) {
      res.status(409).json({ error: 'Token is unavailable or has already been called.' });
      return;
    }
    res.status(200).json(token);
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : 'Unable to call token.' });
  }
});

app.patch('/api/staff/queue/:tokenId/payment', async (req, res) => {
  try {
    const context = await queueMutationContext(req, res);
    if (!context) return;
    const token = await services.queue.markPaymentPaidForClinic(String(req.params.tokenId || ''), context.clinicId!);
    if (!token) {
      res.status(409).json({ error: 'Payment cannot be updated for this token.' });
      return;
    }
    res.status(200).json(token);
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : 'Unable to update payment status.' });
  }
});

app.post('/api/staff/queue/:tokenId/start', async (req, res) => {
  try {
    const context = await authContext(req);
    if (!context || !context.clinicId) {
      res.status(401).json({ error: 'Authentication required.' });
      return;
    }
    if (!await requireActivePlan(res, context.clinicId, context.role)) return;
    const token = await services.queue.startTokenForClinic(
      String(req.params.tokenId || ''),
      context.clinicId,
      context.role === 'DOCTOR' ? context.doctorId || undefined : undefined
    );
    if (!token) {
      res.status(409).json({ error: 'Token must be CALLED and available to start.' });
      return;
    }
    res.status(200).json(token);
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : 'Unable to start consultation.' });
  }
});

app.post('/api/staff/queue/:tokenId/complete', async (req, res) => {
  try {
    const context = await authContext(req);
    if (!context || !context.clinicId) {
      res.status(401).json({ error: 'Authentication required.' });
      return;
    }
    if (!await requireActivePlan(res, context.clinicId, context.role)) return;
    const token = await services.queue.completeTokenForClinic(
      String(req.params.tokenId || ''),
      context.clinicId,
      context.role === 'DOCTOR' ? context.doctorId || undefined : undefined,
      typeof req.body?.doctorNotes === 'string' ? req.body.doctorNotes : ''
    );
    if (!token) {
      res.status(409).json({ error: 'Token must be IN_CONSULTATION and available to complete.' });
      return;
    }
    res.status(200).json(token);
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : 'Unable to complete consultation.' });
  }
});

const makeDoctorBookingQrCodeUrl = async (req: express.Request, clinicId: string, doctorId: string) => {
  if (!clinicId || !doctorId) return '';
  const protocol = req.protocol || 'http';
  const host = req.get('host') || 'localhost:3000';
  const baseUrl = `${protocol}://${host}`;
  const bookingUrl = `${baseUrl}/booking?clinicId=${encodeURIComponent(clinicId)}&doctorId=${encodeURIComponent(doctorId)}`;
  return QRCode.toDataURL(bookingUrl, { width: 220, margin: 1, errorCorrectionLevel: 'M' });
};

const queueMutationContext = async (req: express.Request, res: express.Response) => {
  const context = await authContext(req);
  if (!context || !context.clinicId || !['SUPER_ADMIN', 'CLINIC_ADMIN', 'DOCTOR', 'STAFF'].includes(context.role)) {
    res.status(403).json({ error: 'Queue access denied.' });
    return null;
  }
  if (!await requireActivePlan(res, context.clinicId, context.role)) return null;
  return context;
};

app.post('/api/staff/queue/:tokenId/hold', async (req, res) => {
  try {
    const context = await queueMutationContext(req, res);
    if (!context) return;
    const token = await services.queue.holdTokenForClinic(String(req.params.tokenId || ''), context.clinicId!, context.role === 'DOCTOR' ? context.doctorId || undefined : undefined);
    if (!token) {
      res.status(409).json({ error: 'Only an active consultation can be put on hold.' });
      return;
    }
    res.status(200).json(token);
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : 'Unable to hold token.' });
  }
});

app.post('/api/staff/queue/:tokenId/resume', async (req, res) => {
  try {
    const context = await queueMutationContext(req, res);
    if (!context) return;
    const token = await services.queue.resumeTokenForClinic(String(req.params.tokenId || ''), context.clinicId!, context.role === 'DOCTOR' ? context.doctorId || undefined : undefined);
    if (!token) {
      res.status(409).json({ error: 'Only a held token can be resumed.' });
      return;
    }
    res.status(200).json(token);
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : 'Unable to resume token.' });
  }
});

app.post('/api/staff/queue/:tokenId/emergency', async (req, res) => {
  try {
    const context = await queueMutationContext(req, res);
    if (!context) return;
    const token = await services.queue.promoteEmergencyForClinic(String(req.params.tokenId || ''), context.clinicId!, context.role === 'DOCTOR' ? context.doctorId || undefined : undefined);
    if (!token) {
      res.status(409).json({ error: 'Only waiting or held tokens can be made emergency priority.' });
      return;
    }
    res.status(200).json(token);
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : 'Unable to set emergency priority.' });
  }
});

app.patch('/api/staff/clinic/:clinicId/status', async (req, res) => {
  try {
    const context = await authContext(req);
    const clinicId = String(req.params.clinicId || '');
    if (!context || !context.clinicId || (context.role !== 'SUPER_ADMIN' && context.clinicId !== clinicId) || !['SUPER_ADMIN', 'CLINIC_ADMIN', 'DOCTOR', 'STAFF'].includes(context.role)) {
      res.status(403).json({ error: 'Clinic status access denied.' });
      return;
    }
    if (!await requireActivePlan(res, clinicId, context.role)) return;
    const status = String(req.body?.status || '').toUpperCase();
    if (!['IN', 'OUT'].includes(status)) {
      res.status(400).json({ error: 'Status must be IN or OUT.' });
      return;
    }
    const doctorId = context.role === 'DOCTOR' ? context.doctorId : String(req.body?.doctorId || '') || (await repositories.doctors.findByClinicId(clinicId))[0]?.id;
    if (!doctorId || (context.role === 'DOCTOR' && doctorId !== context.doctorId)) {
      res.status(403).json({ error: 'Doctor status access denied.' });
      return;
    }
    await repositories.doctorStatus.updateStatus(clinicId, doctorId, status as 'IN' | 'OUT');
    const clinic = await repositories.clinics.updateDoctorStatus(clinicId, status as 'IN' | 'OUT');
    res.status(200).json({ status, doctorId, clinic });
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : 'Unable to update doctor status.' });
  }
});

app.patch('/api/staff/clinic/:clinicId/delay', async (req, res) => {
  try {
    const context = await authContext(req);
    const clinicId = String(req.params.clinicId || '');
    if (!context || !context.clinicId || (context.role !== 'SUPER_ADMIN' && context.clinicId !== clinicId) || !['SUPER_ADMIN', 'CLINIC_ADMIN', 'DOCTOR', 'STAFF'].includes(context.role)) {
      res.status(403).json({ error: 'Clinic delay access denied.' });
      return;
    }
    if (!await requireActivePlan(res, clinicId, context.role)) return;
    const delayMinutes = Number(req.body?.delayMinutes);
    const delayReason = String(req.body?.delayReason || '').trim();
    if (!Number.isInteger(delayMinutes) || delayMinutes < 0 || delayMinutes > 240 || delayReason.length > 500) {
      res.status(400).json({ error: 'Delay must be a whole number from 0 to 240 minutes.' });
      return;
    }
    const clinic = await repositories.clinics.updateDoctorStatus(clinicId, (await repositories.clinics.findById(clinicId))?.doctorStatus || 'IN', delayMinutes, delayReason);
    res.status(200).json({ delayMinutes, delayReason, clinic });
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : 'Unable to update clinic delay.' });
  }
});

app.patch('/api/staff/clinic/:clinicId/cabin', async (req, res) => {
  try {
    const context = await authContext(req);
    const clinicId = String(req.params.clinicId || '');
    if (!context || !context.clinicId || (context.role !== 'SUPER_ADMIN' && context.clinicId !== clinicId) || !['SUPER_ADMIN', 'CLINIC_ADMIN', 'DOCTOR', 'STAFF'].includes(context.role)) {
      res.status(403).json({ error: 'Clinic room update access denied.' });
      return;
    }
    if (!await requireActivePlan(res, clinicId, context.role)) return;
    const cabinNumber = String(req.body?.cabinNumber || req.body?.roomNumber || '').trim();
    const clinic = await repositories.clinics.update(clinicId, { cabinNumber });
    if (!clinic) {
      res.status(404).json({ error: 'Clinic not found.' });
      return;
    }
    res.status(200).json({ ok: true, clinic: { id: clinic.id, cabinNumber: clinic.cabinNumber || '' } });
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : 'Unable to update room number.' });
  }
});

app.delete('/api/staff/queue/:tokenId/cancel', async (req, res) => {
  try {
    const context = await authContext(req);
    if (!context || !context.clinicId || context.role !== 'DOCTOR') {
      res.status(403).json({ error: 'Only the doctor can cancel a consultation.' });
      return;
    }
    if (!await requireActivePlan(res, context.clinicId, context.role)) return;
    const token = await services.queue.cancelTokenForClinic(
      String(req.params.tokenId || ''),
      context.clinicId,
      context.doctorId || undefined
    );
    if (!token) {
      res.status(409).json({ error: 'Only waiting or held patients can be cancelled.' });
      return;
    }
    res.status(200).json(token);
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : 'Unable to cancel consultation.' });
  }
});

app.post('/api/patient/book', async (req, res) => {
  try {
    const clientIp = req.ip || req.socket.remoteAddress || 'unknown';
    if (!(await enforceRateLimit(res, `booking:${clientIp}`, 10))) {
      return;
    }
    const { clinicId, doctorId, patientName, phone, age, reason, appointmentDate, appointmentSlot, amountPaid, paymentMode, paymentMethod, paymentStatus } = req.body || {};
    const normalizedPatientName = String(patientName || '').trim();
    const normalizedPhone = String(phone || '').trim();
    const normalizedReason = String(reason || '').trim();
    const normalizedAppointmentSlot = String(appointmentSlot || '').trim();
    const normalizedAppointmentDate = String(appointmentDate || '').trim();
    const normalizedPaymentStatus = paymentStatus === 'PAID' ? 'PAID' : 'PENDING';
    const normalizedPaymentMode = paymentMode === 'PAY_NOW' ? 'PAY_NOW' : 'PAY_AT_CLINIC';
    const normalizedAmountPaid = normalizedPaymentStatus === 'PAID' ? Math.max(0, Number(amountPaid) || 0) : 0;
    const normalizedAge = age === undefined || age === null || age === '' ? undefined : Number(age);
    if (!clinicId || !doctorId || !normalizedPatientName || !normalizedPhone) {
      res.status(400).json({ error: 'Clinic, doctor, patient name, and mobile number are required.' });
      return;
    }
    if (!(await enforceRateLimit(res, `booking-phone:${normalizedPhone}`, 3))) {
      return;
    }
    if (normalizedPatientName.length > 120 || normalizedPhone.length > 30 || normalizedReason.length > 500 || normalizedAppointmentDate.length > 40 || normalizedAppointmentSlot.length > 100) {
      res.status(400).json({ error: 'Booking details exceed the allowed length.' });
      return;
    }
    if (normalizedAge !== undefined && (!Number.isInteger(normalizedAge) || normalizedAge < 0 || normalizedAge > 120)) {
      res.status(400).json({ error: 'Age must be a whole number between 0 and 120.' });
      return;
    }
    if (normalizedAppointmentDate && !/^\d{4}-\d{2}-\d{2}$/.test(normalizedAppointmentDate)) {
      res.status(400).json({ error: 'Appointment date must use YYYY-MM-DD format.' });
      return;
    }
    const booking = await createPublicBooking({
      clinicId: String(clinicId),
      doctorId: String(doctorId),
      patientName: normalizedPatientName,
      phone: normalizedPhone,
      age: normalizedAge,
      reason: normalizedReason || undefined,
      appointmentDate: normalizedAppointmentDate || undefined,
      appointmentSlot: normalizedAppointmentSlot || undefined,
      amountPaid: normalizedAmountPaid,
      paymentMode: normalizedPaymentMode,
      paymentMethod: String(paymentMethod || '').trim() || undefined,
      paymentStatus: normalizedPaymentStatus,
    });
    res.status(201).json({
      tokenId: booking.tokenId,
      tokenNumber: booking.tokenNumber,
      clinicId: booking.clinicId,
      doctorId: booking.doctorId,
    });
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : 'Unable to create booking.' });
  }
});

app.post('/api/staff/queue/:clinicId/walk-in', async (req, res) => {
  try {
    const context = await authContext(req);
    const clinicId = String(req.params.clinicId || '');
    if (!context || !context.clinicId || (context.role !== 'SUPER_ADMIN' && context.clinicId !== clinicId)) {
      res.status(403).json({ error: 'Clinic access denied.' });
      return;
    }
    if (context.role === 'DOCTOR' && context.doctorId !== String(req.body?.doctorId || '')) {
      res.status(403).json({ error: 'Doctors can only issue tokens for their own queue.' });
      return;
    }
    if (!await requireActivePlan(res, clinicId, context.role)) return;

    const { doctorId, patientName, phone, age, reason, tokenType } = req.body || {};
    const normalizedPatientName = String(patientName || '').trim();
    const normalizedPhone = String(phone || '').trim();
    const normalizedAge = age === undefined || age === null || age === '' ? undefined : Number(age);
    const normalizedTokenType = tokenType === 'EMERGENCY' ? 'EMERGENCY' : 'WALK_IN';
    if (!doctorId || !normalizedPatientName || !normalizedPhone) {
      res.status(400).json({ error: 'Doctor, patient name, and mobile number are required.' });
      return;
    }
    if (normalizedPatientName.length > 120 || normalizedPhone.length > 30 || String(reason || '').length > 500) {
      res.status(400).json({ error: 'Walk-in details exceed the allowed length.' });
      return;
    }
    if (normalizedAge !== undefined && (!Number.isInteger(normalizedAge) || normalizedAge < 0 || normalizedAge > 120)) {
      res.status(400).json({ error: 'Age must be a whole number between 0 and 120.' });
      return;
    }

    const result = await services.booking.createWalkInToken({
      clinicId,
      doctorId: String(doctorId),
      patientName: normalizedPatientName,
      phone: normalizedPhone,
      age: normalizedAge,
      reason: undefined,
      tokenType: normalizedTokenType,
    });
    res.status(201).json(result);
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : 'Unable to issue walk-in token.' });
  }
});

app.post('/api/patient/track', async (req, res) => {
  try {
    const clientIp = req.ip || req.socket.remoteAddress || 'unknown';
    if (!(await enforceRateLimit(res, `patient-track-ip:${clientIp}`, 30))) {
      return;
    }
    res.setHeader('Cache-Control', 'no-store');
    const mobile = String(req.body?.mobile || '').replace(/\D/g, '').replace(/^91/, '').slice(-10);
    if (!/^\d{10}$/.test(mobile)) {
      res.status(400).json({ error: 'Enter a valid 10-digit mobile number.' });
      return;
    }
    const phoneKey = crypto.createHash('sha256').update(mobile).digest('hex');
    if (!(await enforceRateLimit(res, `patient-track-phone:${phoneKey}`, 10))) {
      return;
    }
    const tracking = await services.tracking.getPublicTrackingByPhone(mobile);
    if (!tracking) {
      res.status(404).json({ error: 'No booking found for this mobile number today.' });
      return;
    }
    res.status(200).json({
      ...tracking,
    });
  } catch (error) {
    res.status(503).json({ error: 'Connection temporarily unavailable.' });
  }
});

app.post('/api/auth/login', async (req, res) => {
  try {
    const clientIp = req.ip || req.socket.remoteAddress || 'unknown';
    if (!(await enforceRateLimit(res, `login:${clientIp}`, 10))) {
      return;
    }
    const { email = '', password = '', role: requestedRole = '' } = req.body || {};
    const normalizedEmail = String(email).trim();
    const normalizedPassword = String(password);
    const normalizedRole = String(requestedRole).toUpperCase();
    
    const superAdminPassword = process.env.SUPER_ADMIN_PASSWORD || '';
    const superAdminUsername = process.env.SUPER_ADMIN_USERNAME || '';

    let context: AuthContext | null = null;
    let accountAccessStatus = 'Granted';
    let accountStatus = 'Active';
    let accountClinicName = '';
    
    // Database accounts take precedence over the bootstrap identity.
    const account = await findUserByEmail(normalizedEmail);
    if (account && verifyPassword(normalizedPassword, account.passwordHash)) {
      accountAccessStatus = account.accessStatus || 'Granted';
      accountStatus = String(account.status || 'Active');
      accountClinicName = account.clinicName || '';
      const role = String(account.role || 'CLINIC_ADMIN').toUpperCase() as AuthContext['role'];
      if (['CLINIC_ADMIN', 'DOCTOR', 'STAFF', 'SUPER_ADMIN'].includes(role)) {
        context = {
          userId: account.id,
          role,
          clinicId: account.clinicId || null,
          doctorId: role === 'DOCTOR' ? await resolveDoctorId(account) : account.doctorId || null,
          email: account.email,
          authVersion: crypto.createHash('sha256').update(account.passwordHash).digest('base64url'),
        };
      }
    }

    if (!context && normalizedEmail.toLowerCase() === superAdminUsername.trim().toLowerCase()) {
      const bootstrapPasswordError = validateSuperAdminBootstrapPassword(superAdminPassword, process.env.NODE_ENV);
      if (bootstrapPasswordError) {
        res.status(503).json({ error: bootstrapPasswordError });
        return;
      }
      if (superAdminPassword && secureEqual(normalizedPassword, superAdminPassword)) {
        context = { userId: 'super-admin', role: 'SUPER_ADMIN', clinicId: null, doctorId: null, email: superAdminUsername };
      }
    }

    if (!context) {
      res.status(401).json({ error: 'Invalid credentials or user not found.' });
      return;
    }

    if (context.role === 'SUPER_ADMIN' && normalizedRole !== 'SUPER_ADMIN') {
      res.status(403).json({ error: 'Super Admin must use the dedicated admin login.' });
      return;
    }

    if (context.role !== 'SUPER_ADMIN') {
      if (!['active', 'enabled', 'granted'].includes(accountStatus.toLowerCase())) {
        res.status(403).json({ error: 'Account is not active.' });
        return;
      }
      const clinicAccessStatus = await getClinicAccessStatus(context.clinicId, accountClinicName);
      if (['Hold', 'Denied'].includes(clinicAccessStatus) || ['Pending', 'Revoked'].includes(accountAccessStatus)) {
        res.status(403).json({ error: clinicAccessStatus === 'Denied' || accountAccessStatus === 'Revoked' ? 'Access denied.' : 'Clinic access is on hold.' });
        return;
      }
    }

    if (normalizedRole && normalizedRole !== context.role && !(normalizedRole === 'CLINIC-ADMIN' && context.role === 'CLINIC_ADMIN')) {
      console.log(`[LOGIN] Role mismatch: requested=${normalizedRole}, actual=${context.role}`);
      res.status(401).json({ error: 'Role mismatch.' });
      return;
    }

    const token = createSessionToken(context);
    const isSecureCookie = process.env.NODE_ENV === 'production' || String(req.headers['x-forwarded-proto'] || '').toLowerCase() === 'https';
    const cookieAttributes = [
      'Path=/',
      'HttpOnly',
      'SameSite=Lax',
      `Max-Age=${SESSION_TTL_SECONDS}`,
      ...(isSecureCookie ? ['Secure'] : []),
    ];
    res.setHeader('Set-Cookie', `nextq_session=${encodeURIComponent(token)}; ${cookieAttributes.join('; ')}`);

    const responseData = { 
      user: { 
        uid: context.userId, 
        email: context.email, 
        role: context.role, 
        clinicId: context.clinicId, 
        doctorId: context.doctorId,
        displayName: context.email 
      } 
    };
    res.status(200).json(responseData);
  } catch (error) {
    console.error('Authentication error:', error instanceof Error ? error.message : error);
    res.status(500).json({ error: 'Login service temporarily unavailable.' });
  }
});

app.post('/api/auth/logout', (req, res) => {
  const isSecureCookie = process.env.NODE_ENV === 'production' || String(req.headers['x-forwarded-proto'] || '').toLowerCase() === 'https';
  res.setHeader('Set-Cookie', `nextq_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${isSecureCookie ? '; Secure' : ''}`);
  res.status(204).end();
});

app.get('/api/audit', async (req, res) => {
  const context = await authContext(req);
  if (!context || !['SUPER_ADMIN', 'CLINIC_ADMIN'].includes(context.role)) {
    res.status(401).json({ error: 'Authentication required.' });
    return;
  }

  try {
    const records = await repositories.settings.findAll({ where: { category: 'audit' }, orderBy: 'updated_at', orderDirection: 'DESC', limit: 100 });
    const visible = context.role === 'SUPER_ADMIN' ? records : records.filter((r) => {
      try {
        const parsed = JSON.parse(r.value || '{}');
        return !parsed.clinicId || parsed.clinicId === context.clinicId;
      } catch {
        return false;
      }
    });
    res.status(200).json(visible.map((record) => {
      try {
        return { id: record.id, ...(JSON.parse(record.value || '{}')), timestamp: record.updatedAt.toISOString() };
      } catch {
        return { id: record.id, title: 'Audit event', detail: record.value || '', timestamp: record.updatedAt.toISOString() };
      }
    }));
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : 'Unable to load audit trail.' });
  }
});

app.post('/api/audit', async (req, res) => {
  const context = await authContext(req);
  if (!context || !['SUPER_ADMIN', 'CLINIC_ADMIN'].includes(context.role)) {
    res.status(401).json({ error: 'Authentication required.' });
    return;
  }

  try {
    const { title = '', detail = '' } = req.body || {};
    if (!String(title).trim() || !String(detail).trim()) {
      res.status(400).json({ error: 'Audit title and detail are required.' });
      return;
    }
    const record = await repositories.settings.create({
      id: crypto.randomUUID(),
      key: `audit_${Date.now()}_${crypto.randomUUID()}`,
      value: JSON.stringify({ title: String(title), detail: String(detail), actor: context.email, role: context.role, clinicId: context.clinicId, time: new Date().toISOString() }),
      category: 'audit',
      clinicId: null,
    } as any);
    res.status(201).json({ ok: true, id: record.id });
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : 'Unable to record audit event.' });
  }
});

app.get('/api/clinic-access', async (req, res) => {
  const context = await authContext(req);
  if (!context || !['SUPER_ADMIN', 'CLINIC_ADMIN'].includes(context.role)) {
    res.status(401).json({ error: 'Authentication required.' });
    return;
  }

  try {
    const records = await repositories.settings.findAll({ where: { category: 'clinic_access' } });
    const access: Record<string, string> = {};
    records.forEach((record) => {
      if (record.value && (context.role === 'SUPER_ADMIN' || context.clinicId === record.key.replace(/^clinic_access_/, ''))) {
        access[record.key.replace(/^clinic_access_/, '')] = record.value;
      }
    });
    const clinics = context.role === 'SUPER_ADMIN'
      ? await repositories.clinics.findAll()
      : context.clinicId ? [await repositories.clinics.findById(context.clinicId)] : [];
    clinics.filter(Boolean).forEach((clinic) => {
      if (clinic && getClinicPlanSnapshot(clinic).status === 'EXPIRED') {
        access[clinic.id] = 'Expired';
      }
    });
    res.status(200).json(access);
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : 'Unable to load clinic access.' });
  }
});

app.post('/api/clinic-access', async (req, res) => {
  const context = await authContext(req);
  const clinicId = String(req.body?.clinicId || '').trim();
  const status = String(req.body?.status || '').trim();
  if (!context || !['SUPER_ADMIN', 'CLINIC_ADMIN'].includes(context.role)) {
    res.status(401).json({ error: 'Authentication required.' });
    return;
  }
  if (!clinicId || !['Granted', 'Hold', 'Denied'].includes(status)) {
    res.status(400).json({ error: 'Clinic and valid access status are required.' });
    return;
  }
  if (context.role === 'CLINIC_ADMIN' && context.clinicId !== clinicId) {
    res.status(403).json({ error: 'Clinic access denied.' });
    return;
  }

  try {
    const key = `clinic_access_${clinicId}`;
    const existing = await repositories.settings.findOne({ key, clinic_id: null });
    if (existing) await repositories.settings.update(existing.id, { value: status, category: 'clinic_access' });
    else await repositories.settings.create({ id: crypto.randomUUID(), key, value: status, category: 'clinic_access', clinicId: null } as any);
    const databaseStatus = status === 'Hold' ? 'Pending' : status === 'Denied' ? 'Revoked' : 'Granted';
    const clinic = await repositories.clinics.findById(clinicId);
    const linkedUsers = [
      ...(await repositories.staffUsers.findAll({ where: { clinic_id: clinicId } })),
      ...(await repositories.staffUsers.findAll({ where: { clinic_id: null } })).filter((user) => user.clinicName?.toLowerCase() === clinic?.name?.toLowerCase()),
    ];
    const uniqueUsers = linkedUsers.filter((user, index, all) => all.findIndex((candidate) => candidate.id === user.id) === index);
    await Promise.all(uniqueUsers.map((user) => repositories.staffUsers.update(user.id, { accessStatus: databaseStatus as any })));
    res.status(200).json({ ok: true, clinicId, status });
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : 'Unable to update clinic access.' });
  }
});

app.get('/api/barcodes', async (req, res) => {
  const context = await authContext(req);
  if (!context || context.role !== 'SUPER_ADMIN') {
    res.status(403).json({ error: 'Only Super Admin can access barcode inventory.' });
    return;
  }

  try {
    const records = await repositories.qrCodes.findAllWithDoctorNames();
    const inventory = records.map((record) => {
      return {
        id: record.id,
        barcodeValue: record.code,
        label: record.label,
        notes: record.notes || '',
        status: record.status,
        assignedDoctorId: record.doctorId || null,
        assignedDoctorName: record.doctorName || null,
        assignedClinicId: record.clinicId || null,
        assignedAt: record.assignedAt?.toISOString() || null,
        createdAt: record.createdAt.toISOString(),
        updatedAt: record.updatedAt.toISOString(),
      };
    });
    res.status(200).json(inventory);
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : 'Unable to load barcode inventory.' });
  }
});

app.post('/api/barcodes', async (req, res) => {
  const context = await authContext(req);
  if (!context || context.role !== 'SUPER_ADMIN') {
    res.status(403).json({ error: 'Only Super Admin can manage barcode inventory.' });
    return;
  }

  try {
    const barcodeValue = String(req.body?.barcodeValue || '').trim().toUpperCase();
    const label = String(req.body?.label || '').trim();
    if (!barcodeValue || !label) {
      res.status(400).json({ error: 'Barcode value and label are required.' });
      return;
    }

    const duplicate = await repositories.qrCodes.findByCode(barcodeValue);
    if (duplicate) {
      res.status(409).json({ error: 'That barcode value already exists.' });
      return;
    }

    const record = await repositories.qrCodes.create({
      id: crypto.randomUUID(),
      code: barcodeValue,
      label,
      notes: String(req.body?.notes || '').trim(),
      status: 'AVAILABLE',
      clinicId: null,
      doctorId: null,
      assignedAt: null,
    } as any);
    res.status(201).json({
      id: record.id,
      barcodeValue: record.code,
      label: record.label,
      notes: record.notes || '',
      status: record.status,
      assignedDoctorId: null,
      assignedDoctorName: null,
      assignedClinicId: null,
      assignedAt: null,
      createdAt: record.createdAt.toISOString(),
      updatedAt: record.updatedAt.toISOString(),
    });
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : 'Unable to create barcode.' });
  }
});

app.patch('/api/barcodes/:barcodeId', async (req, res) => {
  const context = await authContext(req);
  if (!context || context.role !== 'SUPER_ADMIN') {
    res.status(403).json({ error: 'Only Super Admin can manage barcode inventory.' });
    return;
  }

  try {
    const record = await repositories.qrCodes.findById(String(req.params.barcodeId || ''));
    if (!record) {
      res.status(404).json({ error: 'Barcode not found.' });
      return;
    }

    const requestedStatus = String(req.body?.status || record.status).trim().toUpperCase();
    const doctorId = req.body?.assignedDoctorId ? String(req.body.assignedDoctorId) : '';
    if (!['AVAILABLE', 'ASSIGNED', 'DISABLED'].includes(requestedStatus)) {
      res.status(400).json({ error: 'Invalid barcode status.' });
      return;
    }

    if (requestedStatus === 'DISABLED') {
      await repositories.qrCodes.update(record.id, { status: 'DISABLED', clinicId: null, doctorId: null, assignedAt: null });
    } else if (doctorId) {
      const doctor = await repositories.doctors.findById(doctorId);
      if (!doctor || doctor.status !== 'active') {
        res.status(404).json({ error: 'Doctor not found.' });
        return;
      }
      const existingAssignment = await repositories.qrCodes.findAssignedToDoctor(doctor.id);
      if (existingAssignment && existingAssignment.id === record.id) {
        res.status(409).json({ error: 'This doctor already has this barcode assigned.' });
        return;
      }
      if (existingAssignment) {
        res.status(409).json({ error: 'This doctor already has a barcode assigned.' });
        return;
      }
      await repositories.qrCodes.update(record.id, {
        doctorId: doctor.id,
        clinicId: doctor.clinicId,
        assignedAt: new Date(),
        status: 'ASSIGNED',
      });
    } else if (requestedStatus === 'ASSIGNED') {
      if (!record.doctorId) {
        res.status(409).json({ error: 'An assigned doctor is required for an assigned QR code.' });
        return;
      }
      await repositories.qrCodes.update(record.id, { status: 'ASSIGNED' });
    } else {
      await repositories.qrCodes.update(record.id, { status: 'AVAILABLE', clinicId: null, doctorId: null, assignedAt: null });
    }

    const updated = await repositories.qrCodes.findById(record.id);
    const updatedDoctor = updated?.doctorId ? await repositories.doctors.findById(updated.doctorId) : null;
    res.status(200).json({
      id: record.id,
      barcodeValue: updated?.code,
      label: updated?.label,
      notes: updated?.notes || '',
      status: updated?.status,
      assignedDoctorId: updated?.doctorId || null,
      assignedDoctorName: updatedDoctor?.name || null,
      assignedClinicId: updated?.clinicId || null,
      assignedAt: updated?.assignedAt?.toISOString() || null,
      createdAt: updated?.createdAt.toISOString(),
      updatedAt: updated?.updatedAt.toISOString(),
    });
  } catch (error) {
    if ((error as any)?.code === 'ER_DUP_ENTRY' || String((error as any)?.message || '').includes('uk_qr_codes_doctor_id')) {
      res.status(409).json({ error: 'This doctor already has a barcode assigned.' });
      return;
    }
    res.status(500).json({ error: error instanceof Error ? error.message : 'Unable to update barcode assignment.' });
  }
});

app.get('/q/:code', async (req, res) => {
  try {
    const qrCode = String(req.params.code || '').trim().toUpperCase();
    if (!qrCode) {
      res.redirect(302, '/booking');
      return;
    }

    const match = await repositories.qrCodes.findByCode(qrCode);

    if (!match) {
      res.status(404).json({ error: 'QR code not found in NEXTQ inventory.' });
      return;
    }

    if (match.status === 'DISABLED') {
      res.status(410).json({ error: 'This QR code has been disabled.' });
      return;
    }

    if (match.clinicId && match.doctorId) {
      res.redirect(302, `/booking?clinicId=${encodeURIComponent(match.clinicId)}&doctorId=${encodeURIComponent(match.doctorId)}`);
      return;
    }

    res.redirect(302, '/booking');
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : 'Unable to resolve QR code.' });
  }
});

app.get('/api/q/:code', async (req, res) => {
  try {
    const qrCode = String(req.params.code || '').trim().toUpperCase();
    if (!qrCode) {
      res.status(400).json({ error: 'QR code is required.' });
      return;
    }

    const match = await repositories.qrCodes.findByCode(qrCode);

    if (!match) {
      res.status(404).json({ error: 'QR code not found in NEXTQ inventory.' });
      return;
    }

    res.status(200).json({
      qrCode: match.code,
      status: match.status,
      clinicId: match.clinicId || null,
      doctorId: match.doctorId || null,
      doctorName: null,
    });
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : 'Unable to resolve QR code.' });
  }
});

app.delete('/api/barcodes/:barcodeId', async (req, res) => {
  const context = await authContext(req);
  if (!context || context.role !== 'SUPER_ADMIN') {
    res.status(403).json({ error: 'Only Super Admin can manage barcode inventory.' });
    return;
  }
  try {
    const record = await repositories.qrCodes.findById(String(req.params.barcodeId || ''));
    if (!record) {
      res.status(404).json({ error: 'Barcode not found.' });
      return;
    }
    if (record.status === 'ASSIGNED') {
      res.status(409).json({ error: 'Assigned QR codes cannot be deleted. Disable the QR code instead.' });
      return;
    }
    await repositories.qrCodes.delete(record.id);
    res.status(204).end();
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : 'Unable to delete barcode.' });
  }
});

app.post('/api/users/reset-password', async (req, res) => {
  try {
    const context = await authContext(req);
    const userId = String(req.body?.userId || '').trim();
    const newPassword = String(req.body?.newPassword || '');

    if (!context) {
      res.status(403).json({ error: 'Authentication required.' });
      return;
    }

    if (!userId) {
      res.status(400).json({ error: 'User id is required.' });
      return;
    }
    if (newPassword.length < 12) {
      res.status(400).json({ error: 'New password must be at least 12 characters.' });
      return;
    }

    const isAdministrator = ['SUPER_ADMIN', 'CLINIC_ADMIN'].includes(context.role);
    const isSelfReset = context.userId === userId;
    if (!isAdministrator && !isSelfReset) {
      res.status(403).json({ error: 'Only administrators can reset other users\' passwords.' });
      return;
    }

    if (context.role === 'CLINIC_ADMIN') {
      const targetUser = await repositories.staffUsers.findById(userId);
      if (!targetUser || targetUser.clinicId !== context.clinicId) {
        res.status(403).json({ error: 'Cannot reset passwords for users outside your clinic.' });
        return;
      }
    }

    const result = await resetUserPassword(userId, newPassword);
    res.status(200).json(result);
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : 'Unable to reset password.' });
  }
});

app.get('/api/auth/me', async (req, res) => {
  const context = await authContext(req);
  if (!context) {
    res.status(401).json({ error: 'Authentication required.' });
    return;
  }
  res.status(200).json({ user: { uid: context.userId, email: context.email, role: context.role, clinicId: context.clinicId, doctorId: context.doctorId } });
});

app.get('/api/db/health', async (_req, res) => {
  try {
    if (!await isDatabaseReady()) throw new Error('Database unavailable');
    res.status(200).json({
      status: 'ok',
      database: 'mysql',
      engine: 'mysql',
      message: 'MySQL-backed database connection is active.',
    });
  } catch (error) {
    res.status(500).json({
      status: 'error',
      database: 'mysql',
      message: 'Database unavailable',
    });
  }
});

app.use('/api/db', requireDatabaseAccessMiddleware);

app.get('/api/db/doc', async (req, res) => {
  try {
    const documentPath = String(req.query.path || '');
    if (!documentPath) {
      res.status(400).json({ error: 'Missing path query parameter.' });
      return;
    }

    const docResult = await readDoc(documentPath);
    if (!docResult) {
      res.status(200).json({ exists: false, data: null });
      return;
    }

    const context = (req as express.Request & { auth?: AuthContext }).auth;
    if (context && !canAccessRecord(context, docResult, tableForPath(documentPath))) {
      res.status(403).json({ error: 'Access denied.' });
      return;
    }
    const table = tableForPath(documentPath);
    const recordClinicId = table === 'clinics' ? docResult.id : (docResult.clinicId || docResult.clinic_id);
    if (context && isPlanGatedRead(table) && recordClinicId && !await requireActivePlan(res, recordClinicId, context.role)) return;
    res.status(200).json({ exists: true, data: sanitizeDatabaseRecord(tableForPath(documentPath), docResult) });
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : 'Unable to load document.' });
  }
});

app.post('/api/db/doc', async (req, res) => {
  try {
    const { path: documentPath, value } = req.body || {};

    if (!documentPath) {
      res.status(400).json({ error: 'Document path is required.' });
      return;
    }

    const context = (req as express.Request & { auth?: AuthContext }).auth;
    const table = tableForPath(documentPath);
    if (context && !canMutateGenericRecord(context, table)) {
      res.status(403).json({ error: 'This role cannot modify records through the generic data API.' });
      return;
    }
    const safeValue = context ? prepareDatabaseMutation(context, table, value || {}) : value || {};
    await enforcePlanWrite(context, table, safeValue, null);
    if (context && context.role !== 'SUPER_ADMIN' && !canAccessRecord(context, safeValue, table)) {
      res.status(403).json({ error: 'Access denied.' });
      return;
    }
    
    const result = await writeDoc(documentPath, safeValue);
    if (tableForPath(documentPath) === 'clinics' && !String(documentPath).includes('/')) {
      const accessKey = `clinic_access_${result.id}`;
      const accessRecord = await repositories.settings.findOne({ key: accessKey, clinic_id: null });
      if (!accessRecord) {
        await repositories.settings.create({ id: crypto.randomUUID(), key: accessKey, value: 'Hold', category: 'clinic_access', clinicId: null } as any);
      }
    }
    res.status(200).json({ id: result.id });
  } catch (error) {
    console.error('Database write error:', error);
    const errorMsg = error instanceof Error ? error.message : String(error);
    res.status(databaseMutationErrorStatus(error)).json({ error: errorMsg });
  }
});

app.post('/api/db/doc/update', async (req, res) => {
  try {
    const { path: documentPath, value } = req.body || {};
    if (!documentPath) {
      res.status(400).json({ error: 'Document path is required.' });
      return;
    }

    const context = (req as express.Request & { auth?: AuthContext }).auth;
    const current = await readDoc(documentPath);
    const table = tableForPath(documentPath);
    if (context && !canMutateGenericRecord(context, table)) {
      res.status(403).json({ error: 'This role cannot modify records through the generic data API.' });
      return;
    }
    const safeValue = context ? prepareDatabaseMutation(context, table, value || {}, current) : value || {};
    await enforcePlanWrite(context, table, safeValue, current);
    if (context && (!current || !canAccessRecord(context, { ...current, ...safeValue }, table))) {
      res.status(403).json({ error: 'Access denied.' });
      return;
    }
    await updateDoc(documentPath, safeValue);
    res.status(200).json({ ok: true });
  } catch (error) {
    res.status(databaseMutationErrorStatus(error)).json({ error: error instanceof Error ? error.message : 'Unable to update document.' });
  }
});

app.post('/api/db/doc/delete', async (req, res) => {
  try {
    const { path: documentPath } = req.body || {};
    if (!documentPath) {
      res.status(400).json({ error: 'Document path is required.' });
      return;
    }

    const context = (req as express.Request & { auth?: AuthContext }).auth;
    const current = await readDoc(documentPath);
    const table = tableForPath(documentPath);
    if (context && !canMutateGenericRecord(context, table)) {
      res.status(403).json({ error: 'This role cannot modify records through the generic data API.' });
      return;
    }
    await enforcePlanWrite(context, table, current || {}, current);
    if (context && (!current || !canAccessRecord(context, current, table))) {
      res.status(403).json({ error: 'Access denied.' });
      return;
    }
    await deleteDoc(documentPath);
    res.status(200).json({ ok: true });
  } catch (error) {
    res.status(databaseMutationErrorStatus(error)).json({ error: error instanceof Error ? error.message : 'Unable to delete document.' });
  }
});

app.post('/api/db/query', async (req, res) => {
  try {
    const { path: collectionPath, clauses = [] } = req.body || {};
    if (!collectionPath) {
      res.status(400).json({ error: 'Collection path is required.' });
      return;
    }

    const docs = await listQuery(collectionPath, clauses || []);
    const context = (req as express.Request & { auth?: AuthContext }).auth;
    const table = tableForPath(collectionPath);
    if (context && isPlanGatedRead(table) && context.clinicId && !await requireActivePlan(res, context.clinicId, context.role)) return;
    const visibleDocs = (context ? docs.filter((item: Record<string, any>) => canAccessRecord(context, item, table)) : docs)
      .map((item: Record<string, any>) => sanitizeDatabaseRecord(table, item));
    res.status(200).json({ docs: visibleDocs });
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : 'Unable to query records.' });
  }
});

// Official Meta WhatsApp Cloud API Webhook Verification (GET)
// Meta sends hub.mode, hub.verify_token, hub.challenge
app.get('/api/whatsapp/webhook', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  const VERIFY_TOKEN = process.env.WHATSAPP_VERIFY_TOKEN;
  if (!VERIFY_TOKEN) {
    console.warn('[WhatsApp Webhook] WHATSAPP_VERIFY_TOKEN not configured.');
    return res.sendStatus(503);
  }

  if (mode === 'subscribe' && token === VERIFY_TOKEN) {
    console.log('[WhatsApp Webhook] Verification successful!');
    return res.status(200).send(challenge);
  }
  return res.sendStatus(403);
});

// Official Meta WhatsApp Cloud API Webhook Inbound Events (POST)
// Receives delivery receipts, read receipts, inbound customer replies
app.post('/api/whatsapp/webhook', (req, res) => {
  const body = req.body;

  // Verify X-Hub-Signature-256 using the WhatsApp App Secret
  const signature = req.headers['x-hub-signature-256'];
  const appSecret = process.env.WHATSAPP_APP_SECRET;
  if (!appSecret) {
    console.warn('[WhatsApp Webhook] WHATSAPP_APP_SECRET not configured.');
    return res.sendStatus(503);
  }
  if (signature) {
    const expected = `sha256=${crypto.createHmac('sha256', appSecret).update(JSON.stringify(body)).digest('hex')}`;
    if (!secureEqual(String(signature), expected)) {
      console.warn('[WhatsApp Webhook] Invalid signature.');
      return res.sendStatus(403);
    }
  } else {
    console.warn('[WhatsApp Webhook] Missing signature header.');
    return res.sendStatus(403);
  }

  if (body.object === 'whatsapp_business_account') {
    return res.status(200).send('EVENT_RECEIVED');
  }
  return res.sendStatus(404);
});

app.post('/api/whatsapp/send-template', (_req, res) => {
  return res.status(503).json({
    success: false,
    status: 'not_configured',
    message: 'WhatsApp integration is not configured or active in this environment.',
  });
});

app.get('/api/queue-summary', async (req, res) => {
  try {
    const context = await authContext(req);
    if (!context || !context.clinicId) {
      res.status(401).json({ error: 'Authentication required.' });
      return;
    }
    if (!await requireActivePlan(res, context.clinicId, context.role)) return;
    const session = await repositories.sessions.findActiveByClinicId(context.clinicId);
    const stats = session
      ? await repositories.tokens.getClinicQueueStats(context.clinicId, session.id)
      : { waiting: 0, serving: 0, completed: 0, total: 0 };
    const clinic = await repositories.clinics.findById(context.clinicId);
    res.status(200).json({
      clinicName: clinic?.name || '',
      totalPatients: stats.total,
      waiting: stats.waiting,
      serving: stats.serving,
      completed: stats.completed,
      status: session ? 'live' : 'idle',
    });
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : 'Unable to load queue summary.' });
  }
});

// Site Settings API
app.get('/api/site/settings', async (_req, res) => {
  try {
    const publicSettingKeys = new Set([
      'siteName', 'siteTagline', 'contactEmail', 'contactPhone', 'whatsappNumber',
      'supportAddress', 'facebookUrl', 'instagramUrl', 'linkedinUrl', 'xUrl',
      'youtubeUrl', 'freeTrialFormUrl', 'salesFormUrl', 'heroTitle', 'heroSubtitle',
      'whatsappEnabled', 'clinicAccessLabel',
    ]);
    const settings = await repositories.settings.findGlobal();
    const latestByKey = new Map<string, { value: string | null; updatedAt: Date }>();

    settings.forEach((setting) => {
      const key = normalizeSettingKey(setting.key || '');
      if (!key || !publicSettingKeys.has(key)) return;
      const updatedAt = setting.updatedAt || new Date(0);
      const current = latestByKey.get(key);
      if (!current || updatedAt.getTime() > current.updatedAt.getTime()) {
        latestByKey.set(key, { value: setting.value ?? null, updatedAt });
      }
    });

    const settingsMap: Record<string, any> = {};
    latestByKey.forEach((entry, key) => {
      settingsMap[key] = entry.value;
    });

    res.status(200).json(settingsMap);
  } catch (error) {
    res.status(500).json({ error: 'Failed to load site settings.' });
  }
});

app.post('/api/site/settings', async (req, res) => {
  try {
    const context = await authContext(req);
    if (!context || context.role !== 'SUPER_ADMIN') {
      res.status(401).json({ error: 'Authentication required.' });
      return;
    }
    const settings = req.body || {};
    for (const [key, value] of Object.entries(settings)) {
      const canonicalKey = normalizeSettingKey(key);
      await repositories.settings.setValue(canonicalKey, String(value), undefined, 'site');
    }
    res.status(200).json({ ok: true });
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : 'Failed to save site settings' });
  }
});

// Site Content Sections API
app.get('/api/site/content', async (_req, res) => {
  try {
    const settings = await repositories.settings.findGlobal();
    const latestByKey = new Map<string, { value: string | null; updatedAt: Date }>();

    settings.forEach((setting) => {
      if (setting.category !== 'content') return;
      const key = normalizeSettingKey(setting.key || '');
      if (!key) return;
      const updatedAt = setting.updatedAt || new Date(0);
      const current = latestByKey.get(key);
      if (!current || updatedAt.getTime() > current.updatedAt.getTime()) {
        latestByKey.set(key, { value: setting.value ?? null, updatedAt });
      }
    });

    const contentMap: Record<string, any> = {};
    latestByKey.forEach((entry, key) => {
      contentMap[key] = entry.value;
    });

    res.status(200).json(contentMap);
  } catch (error) {
    res.status(500).json({ error: 'Failed to load site content.' });
  }
});

app.post('/api/site/content', async (req, res) => {
  try {
    const context = await authContext(req);
    if (!context || context.role !== 'SUPER_ADMIN') {
      res.status(401).json({ error: 'Authentication required.' });
      return;
    }
    const content = req.body || {};
    for (const [key, value] of Object.entries(content)) {
      const canonicalKey = normalizeSettingKey(key);
      await repositories.settings.setValue(canonicalKey, String(value), undefined, 'content');
    }
    res.status(200).json({ ok: true });
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : 'Failed to save site content' });
  }
});

if (process.env.NODE_ENV === 'production') {
  const frontendDirectory = path.join(process.cwd(), 'dist');
  app.use(express.static(frontendDirectory));
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api/')) {
      next();
      return;
    }
    res.sendFile(path.join(frontendDirectory, 'index.html'));
  });
}

app.use((req, res) => {
  res.status(404).json({
    status: 'not_found',
    path: req.originalUrl,
    message: 'Route not found on NEXTQ backend',
  });
});

app.use((err: any, _req: any, res: any, _next: any) => {
  console.error('[Backend Error]', err);
  res.status(500).json({
    status: 'internal_error',
    message: 'Something went wrong on the server',
  });
});

const startServer = async () => {
  await new Promise<void>((resolve, reject) => {
    const server = app.listen(PORT, '0.0.0.0');
    server.once('listening', () => {
      console.log(`NEXTQ backend listening on port ${PORT} (pid ${process.pid})`);
      resolve();
    });
    server.once('error', reject);
  });
};

databaseReady.then(async () => {
  await runQueueRetention();
  startServer();
}).catch((error) => {
  console.error('Failed to start backend server:', error);
  process.exit(1);
});

// Graceful shutdown: close the database pool on SIGTERM/SIGINT
const shutdown = async () => {
  try {
    const { closeDatabase } = await import('./server/db.js');
    await closeDatabase();
  } catch {
    // Best-effort cleanup
  }
  process.exit(0);
};
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

export default app;
