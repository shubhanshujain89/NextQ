/**
 * Repository Index
 * Exports all repositories for easy importing
 */

export * from './base.js';
export * from './clinics.js';
export * from './doctors.js';
export * from './staffUsers.js';
export * from './patients.js';
export * from './sessions.js';
export * from './appointments.js';
export * from './tokens.js';
export * from './queueEvents.js';
export * from './doctorStatus.js';
export * from './settings.js';
export * from './qrCodes.js';
export * from './whatsAppLogs.js';

// Repository instances
import { clinicRepository } from './clinics.js';
import { doctorRepository } from './doctors.js';
import { staffUserRepository } from './staffUsers.js';
import { patientRepository } from './patients.js';
import { sessionRepository } from './sessions.js';
import { appointmentRepository } from './appointments.js';
import { tokenRepository } from './tokens.js';
import { queueEventRepository } from './queueEvents.js';
import { doctorStatusRepository } from './doctorStatus.js';
import { settingsRepository } from './settings.js';
import { qrCodeRepository } from './qrCodes.js';
import { whatsAppLogRepository } from './whatsAppLogs.js';

export const repositories = {
  clinics: clinicRepository,
  doctors: doctorRepository,
  staffUsers: staffUserRepository,
  patients: patientRepository,
  sessions: sessionRepository,
  appointments: appointmentRepository,
  tokens: tokenRepository,
  queueEvents: queueEventRepository,
  doctorStatus: doctorStatusRepository,
  settings: settingsRepository,
  qrCodes: qrCodeRepository,
  whatsAppLogs: whatsAppLogRepository,
};