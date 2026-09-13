import React, { useState, useEffect } from 'react';
import { Calendar, Clock, MapPin, Stethoscope, ChevronRight, Check, Heart } from 'lucide-react';
import { PhoneInput } from '../components/PhoneInput';
import { buildTrackingHref } from '../lib/trackingLink';
import { formatDoctorName } from '../lib/doctorName';

interface Clinic {
  id: string;
  name: string;
  address: string;
  phone: string;
  email: string;
  specializations: string[];
  operatingHours: string;
}

interface Doctor {
  id: string;
  name: string;
  specialization: string;
  clinicId: string;
  consultationFee: number;
  availableDays: string[];
  availableHours: string;
  rating: number;
}

interface PatientBookingProps {
  onBack: () => void;
}

interface BookingSlot {
  label: string;
  value: string;
}

interface EarliestBookingSchedule {
  date: Date;
  dateLabel: string;
  slots: BookingSlot[];
  autoSelectedSlot?: string;
}

const normalizeDayName = (day: string) => String(day || '').trim().toLowerCase();

const toShortWeekday = (date: Date) => new Intl.DateTimeFormat('en-US', { weekday: 'short' }).format(date);

const formatScheduleDate = (date: Date) => new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }).format(date);

const parseTimeToMinutes = (timeText: string) => {
  const match = String(timeText || '').match(/^(\d{1,2}):(\d{2})\s*(AM|PM)?$/i);
  if (!match) return 0;

  let hours = Number(match[1]);
  const minutes = Number(match[2]);
  const suffix = String(match[3] || '').toUpperCase();

  if (suffix === 'PM' && hours < 12) hours += 12;
  if (suffix === 'AM' && hours === 12) hours = 0;

  return hours * 60 + minutes;
};

const parseDoctorSlots = (availableHours: string): BookingSlot[] => {
  const windows = String(availableHours || '')
    .split(',')
    .map((segment) => segment.trim())
    .filter(Boolean);

  if (!windows.length) return [];

  return windows.map((window) => {
    const match = window.match(/^(\d{1,2}:\d{2}\s*(?:AM|PM)?)\s*-\s*(\d{1,2}:\d{2}\s*(?:AM|PM)?)$/i);
    if (!match) {
      return { label: window, value: window };
    }

    return {
      label: `${match[1].trim()} - ${match[2].trim()}`,
      value: `${match[1].trim()} - ${match[2].trim()}`,
    };
  });
};

const extractStartTimeFromSlot = (slotValue: string): string | null => {
  const match = String(slotValue || '').match(/^(\d{1,2}:\d{2}\s*(?:AM|PM)?)/i);
  return match ? match[1].trim() : null;
};

const getClinicAvailabilityStatus = (doctorList: Doctor[] = []) => {
  const allStarts = doctorList
    .flatMap((doctor) => parseDoctorSlots(doctor.availableHours || '').map((slot) => slot.value))
    .map(extractStartTimeFromSlot)
    .filter((time): time is string => Boolean(time));

  if (!allStarts.length) {
    return { tone: 'warning' as const, label: 'Moderate wait' };
  }

  if (doctorList.length >= 2) {
    return { tone: 'success' as const, label: 'Available today' };
  }

  return { tone: 'success' as const, label: `Next available: ${allStarts[0]}` };
};

export const buildBookingSelectionUrl = (
  clinicId?: string,
  doctorId?: string,
  pathname = typeof window !== 'undefined' ? window.location.pathname : '/booking',
) => {
  const params = new URLSearchParams();
  if (clinicId) params.set('clinicId', clinicId);
  if (doctorId) params.set('doctorId', doctorId);
  const query = params.toString();
  return query ? `${pathname}?${query}` : pathname;
};

const syncBookingSelectionUrl = (clinicId?: string, doctorId?: string) => {
  if (typeof window === 'undefined') return;
  window.history.replaceState({}, '', buildBookingSelectionUrl(clinicId, doctorId, window.location.pathname));
};

export const getEarliestBookingSchedule = (doctor: Pick<Doctor, 'availableDays' | 'availableHours'>, referenceDate = new Date()): EarliestBookingSchedule | null => {
  const slots = parseDoctorSlots(doctor.availableHours || '');
  if (!slots.length) return null;

  const nextDates = Array.from({ length: 21 }, (_, index) => {
    const date = new Date(referenceDate);
    date.setHours(0, 0, 0, 0);
    date.setDate(date.getDate() + index);
    return date;
  });

  const normalizedAvailableDays = new Set(
    (doctor.availableDays || []).map((day) => normalizeDayName(day).slice(0, 3))
  );

  for (const date of nextDates) {
    const weekdayShort = toShortWeekday(date).toLowerCase().slice(0, 3);
    const isAvailable = normalizedAvailableDays.size === 0 || normalizedAvailableDays.has(weekdayShort);

    if (!isAvailable) continue;

    const autoSelectedSlot = slots.length === 1 ? slots[0].value : undefined;
    return {
      date,
      dateLabel: `${toShortWeekday(date)}, ${formatScheduleDate(date)}`,
      slots,
      autoSelectedSlot,
    };
  }

  return {
    date: nextDates[0],
    dateLabel: `${toShortWeekday(nextDates[0])}, ${formatScheduleDate(nextDates[0])}`,
    slots,
    autoSelectedSlot: slots.length === 1 ? slots[0].value : undefined,
  };
};

const fallbackClinics: Clinic[] = [
  {
    id: 'demo-clinic-1',
    name: 'NEXTQ Care Clinic',
    address: '12 Green Park, New Delhi',
    phone: '+91 98765 43210',
    email: 'care@nextq.in',
    specializations: ['General Medicine', 'Dermatology', 'Pediatrics'],
    operatingHours: 'Mon-Sat • 9:00 AM - 8:00 PM',
  },
  {
    id: 'demo-clinic-2',
    name: 'City Family Hospital',
    address: '78 Sector 15, Noida',
    phone: '+91 99887 66554',
    email: 'hello@cityfamily.in',
    specializations: ['Orthopedics', 'Cardiology', 'Neurology'],
    operatingHours: 'Mon-Sun • 8:00 AM - 9:00 PM',
  },
];

const fallbackDoctorsByClinic: Record<string, Doctor[]> = {
  'demo-clinic-1': [
    {
      id: 'demo-doctor-1',
      name: 'Ananya Verma',
      specialization: 'General Medicine',
      clinicId: 'demo-clinic-1',
      consultationFee: 499,
      availableDays: ['Mon', 'Tue', 'Wed', 'Thu'],
      availableHours: '9:00 AM - 1:00 PM',
      rating: 4.8,
    },
    {
      id: 'demo-doctor-2',
      name: 'Rohan Mehta',
      specialization: 'Dermatology',
      clinicId: 'demo-clinic-1',
      consultationFee: 699,
      availableDays: ['Fri', 'Sat'],
      availableHours: '2:00 PM - 6:00 PM',
      rating: 4.9,
    },
  ],
  'demo-clinic-2': [
    {
      id: 'demo-doctor-3',
      name: 'Nitin Kapoor',
      specialization: 'Orthopedics',
      clinicId: 'demo-clinic-2',
      consultationFee: 799,
      availableDays: ['Mon', 'Wed', 'Fri'],
      availableHours: '10:00 AM - 4:00 PM',
      rating: 4.7,
    },
    {
      id: 'demo-doctor-4',
      name: 'Pooja Sharma',
      specialization: 'Cardiology',
      clinicId: 'demo-clinic-2',
      consultationFee: 899,
      availableDays: ['Tue', 'Thu', 'Sat'],
      availableHours: '11:00 AM - 5:00 PM',
      rating: 4.9,
    },
  ],
};

const getDemoDoctorsForClinic = (clinicId: string) => fallbackDoctorsByClinic[clinicId] || [];

export const isDuplicateBookingError = (message: string = '') =>
  /already registered for this mobile number today|already.*booked.*this.*mobile.*number|duplicate.*mobile.*number/i.test(message);

export const resolveLinkedBookingSelection = (
  linkedClinicId: string,
  linkedDoctorId: string,
  clinicList: Clinic[],
  doctorList: Doctor[] = [],
) => {
  const availableClinics = clinicList.length ? clinicList : fallbackClinics;
  const selectedClinic = availableClinics.find((clinic) => clinic.id === linkedClinicId)
    || fallbackClinics.find((clinic) => clinic.id === linkedClinicId)
    || null;

  if (!selectedClinic) {
    return { selectedClinic: null, selectedDoctor: null, step: 'clinic' as const };
  }

  const candidateDoctors = doctorList.length ? doctorList : getDemoDoctorsForClinic(selectedClinic.id);
  const selectedDoctor = candidateDoctors.find((doctor) => doctor.id === linkedDoctorId)
    || getDemoDoctorsForClinic(selectedClinic.id).find((doctor) => doctor.id === linkedDoctorId)
    || null;

  if (!selectedDoctor) {
    return { selectedClinic, selectedDoctor: null, step: 'doctor' as const };
  }

  return { selectedClinic, selectedDoctor, step: 'booking' as const };
};

export const PatientBooking: React.FC<PatientBookingProps> = ({ onBack }) => {
  const bookingParams = new URLSearchParams(window.location.search);
  const linkedClinicId = bookingParams.get('clinicId') || '';
  const linkedDoctorId = bookingParams.get('doctorId') || '';
  const [step, setStep] = useState<'clinic' | 'doctor' | 'booking' | 'confirm'>(
    linkedClinicId && linkedDoctorId ? 'booking' : 'clinic'
  );
  const [clinics, setClinics] = useState<Clinic[]>([]);
  const [doctors, setDoctors] = useState<Doctor[]>([]);
  const [clinicAvailability, setClinicAvailability] = useState<Record<string, { tone: 'success' | 'warning'; label: string }>>({});
  const [clinicSearch, setClinicSearch] = useState('');
  const [loading, setLoading] = useState(true);
  
  const [selectedClinic, setSelectedClinic] = useState<Clinic | null>(null);
  const [selectedDoctor, setSelectedDoctor] = useState<Doctor | null>(null);
  const [selectedSpecialization, setSelectedSpecialization] = useState('');
  const [selectedAppointmentDate, setSelectedAppointmentDate] = useState<Date | null>(null);
  const [selectedAppointmentSlot, setSelectedAppointmentSlot] = useState<string>('');
  const [generatedTokenNumber, setGeneratedTokenNumber] = useState('');
  
  const [bookingData, setBookingData] = useState({
    patientName: '',
    phone: '',
    age: '',
  });

  const showClinicSearch = clinics.length > 3;
  const showSpecializationFilter = (selectedClinic?.specializations?.length ?? 0) > 3;
  const filteredClinics = showClinicSearch
    ? clinics.filter((clinic) => {
        const term = clinicSearch.trim().toLowerCase();
        if (!term) return true;
        return (
          clinic.name.toLowerCase().includes(term) ||
          clinic.address.toLowerCase().includes(term) ||
          clinic.specializations.some((spec) => spec.toLowerCase().includes(term))
        );
      })
    : clinics;

  useEffect(() => {
    fetchClinics();
  }, []);

  const fetchClinics = async () => {
    try {
      const response = await fetch('/api/clinics');
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || 'Unable to load clinics.');
      const clinicList = (payload || []) as Clinic[];
      const availableClinics = clinicList;
      setClinics(availableClinics);

      const clinicAvailabilityMap = Object.fromEntries(
        await Promise.all(
          availableClinics.map(async (clinic) => {
            try {
              const doctorsResponse = await fetch(`/api/clinics/${encodeURIComponent(clinic.id)}/doctors`);
              const doctorsPayload = await doctorsResponse.json();
              const doctorList = (doctorsResponse.ok ? (doctorsPayload || []) as Doctor[] : []);
              return [clinic.id, getClinicAvailabilityStatus(doctorList.length ? doctorList : getDemoDoctorsForClinic(clinic.id))];
            } catch {
              return [clinic.id, getClinicAvailabilityStatus(getDemoDoctorsForClinic(clinic.id))];
            }
          })
        )
      );
      setClinicAvailability(clinicAvailabilityMap);

      if (linkedClinicId && linkedDoctorId) {
        const availableClinics = clinicList;
        const linkedClinic = availableClinics.find((clinic) => clinic.id === linkedClinicId);
        if (linkedClinic) {
          const doctorsResponse = await fetch(`/api/clinics/${encodeURIComponent(linkedClinic.id)}/doctors`);
          const doctorsPayload = await doctorsResponse.json();
          const apiDoctorList = (doctorsResponse.ok ? (doctorsPayload || []) as Doctor[] : []);
          const doctorList = apiDoctorList.length ? apiDoctorList : getDemoDoctorsForClinic(linkedClinic.id);
          const linkedSelection = resolveLinkedBookingSelection(linkedClinicId, linkedDoctorId, availableClinics, doctorList);
          setSelectedClinic(linkedSelection.selectedClinic);
          setDoctors(doctorList);
          if (linkedSelection.selectedDoctor) {
            const schedule = getEarliestBookingSchedule(linkedSelection.selectedDoctor);
            setSelectedDoctor(linkedSelection.selectedDoctor);
            setSelectedAppointmentDate(schedule?.date ?? null);
            setSelectedAppointmentSlot(schedule?.autoSelectedSlot || schedule?.slots[0]?.value || '');
            syncBookingSelectionUrl(linkedSelection.selectedClinic?.id || linkedClinic.id, linkedSelection.selectedDoctor.id);
            setStep(linkedSelection.step);
          } else {
            setStep(linkedSelection.step);
          }
        } else {
          setStep('clinic');
        }
      }
      setLoading(false);
    } catch (error) {
      console.error('Error fetching clinics:', error);
      setClinics(fallbackClinics);
      setClinicAvailability(
        Object.fromEntries(
          fallbackClinics.map((clinic) => [clinic.id, getClinicAvailabilityStatus(getDemoDoctorsForClinic(clinic.id))])
        )
      );
      if (linkedClinicId && linkedDoctorId) {
        const linkedSelection = resolveLinkedBookingSelection(linkedClinicId, linkedDoctorId, fallbackClinics, getDemoDoctorsForClinic(linkedClinicId));
        setSelectedClinic(linkedSelection.selectedClinic);
        setDoctors(getDemoDoctorsForClinic(linkedClinicId));
        if (linkedSelection.selectedDoctor) {
          const schedule = getEarliestBookingSchedule(linkedSelection.selectedDoctor);
          setSelectedDoctor(linkedSelection.selectedDoctor);
          setSelectedAppointmentDate(schedule?.date ?? null);
          setSelectedAppointmentSlot(schedule?.autoSelectedSlot || schedule?.slots[0]?.value || '');
          syncBookingSelectionUrl(linkedSelection.selectedClinic?.id || linkedClinicId, linkedSelection.selectedDoctor.id);
        }
        setStep(linkedSelection.step);
      } else if (linkedClinicId) {
        const linkedClinic = fallbackClinics.find((clinic) => clinic.id === linkedClinicId);
        if (linkedClinic) {
          setSelectedClinic(linkedClinic);
          setDoctors(getDemoDoctorsForClinic(linkedClinic.id));
          setStep('doctor');
        }
      }
      setLoading(false);
    }
  };

  const fetchDoctors = async (clinicId: string, specialization?: string) => {
    try {
      const url = new URL(`/api/clinics/${clinicId}/doctors`, window.location.origin);
      if (specialization) {
        url.searchParams.set('specialization', specialization);
      }
      const response = await fetch(url.toString());
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || 'Unable to load doctors.');
      const doctorList = (payload || []) as Doctor[];
      setDoctors(doctorList.length ? doctorList : getDemoDoctorsForClinic(clinicId));
    } catch (error) {
      console.error('Error fetching doctors:', error);
      setDoctors(getDemoDoctorsForClinic(clinicId));
    }
  };

  const handleClinicSelect = (clinic: Clinic) => {
    setSelectedClinic(clinic);
    setSelectedDoctor(null);
    setSelectedAppointmentDate(null);
    setSelectedAppointmentSlot('');
    syncBookingSelectionUrl(clinic.id);
    fetchDoctors(clinic.id);
    setStep('doctor');
  };

  const handleSpecializationFilter = (spec: string) => {
    setSelectedSpecialization(spec);
    if (selectedClinic) {
      fetchDoctors(selectedClinic.id, spec);
    }
  };

  const handleDoctorSelect = (doctor: Doctor) => {
    const schedule = getEarliestBookingSchedule(doctor);
    setSelectedDoctor(doctor);
    setSelectedAppointmentDate(schedule?.date ?? null);
    setSelectedAppointmentSlot(schedule?.autoSelectedSlot || schedule?.slots[0]?.value || '');
    syncBookingSelectionUrl(selectedClinic?.id || doctor.clinicId, doctor.id);
    setStep('booking');
  };

  const handleBookAppointment = async () => {
    if (!selectedClinic || !selectedDoctor || !bookingData.patientName.trim() || !bookingData.phone.trim()) {
      alert('Patient name and mobile number are required.');
      return;
    }

    try {
      const response = await fetch('/api/patient/book', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          clinicId: selectedClinic.id,
          doctorId: selectedDoctor.id,
          patientName: bookingData.patientName,
          phone: bookingData.phone,
          age: bookingData.age ? Number(bookingData.age) : undefined,
          appointmentDate: selectedAppointmentDate ? selectedAppointmentDate.toISOString() : undefined,
          appointmentSlot: selectedAppointmentSlot || undefined,
        }),
      });
      const responseText = await response.text();
      let payload: { tokenId?: string; tokenNumber?: string; error?: string } = {};
      if (responseText.trim()) {
        try {
          payload = JSON.parse(responseText) as typeof payload;
        } catch {
          throw new Error(`Booking service returned an invalid response (${response.status}).`);
        }
      }
      if (!response.ok) throw new Error(payload.error || `Unable to book appointment (${response.status}).`);
      setGeneratedTokenNumber(payload.tokenNumber || '');
      setStep('confirm');
    } catch (error) {
      console.error('Error booking appointment:', error);
      const errorMessage = error instanceof Error ? error.message : 'Unable to book appointment.';

      if (isDuplicateBookingError(errorMessage)) {
        setGeneratedTokenNumber('');
        setStep('booking');
        alert(errorMessage);
        return;
      }

      setGeneratedTokenNumber('');
      setStep('booking');
      alert(errorMessage);
    }
  };

  if (loading) {
    return (
      <div className="bg-gradient-to-b from-slate-950 via-slate-900 to-slate-950 text-white flex items-center justify-center py-8">
        <p className="text-slate-400">Loading clinics...</p>
      </div>
    );
  }

  return (
    <div className="bg-slate-50 text-slate-900">
      <header className="border-b border-slate-200 bg-white/90 backdrop-blur-sm">
        <div className="mx-auto flex max-w-none flex-col items-center gap-3 px-2 py-3 sm:grid sm:grid-cols-[1fr_auto_1fr] sm:items-center sm:gap-4 sm:px-4 lg:px-5">
          <div className="flex min-w-0 items-center gap-3 self-start sm:justify-self-start">
            <a href="/" className="group flex min-w-0 items-center">
              <img src="/nextq-logo.png" alt="NEXTQ logo" className="h-12 w-20 shrink-0 object-contain object-left sm:h-14 sm:w-24" />
            </a>
            <div className="block min-w-0">
              <span className="block text-[9px] font-black uppercase tracking-[0.2em] text-emerald-700 sm:text-[10px] sm:tracking-[0.24em]">
                Smart Queue. Less Waiting.
              </span>
            </div>
          </div>

          <div className="flex w-full items-center justify-center gap-2 text-sm text-slate-600 sm:w-auto sm:gap-3">
            <a
              href="/"
              className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 font-medium text-slate-700 shadow-sm transition hover:border-emerald-300 hover:bg-emerald-50 hover:text-emerald-700 sm:px-4"
            >
              Home
            </a>
            <a
              href="/track"
              className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 font-medium text-slate-700 shadow-sm transition hover:border-emerald-300 hover:bg-emerald-50 hover:text-emerald-700 sm:px-4"
            >
              Track My Token
            </a>
          </div>

          <div className="hidden sm:block sm:justify-self-end" aria-hidden="true" />
        </div>
      </header>

      {/* Stepper */}
      <div className="mx-auto max-w-4xl px-4 pb-0 pt-3 sm:px-6 lg:px-8">
        <div className="mb-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-4">
          <div className="mb-1 text-center text-[10px] font-bold uppercase tracking-[0.24em] text-emerald-700">NEXTQ Booking</div>
          <h1 className="text-center text-2xl font-bold text-slate-900">Choose a clinic, select a doctor, and book your appointment.</h1>
        </div>
        <div className="mb-3 flex items-center justify-between gap-1 rounded-2xl border border-slate-200 bg-white p-2 shadow-sm">
          {['clinic', 'doctor', 'booking', 'confirm'].map((s, i) => (
            <React.Fragment key={s}>
              <div className={`flex flex-col items-center ${['clinic', 'doctor', 'booking', 'confirm'].indexOf(step) >= i ? 'opacity-100' : 'opacity-50'}`}>
                <div className={`mb-1 flex h-8 w-8 items-center justify-center rounded-full text-[10px] font-bold ${
                  ['clinic', 'doctor', 'booking', 'confirm'].indexOf(step) > i ? 'bg-emerald-500' :
                  step === s ? 'border-2 border-emerald-300 bg-emerald-400' :
                  'border-2 border-slate-600 bg-slate-700'
                }`}>
                  {['clinic', 'doctor', 'booking', 'confirm'].indexOf(step) > i ? <Check className="h-3.5 w-3.5" /> : i + 1}
                </div>
                <span className="text-[9px] font-semibold leading-tight text-center">
                  {s === 'clinic' && 'Select Clinic'}
                  {s === 'doctor' && 'Choose Doctor'}
                  {s === 'booking' && 'Book Appointment'}
                  {s === 'confirm' && 'Confirmation'}
                </span>
              </div>
              {i < 3 && <div className={`mt-4 h-1 min-w-0 flex-1 ${['clinic', 'doctor', 'booking', 'confirm'].indexOf(step) > i ? 'bg-emerald-500' : 'bg-slate-700'}`} />}
            </React.Fragment>
          ))}
        </div>

        {/* Step 1: Select Clinic */}
        {step === 'clinic' && (
          <div className="space-y-3">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
              <h2 className="text-3xl font-bold">Select a Clinic</h2>
              {showClinicSearch && (
                <div className="w-full max-w-md">
                  <label htmlFor="clinic-search" className="mb-2 block text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">
                    Search clinic
                  </label>
                  <input
                    id="clinic-search"
                    type="text"
                    value={clinicSearch}
                    onChange={(event) => setClinicSearch(event.target.value)}
                    placeholder="Search clinic or location"
                    className="w-full rounded-xl border border-slate-700 bg-slate-900 px-4 py-2.5 text-sm text-white placeholder:text-slate-400 focus:border-emerald-400 focus:outline-none"
                  />
                </div>
              )}
            </div>

            {showClinicSearch && filteredClinics.length === 0 && (
              <div className="rounded-xl border border-dashed border-slate-700 bg-slate-900/40 px-4 py-8 text-center text-slate-400">
                No clinics match your search.
              </div>
            )}

            <div className="grid gap-4 md:grid-cols-2">
              {filteredClinics.map(clinic => {
                const availability = clinicAvailability[clinic.id] || { tone: 'warning' as const, label: 'Moderate wait' };
                const isAvailable = availability.tone === 'success';

                return (
                  <button
                    key={clinic.id}
                    onClick={() => handleClinicSelect(clinic)}
                    className="group rounded-2xl border border-slate-200 bg-gradient-to-br from-white to-slate-50 p-4 text-left shadow-sm transition hover:-translate-y-0.5 hover:border-emerald-300 hover:shadow-md"
                  >
                    <div className="mb-3 flex items-start justify-between gap-3">
                      <div>
                        <p className="mb-2 text-[10px] font-bold uppercase tracking-[0.24em] text-emerald-700">
                          Clinic
                        </p>
                        <h3 className="text-2xl font-bold text-slate-900">{clinic.name}</h3>
                      </div>
                      <span className={`inline-flex items-center gap-2 rounded-full px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.12em] ${
                        isAvailable ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'
                      }`}>
                        <span className={`h-2.5 w-2.5 rounded-full ${isAvailable ? 'bg-emerald-500' : 'bg-amber-500'}`} />
                        {availability.label}
                      </span>
                    </div>

                    <div className="space-y-2 text-sm text-slate-600">
                      <div className="flex items-center gap-3">
                        <MapPin className="h-4 w-4 text-emerald-600" />
                        <span>{clinic.address}</span>
                      </div>
                      <div className="flex items-center gap-3">
                        <Clock className="h-4 w-4 text-emerald-600" />
                        <span>{clinic.operatingHours}</span>
                      </div>
                    </div>

                    <div className="mt-4 flex flex-wrap gap-2">
                      {(clinic.specializations || []).slice(0, 2).map((spec, i) => (
                        <span key={i} className="rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-700">
                          {spec}
                        </span>
                      ))}
                      {(clinic.specializations || []).length > 2 && (
                        <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-600">
                          +{(clinic.specializations || []).length - 2} more
                        </span>
                      )}
                    </div>

                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* Step 2: Choose Doctor */}
        {step === 'doctor' && selectedClinic && (
          <div className="space-y-3">
            <div>
              <h2 className="text-3xl font-bold mb-0">Choose a Doctor</h2>
            </div>

            {/* Specialization Filter */}
            {showSpecializationFilter && (
              <div>
                <h3 className="text-lg font-semibold mb-3">Filter by Specialization</h3>
                <div className="flex flex-wrap gap-2">
                  <button
                    onClick={() => handleSpecializationFilter('')}
                    className={`px-4 py-2 rounded-lg transition ${selectedSpecialization === '' ? 'bg-emerald-500 text-white' : 'bg-slate-800 text-slate-300 hover:bg-slate-700'}`}
                  >
                    All
                  </button>
                  {selectedClinic.specializations?.map(spec => (
                    <button
                      key={spec}
                      onClick={() => handleSpecializationFilter(spec)}
                      className={`px-4 py-2 rounded-lg transition ${selectedSpecialization === spec ? 'bg-emerald-500 text-white' : 'bg-slate-800 text-slate-300 hover:bg-slate-700'}`}
                    >
                      {spec}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {selectedClinic.specializations?.length > 0 && (
              <div className="rounded-xl border border-slate-700 bg-slate-800/40 p-4">
                <p className="mb-3 text-center text-sm font-semibold text-slate-200">
                  {selectedClinic.name} — Specialties
                </p>
                <div className="flex flex-wrap justify-center gap-2">
                  {selectedClinic.specializations.map((spec) => (
                    <span key={spec} className="rounded-full bg-emerald-500/10 px-2.5 py-1 text-xs font-medium text-emerald-300">
                      {spec}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {/* Doctors List */}
            <div className="grid md:grid-cols-2 gap-6">
              {doctors.length === 0 ? (
                <div className="col-span-2 text-center py-12">
                  <Stethoscope className="w-16 h-16 text-slate-600 mx-auto mb-4 opacity-50" />
                  <p className="text-slate-400">No doctors available for this specialization</p>
                </div>
              ) : (
                doctors.map(doctor => (
                  <button
                    key={doctor.id}
                    onClick={() => handleDoctorSelect(doctor)}
                    className="rounded-2xl border border-slate-200 bg-white p-4 text-left shadow-sm transition hover:-translate-y-0.5 hover:border-emerald-300 hover:shadow-md group"
                  >
                    <div className="flex items-start justify-between mb-3">
                      <div className="flex-1">
                        <h3 className="text-xl font-bold group-hover:text-emerald-400 transition">{formatDoctorName(doctor.name)}</h3>
                        <p className="text-emerald-400 text-sm">{doctor.specialization}</p>
                      </div>
                      <div className="text-right">
                        <p className="text-emerald-400 font-bold">₹{doctor.consultationFee}</p>
                        <p className="text-xs text-slate-400">consultation fees</p>
                      </div>
                    </div>

                    <div className="space-y-2 text-slate-400 text-sm mb-4">
                      <div className="flex items-center gap-2">
                        <Clock className="w-4 h-4 text-emerald-400" />
                        {doctor.availableHours}
                      </div>
                      <p>{doctor.availableDays?.slice(0, 3).join(', ')}{doctor.availableDays?.length > 3 ? ', +more' : ''}</p>
                    </div>

                  </button>
                ))
              )}
            </div>

            <button
              onClick={() => setStep('clinic')}
              className="w-full rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 shadow-sm transition hover:border-emerald-300 hover:bg-emerald-50 hover:text-emerald-700"
            >
              Back to Clinics
            </button>
          </div>
        )}

        {/* Step 3: Book Appointment */}
        {step === 'booking' && selectedClinic && selectedDoctor && (
          <div className="mx-auto max-w-3xl space-y-5">
            <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-[0_18px_50px_rgba(15,23,42,0.08)]">
              <div className="mb-3 flex items-center justify-between gap-3">
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-[0.24em] text-emerald-700">Appointment Details</p>
                  <h2 className="mt-2 text-3xl font-bold text-slate-900">Book your visit</h2>
                </div>
                <div className="rounded-full bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700">
                  {selectedDoctor.specialization}
                </div>
              </div>

              <div className="flex flex-wrap gap-2 text-sm text-slate-600">
                <span className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-slate-50 px-3 py-1.5">
                  <MapPin className="h-4 w-4 text-emerald-600" />
                  {selectedClinic.name}
                </span>
                <span className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-slate-50 px-3 py-1.5">
                  <Stethoscope className="h-4 w-4 text-emerald-600" />
                  {formatDoctorName(selectedDoctor.name)}
                </span>
              </div>
            </div>

            <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-[0_18px_50px_rgba(15,23,42,0.06)]">
              <div className="space-y-4">
                <div className="grid gap-4 md:grid-cols-2">
                  <div>
                    <label className="mb-2 block text-xs font-bold uppercase tracking-[0.2em] text-slate-500">Full Name *</label>
                    <input
                      type="text"
                      value={bookingData.patientName}
                      onChange={(e) => setBookingData({ ...bookingData, patientName: e.target.value })}
                      className="w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-base text-slate-900 placeholder:text-slate-400 focus:border-emerald-400 focus:bg-white focus:outline-none"
                      placeholder="Your name"
                    />
                  </div>
                  <div>
                    <label className="mb-2 block text-xs font-bold uppercase tracking-[0.2em] text-slate-500">Mobile Number *</label>
                    <PhoneInput value={bookingData.phone} onChange={(phone) => setBookingData({ ...bookingData, phone })} className="bg-slate-50" placeholder="Your phone" />
                  </div>
                </div>

                <div>
                  <label className="mb-2 block text-xs font-bold uppercase tracking-[0.2em] text-slate-500">Age (optional)</label>
                  <input
                    type="number"
                    min="0"
                    max="120"
                    value={bookingData.age}
                    onChange={(e) => setBookingData({ ...bookingData, age: e.target.value })}
                    className="w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-base text-slate-900 placeholder:text-slate-400 focus:border-emerald-400 focus:bg-white focus:outline-none"
                    placeholder="Age"
                  />
                </div>

                <div className="rounded-2xl border border-emerald-100 bg-emerald-50/70 p-3">
                  {selectedDoctor && (() => {
                    const schedule = getEarliestBookingSchedule(selectedDoctor);
                    const slots = schedule?.slots || [];
                    if (!slots.length) return null;

                    if (slots.length === 1) {
                      const slot = slots[0];
                      const selectedValue = selectedAppointmentSlot || schedule?.autoSelectedSlot || slot.value;

                      return (
                        <div className="flex items-center justify-between gap-3">
                          <span className="text-sm font-semibold text-slate-800">
                            {selectedAppointmentDate ? `${toShortWeekday(selectedAppointmentDate)}, ${formatScheduleDate(selectedAppointmentDate)}` : 'Loading...'}
                          </span>
                          <button
                            type="button"
                            className={`rounded-lg border px-2.5 py-2 text-xs font-medium transition ${
                              selectedValue === slot.value
                                ? 'border-emerald-300 bg-emerald-100 text-emerald-800 shadow-sm shadow-emerald-200/50'
                                : 'border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100'
                            }`}
                          >
                            {slot.label}
                          </button>
                        </div>
                      );
                    }

                    const availableSlots = slots;
                    const selectedValue = selectedAppointmentSlot || schedule?.autoSelectedSlot || availableSlots[0].value;

                    return (
                      <div className="flex items-center justify-between gap-3">
                        <span className="text-sm font-semibold text-slate-800">
                          {selectedAppointmentDate ? `${toShortWeekday(selectedAppointmentDate)}, ${formatScheduleDate(selectedAppointmentDate)}` : 'Loading...'}
                        </span>
                        <div className="flex flex-wrap justify-end gap-2">
                          {availableSlots.map((slot) => {
                            const isSelected = selectedValue === slot.value;
                            return (
                              <button
                                key={slot.value}
                                type="button"
                                onClick={() => setSelectedAppointmentSlot(slot.value)}
                                className={`rounded-lg border px-2.5 py-2 text-xs font-medium transition ${
                                  isSelected
                                    ? 'border-emerald-300 bg-emerald-100 text-emerald-800 shadow-sm shadow-emerald-200/50'
                                    : 'border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100'
                                }`}
                              >
                                {slot.label}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })()}
                </div>

                <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                  <div className="flex items-center justify-between gap-3 text-sm">
                    <div className="text-slate-500">Consultation fee</div>
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] font-medium uppercase tracking-[0.16em] text-slate-400">Pay at the clinic</span>
                      <span className="font-bold text-emerald-700">₹{selectedDoctor.consultationFee}</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <div className="rounded-3xl border border-emerald-200 bg-emerald-50/60 p-3 shadow-[0_18px_50px_rgba(16,185,129,0.12)]">
              <div className="flex gap-3">
                <button
                  onClick={() => setStep('doctor')}
                  className="flex-1 rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-slate-700 transition hover:border-slate-300 hover:bg-slate-100"
                >
                  Back
                </button>
                <button
                  onClick={handleBookAppointment}
                  className="flex-1 rounded-xl bg-emerald-600 px-4 py-3 text-sm font-semibold text-white shadow-lg shadow-emerald-600/20 transition hover:bg-emerald-500"
                >
                  Confirm Booking
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Step 4: Confirmation */}
        {step === 'confirm' && (
          <div className="space-y-4 max-w-2xl">
            <div className="text-center py-6">
              <div className="w-16 h-16 rounded-full bg-emerald-400/20 border-2 border-emerald-400 flex items-center justify-center mx-auto mb-4">
                <Check className="w-8 h-8 text-emerald-400" />
              </div>
              <h2 className="text-3xl font-bold mb-2">Appointment Confirmed!</h2>
              <p className="text-slate-400 mb-4">Your appointment has been successfully booked.</p>
            </div>

            <div className="space-y-4 text-left">
              <div className="space-y-2 text-sm text-slate-600">
                <div className="flex justify-between gap-3">
                  <span className="text-slate-500">Tracking</span>
                  <span className="font-semibold text-slate-700">Use your mobile number</span>
                </div>
                <div className="flex justify-between gap-3">
                  <span className="text-slate-500">Token Number</span>
                  <span className="font-semibold text-emerald-700">{generatedTokenNumber || 'Generating...'}</span>
                </div>
                <div className="flex justify-between gap-3">
                  <span className="text-slate-500">Doctor</span>
                  <span className="font-semibold text-slate-700">{selectedDoctor?.name}</span>
                </div>
                <div className="flex justify-between gap-3">
                  <span className="text-slate-500">Clinic</span>
                  <span className="font-semibold text-slate-700">{selectedClinic?.name}</span>
                </div>
                <div className="flex justify-between gap-3">
                  <span className="text-slate-500">Consultation Fee</span>
                  <span className="font-semibold text-emerald-700">₹{selectedDoctor?.consultationFee}</span>
                </div>
              </div>

              <div className="pt-3 space-y-4 text-sm text-slate-600">
                <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                  <p className="text-base font-bold text-slate-900">1. Track your queue live</p>
                  <p className="mt-2 text-slate-600">Use your mobile number to check your current position and estimated wait time.</p>
                  <a className="mt-3 inline-flex items-center gap-1 font-semibold text-emerald-700" href={buildTrackingHref(bookingData.phone)}>
                    Track My Queue <span aria-hidden="true">→</span>
                  </a>
                </div>

                <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                  <p className="text-base font-bold text-slate-900">2. Visit the clinic when your turn is approaching</p>
                  <p className="mt-2 text-slate-600">You don't need to wait at the clinic from the beginning. Track your queue and arrive at the right time.</p>
                  <a className="mt-3 inline-flex items-center gap-1 font-semibold text-emerald-700" href={buildTrackingHref(bookingData.phone)}>
                    Track My Appointment <span aria-hidden="true">→</span>
                  </a>
                </div>
              </div>
            </div>

          </div>
        )}
      </div>
    </div>
  );
};
