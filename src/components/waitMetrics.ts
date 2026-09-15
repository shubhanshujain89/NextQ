export interface AverageWaitSummary {
  averageWaitMinutes: number;
  label: string;
  suffix: string;
}

export function getAverageWaitSummary(
  doctorStatus: string | undefined,
  waitingTokens: Array<{ createdAt?: string | null }>,
  averageConsultationMinutes?: number,
): AverageWaitSummary {
  if (doctorStatus !== 'IN') {
    return {
      averageWaitMinutes: 0,
      label: 'Doctor not in yet',
      suffix: '',
    };
  }

  if (!waitingTokens.length) {
    return {
      averageWaitMinutes: 0,
      label: '0',
      suffix: 'mins',
    };
  }

  const consultationMinutes = Number(averageConsultationMinutes);
  const minutesPerPatient = Number.isFinite(consultationMinutes) && consultationMinutes > 0
    ? consultationMinutes
    : 5;
  const averageWaitMinutes = Number((waitingTokens.length * minutesPerPatient).toFixed(1));

  return {
    averageWaitMinutes,
    label: String(averageWaitMinutes),
    suffix: 'mins',
  };
}
