import type { AuthRole } from './authorization.js';

export const serializeStaffQueueToken = (token: any, role: AuthRole) => {
  const response: Record<string, unknown> = {
    id: token.id,
    clinicId: token.clinicId,
    sessionId: token.sessionId,
    tokenNumber: token.tokenNumber,
    sequenceNumber: token.sequenceNumber,
    scheduledSlot: token.scheduledSlot,
    patientName: token.patientName,
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
  };

  if (role === 'DOCTOR' || role === 'STAFF') {
    response.patientPhone = token.patientPhone;
    response.preConsultationNotes = token.preConsultationNotes;
    response.weight = token.weight;
    response.temperature = token.temperature;
    response.bloodPressure = token.bloodPressure;
    response.oxygenSaturation = token.oxygenSaturation;
    response.triageNotes = token.triageNotes;
  }
  if (role === 'DOCTOR') response.doctorNotes = token.doctorNotes;
  return response;
};
