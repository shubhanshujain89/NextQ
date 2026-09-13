export const makeDoctorBookingUrl = (
  clinicId: string,
  doctorId: string,
  baseUrl = typeof window !== 'undefined' ? window.location.origin : 'http://localhost:5173'
): string => {
  return `${baseUrl.replace(/\/$/, '')}/booking?clinicId=${encodeURIComponent(clinicId)}&doctorId=${encodeURIComponent(doctorId)}`;
};

export const extractBookingTokenNumber = (
  payload: { tokenNumber?: string | null } | null | undefined
): string => {
  const tokenNumber = payload?.tokenNumber;
  return typeof tokenNumber === 'string' ? tokenNumber.trim() : '';
};
