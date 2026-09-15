const DEFAULT_CLINIC_TIMEZONE = 'Asia/Kolkata';

const parseClockMinutes = (value: string): number | null => {
  const match = String(value || '').trim().match(/^(\d{1,2}):(\d{2})\s*(AM|PM)?$/i);
  if (!match) return null;

  let hours = Number(match[1]);
  const minutes = Number(match[2]);
  const meridiem = String(match[3] || '').toUpperCase();
  if (meridiem === 'PM' && hours < 12) hours += 12;
  if (meridiem === 'AM' && hours === 12) hours = 0;
  if (hours > 23 || minutes > 59) return null;
  return hours * 60 + minutes;
};

export const getClinicLocalMinutes = (now = new Date(), timezone = DEFAULT_CLINIC_TIMEZONE): number => {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: getClinicTimezone(timezone),
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(now);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return Number(values.hour) * 60 + Number(values.minute);
};

export const getSlotEndMinutes = (slotValue: string): number | null => {
  const match = String(slotValue || '').trim().match(/^[^,]+?\s*-\s*(\d{1,2}:\d{2}\s*(?:AM|PM)?)$/i);
  return match ? parseClockMinutes(match[1]) : null;
};

export const getClinicTimezone = (timezone?: string) => timezone || DEFAULT_CLINIC_TIMEZONE;

export const getClinicBusinessDate = (now = new Date(), timezone = DEFAULT_CLINIC_TIMEZONE): string => {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: getClinicTimezone(timezone),
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
};

export const getClinicDayStartUtc = (businessDate: string, timezone = DEFAULT_CLINIC_TIMEZONE): Date => {
  const [year, month, day] = businessDate.split('-').map(Number);
  const probe = new Date(Date.UTC(year, month - 1, day));
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: getClinicTimezone(timezone),
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(probe);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  const localAsUtc = Date.UTC(Number(values.year), Number(values.month) - 1, Number(values.day), Number(values.hour), Number(values.minute), Number(values.second));
  const offsetMs = localAsUtc - probe.getTime();
  return new Date(Date.UTC(year, month - 1, day) - offsetMs);
};

export const getClinicDateTimeUtc = (dateValue: string | undefined, slotValue: string | undefined, timezone = DEFAULT_CLINIC_TIMEZONE): Date | null => {
  const dateMatch = String(dateValue || '').trim().match(/^(\d{4})-(\d{2})-(\d{2})/);
  const slotMatch = String(slotValue || '').trim().match(/^(\d{1,2}):(\d{2})\s*(AM|PM)?/i);
  if (!dateMatch || !slotMatch) return null;

  let hour = Number(slotMatch[1]);
  const minute = Number(slotMatch[2]);
  const meridiem = String(slotMatch[3] || '').toUpperCase();
  if (meridiem === 'PM' && hour < 12) hour += 12;
  if (meridiem === 'AM' && hour === 12) hour = 0;
  if (!Number.isInteger(hour) || hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;

  const year = Number(dateMatch[1]);
  const month = Number(dateMatch[2]);
  const day = Number(dateMatch[3]);
  const calendarDate = new Date(Date.UTC(year, month - 1, day));
  if (
    calendarDate.getUTCFullYear() !== year
    || calendarDate.getUTCMonth() !== month - 1
    || calendarDate.getUTCDate() !== day
  ) return null;
  const naiveUtc = Date.UTC(year, month - 1, day, hour, minute);
  const probe = new Date(naiveUtc);
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: getClinicTimezone(timezone),
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(probe);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  const localAsUtc = Date.UTC(
    Number(values.year),
    Number(values.month) - 1,
    Number(values.day),
    Number(values.hour),
    Number(values.minute),
    Number(values.second)
  );
  const offsetMs = localAsUtc - naiveUtc;
  return new Date(naiveUtc - offsetMs);
};

export const getSlotStartMinutes = (slotValue: string): number | null => {
  const match = String(slotValue || '').trim().match(/^(\d{1,2}:\d{2}\s*(?:AM|PM)?)/i);
  return match ? parseClockMinutes(match[1]) : null;
};

export const isClinicSlotStarted = (slotValue: string | undefined, now = new Date(), timezone = DEFAULT_CLINIC_TIMEZONE): boolean => {
  const startMinutes = getSlotStartMinutes(String(slotValue || ''));
  return startMinutes === null || getClinicLocalMinutes(now, timezone) >= startMinutes;
};