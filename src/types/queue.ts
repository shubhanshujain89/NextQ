export type UserRole = 'DOCTOR' | 'RECEPTIONIST' | 'PATIENT' | 'TV_DISPLAY';

export type FeaturePlan = 'TRIAL' | 'BASIC' | 'STANDARD' | 'PREMIUM' | 'ENTERPRISE';

export interface ClinicPack {
  id: string;
  plan: FeaturePlan;
  label: string;
  validityDays: number;
  status: 'ACTIVE' | 'EXPIRED' | 'PAUSED';
  startDate: string;
  expiryDate: string;
}

export type DoctorStatus = 'IN' | 'OUT';

export type TokenType = 'ONLINE' | 'WALK_IN' | 'EMERGENCY';

export type TokenStatus = 'WAITING' | 'CALLED' | 'IN_CONSULTATION' | 'SERVING' | 'COMPLETED' | 'HOLD' | 'NO_SHOW' | 'CANCELLED';

export interface PreConsultationAttachment {
  name: string;
  type: string;
  size?: number;
  dataUrl?: string; // Base64 preview for simulated patient uploads
}

export interface PreConsultationNotes {
  symptoms: string;
  duration?: string;
  severity?: 'Mild' | 'Moderate' | 'Severe' | 'Critical';
  painScale?: number; // 1-10
  allergies?: string;
  feverTemp?: string;
  temperature?: string;
  oxygenSaturation?: string; // e.g. "98%"
  spo2?: string;
  bpReading?: string;
  bloodPressure?: string;
  weight?: string; // in kg
  triageNotes?: string;
  receptionNotes?: string;
  attachments?: PreConsultationAttachment[];
  submittedAt?: string;
  lastEditedBy?: 'PATIENT' | 'DOCTOR' | 'RECEPTIONIST';
}

export interface TokenItem {
  id: string;
  clinicId: string;
  doctorId?: string;
  sessionId: string;
  tokenNumber: string; // e.g. "A-101", "W-102", "E-01"
  sequenceNumber: number;
  scheduledSlot?: string;
  patientId?: string;
  patientName: string;
  patientPhone: string;
  patientAge?: number;
  patientGender?: 'Male' | 'Female' | 'Other';
  tokenType: TokenType;
  status: TokenStatus;
  isEmergency?: boolean;
  isHold?: boolean;
  priority?: number; // Lower number = higher priority
  amountPaid: number;
  paymentMode?: 'PAY_NOW' | 'PAY_AT_CLINIC';
  paymentMethod: 'UPI' | 'CARD' | 'CASH' | 'NETBANKING' | 'PENDING' | 'PAY_AT_CLINIC' | 'QR_BARCODE' | 'PAYMENT_GATEWAY' | 'WALLET';
  paymentStatus: 'PAID' | 'PENDING' | 'REFUNDED' | 'PAY_AT_CLINIC';
  createdAt: string;
  calledAt?: string;
  completedAt?: string;
  consultationDurationSeconds?: number;
  preConsultationNotes?: PreConsultationNotes;
  // Optional Vitals recorded at Reception
  weight?: string; // e.g. "68 kg"
  temperature?: string; // e.g. "98.6 °F"
  oxygenSaturation?: string; // e.g. "98%"
  bloodPressure?: string; // e.g. "120/80 mmHg"
  triageNotes?: string; // Receptionist observation note
  doctorNotes?: string;
  whatsappSentCount?: number;
  whatsappLastSentAt?: string;
}

export interface Clinic {
  id: string;
  name: string;
  doctorId?: string;
  doctorName?: string;
  doctorPhoto?: string;
  specialty?: string;
  cabinNumber?: string;
  doctorStatus: DoctorStatus | 'ON_BREAK' | 'EMERGENCY';
  delayMinutes: number; // Broadcast delay in minutes
  delayReason?: string;
  avgConsultationMinutes: number; // Rolling average calculated
  consultationFee: number;
  currentRunningToken?: string;
  currentRunningTokenId?: string;
  activeSessionId?: string;
  totalPatientsToday?: number;
  revenueToday?: number;
  phone?: string;
  address?: string;
  email?: string;
  operatingHours?: string;
  qrCodeUrl?: string;
  featurePlan?: FeaturePlan;
  subscriptionPack?: ClinicPack | null;
  subscriptionStatus?: 'ACTIVE' | 'EXPIRED' | 'PAUSED';
  subscriptionStartedAt?: string;
  subscriptionExpiresAt?: string;
  maxDoctors?: number;
  maxStaffUsers?: number;
  paymentsEnabled?: boolean;
  whatsappEnabled?: boolean;
  patientNotesEnabled?: boolean;
  whatsappNotificationsEnabled?: boolean;
  hasPaymentGateway?: boolean;
  clinicUpiId?: string;
}

export interface ClinicPayment {
  id: string;
  clinicId: string;
  clinicName: string;
  pack: FeaturePlan;
  amount: number;
  durationDays: number;
  status: 'PAID' | 'PENDING';
  paidAt: string;
  startDate: string;
  expiryDate: string;
  notes?: string;
}

export interface QueueSession {
  id: string;
  clinicId: string;
  date: string;
  activeTokenId?: string;
  activeTokenNumber?: string;
  status: SessionStatus;
  totalTokensIssued: number;
  rollingAvgMinutes: number;
  completedCount: number;
  totalRevenue: number;
}

// Unifies client and server session statuses.
// Client views may only render a subset, but the type accepts the full server model.
export type SessionStatus = 'ACTIVE' | 'PAUSED' | 'CLOSED' | 'COMPLETED' | 'CANCELLED';

export interface WhatsAppLog {
  id: string;
  tokenId: string;
  patientName: string;
  phone: string;
  templateName: string;
  messageBody: string;
  // Accepts both server (lowercase) and legacy client (UPPERCASE) values.
  // WhatsAppLogsModal normalizes casing for display.
  status: 'sent' | 'delivered' | 'read' | 'failed' | 'pending' | 'SENT' | 'DELIVERED' | 'READ' | 'QUEUED';
  timestamp: string;
  metaMessageId?: string;
}

export interface QueueMetrics {
  totalWaiting: number;
  totalCompleted: number;
  totalHold: number;
  totalNoShow: number;
  totalEmergency: number;
  totalOnline: number;
  totalWalkIn: number;
  rollingAvgMinutes: number;
  estimatedNextWaitMinutes: number;
  totalRevenue: number;
}
