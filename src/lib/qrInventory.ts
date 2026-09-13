export type QrInventoryStatus = 'AVAILABLE' | 'ASSIGNED' | 'DISABLED';

export const normalizeQrCodeValue = (value: string | null | undefined): string => {
  const raw = String(value ?? '').trim().toUpperCase();
  if (!raw) return 'NQ-0001';

  const fromUrl = raw.match(/(?:^|[/?#])Q\/([A-Z0-9-]+)/i);
  const candidate = fromUrl ? fromUrl[1] : raw.replace(/^https?:\/\/[^\s]+\//i, '').replace(/[^A-Z0-9-]/g, '').trim();
  const normalized = candidate.startsWith('NQ-') ? candidate : `NQ-${candidate.replace(/^NQ-?/i, '').replace(/[^A-Z0-9]/g, '')}`;

  if (!normalized || normalized === 'NQ-') return 'NQ-0001';
  return normalized.length > 16 ? normalized.slice(0, 16) : normalized;
};

export const normalizeQrStatus = (value?: string | null, assignedDoctorId?: string | null): QrInventoryStatus => {
  const normalized = String(value ?? '').trim().toUpperCase();
  if (normalized === 'DISABLED') return 'DISABLED';
  if (normalized === 'ASSIGNED') return 'ASSIGNED';
  if (String(assignedDoctorId ?? '').trim()) return 'ASSIGNED';
  return 'AVAILABLE';
};

export const buildQrPublicUrl = (qrCode: string, baseUrl = 'https://nextq.in') => {
  const normalized = normalizeQrCodeValue(qrCode);
  const cleanBase = String(baseUrl || 'https://nextq.in').replace(/\/$/, '');
  return `${cleanBase}/q/${normalized}`;
};
