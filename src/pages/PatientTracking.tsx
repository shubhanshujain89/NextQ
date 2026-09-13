import React, { useEffect, useState } from 'react';

const getTrackingMobileFromQuery = () => {
  const params = new URLSearchParams(window.location.search);
  const mobile = params.get('mobile') || '';
  return mobile.replace(/\D/g, '').slice(0, 10);
};

interface TrackingData {
  clinic: string;
  doctor: string;
  token: string;
  status: string;
  patientsAhead: number;
  estimatedWaitMinutes: number;
  estimatedConsultationTime: string;
  doctorStatus: string;
  delayMinutes: number;
  estimatedConsultationMinutes: number;
  appointmentSlot?: string;
  appointmentDate?: string;
  currentlyServingToken?: string;
}

const getQueuePosition = (tracking: TrackingData | null) => {
  if (!tracking) return 0;
  return Math.max(1, tracking.patientsAhead + 1);
};

const isCompleted = (tracking: TrackingData | null) => tracking?.status === 'COMPLETED';

interface PatientTrackingProps {
  onBack: () => void;
}

export const PatientTracking: React.FC<PatientTrackingProps> = ({ onBack }) => {
  const [tracking, setTracking] = useState<TrackingData | null>(null);
  const [trackingError, setTrackingError] = useState('');
  const [mobile, setMobile] = useState(getTrackingMobileFromQuery());
  const [isSearching, setIsSearching] = useState(false);

  useEffect(() => {
    if (!mobile.trim()) return;
    void findBooking();
  }, []);

  useEffect(() => {
    if (!tracking) return;
    const interval = window.setInterval(() => {
      void findBooking();
    }, 30000);
    return () => window.clearInterval(interval);
  }, [tracking]);

  const findBooking = async (event?: React.FormEvent) => {
    event?.preventDefault();
    const normalizedMobile = mobile.trim();
    if (!normalizedMobile) return;
    setIsSearching(true);
    setTrackingError('');
    if (!/^\d{10}$/.test(normalizedMobile.replace(/\D/g, ''))) {
      setTracking(null);
      setTrackingError('Enter a valid 10-digit mobile number.');
      setIsSearching(false);
      return;
    }
    try {
      const response = await fetch('/api/patient/track', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mobile: normalizedMobile }),
        cache: 'no-store',
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || 'No booking found for this mobile number today.');
      setTracking(data as TrackingData);
    } catch (error) {
      setTracking(null);
      setTrackingError(error instanceof Error && error.message
        ? error.message
        : 'Connection temporarily unavailable.');
    } finally {
      setIsSearching(false);
    }
  };

  return (
    <div className="overflow-hidden bg-[radial-gradient(circle_at_top,_rgba(16,185,129,0.12),_transparent_30%),_linear-gradient(180deg,#f4f7f6_0%,#efeae4_100%)]">
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

      <div className="mx-auto max-w-[980px] px-4 pt-6 pb-0 sm:px-6 lg:px-8 lg:pt-8">
        <div className="mx-auto max-w-[760px] rounded-[30px] border border-[#dfe6e2] bg-white/90 p-3 shadow-[0_24px_60px_rgba(15,23,42,0.08)] backdrop-blur-sm sm:p-5 lg:p-6">
          {trackingError && (
            <div className="mb-5 rounded-xl border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm text-amber-700">
              {trackingError}
            </div>
          )}

          {!tracking && (
            <form onSubmit={findBooking} className="space-y-6">
              <div className="rounded-3xl border border-emerald-200 bg-[linear-gradient(135deg,#5fe0ce_0%,#7adfc3_35%,#dffaf6_100%)] p-5 shadow-[0_14px_30px_rgba(52,199,183,0.18)] sm:p-6">
                <h1 className="text-[clamp(2.2rem,4vw,3.5rem)] font-black leading-tight tracking-[-0.05em] text-slate-900">
                  Track your turn
                </h1>
                <p className="mt-3 text-lg text-slate-700 sm:text-xl">
                  Enter the mobile number used for your booking to see your live queue status.
                </p>
              </div>

              <div className="flex min-h-[76px] overflow-hidden rounded-[16px] border border-emerald-200 bg-white shadow-[0_10px_24px_rgba(28,38,46,0.05)] ring-1 ring-emerald-100 transition focus-within:border-emerald-400 focus-within:ring-2 focus-within:ring-emerald-200">
                <span className="flex w-[88px] items-center justify-center border-r border-emerald-200 bg-[linear-gradient(180deg,#e2f7f4_0%,#d4f0ee_100%)] text-lg font-semibold text-slate-800">
                  +91
                </span>
                <input
                  type="tel"
                  inputMode="numeric"
                  value={mobile.replace(/\D/g, '').slice(0, 10)}
                  onChange={(event) => setMobile(event.target.value.replace(/\D/g, '').slice(0, 10))}
                  className="w-full border-0 bg-transparent px-5 text-[1.1rem] text-slate-800 placeholder:text-slate-400 focus:outline-none"
                  placeholder="98765 43210"
                  maxLength={10}
                  aria-label="Mobile number"
                />
              </div>

              <button
                type="submit"
                disabled={isSearching}
                className="w-full rounded-[16px] bg-[linear-gradient(135deg,#59c9c1_0%,#34c7b7_100%)] px-4 py-4 text-[2.05rem] font-black tracking-[-0.04em] text-slate-900 shadow-[0_12px_22px_rgba(52,199,183,0.28)] transition hover:translate-y-[-1px] hover:shadow-[0_16px_26px_rgba(52,199,183,0.36)] disabled:cursor-not-allowed disabled:opacity-75"
              >
                {isSearching ? 'Searching...' : 'Track My Turn →'}
              </button>
            </form>
          )}

          {tracking && (
            <div className="space-y-4 rounded-[24px] border border-slate-200 bg-white p-4 shadow-[0_20px_55px_rgba(15,23,42,0.08)] sm:p-6">
              <div className="flex items-start justify-between gap-4 border-b border-slate-100 pb-4">
                <div>
                  <p className="text-xs font-bold uppercase tracking-[0.2em] text-emerald-700">Live tracking</p>
                  <p className="mt-2 text-sm font-semibold text-slate-800">{tracking.doctor}</p>
                  <p className="mt-1 text-sm text-slate-500">{tracking.clinic}</p>
                  {tracking.appointmentSlot && <p className="mt-1 text-sm font-medium text-emerald-700">Booked timing: {tracking.appointmentDate ? `${tracking.appointmentDate} · ` : ''}{tracking.appointmentSlot}</p>}
                  <p className={`mt-2 text-xs font-bold uppercase tracking-[0.16em] ${isCompleted(tracking) ? 'text-slate-600' : 'text-emerald-700'}`}>
                    {isCompleted(tracking) ? 'Appointment completed' : tracking.status.replaceAll('_', ' ')}
                  </p>
                </div>
                <div className="min-w-[150px] text-right">
                  <span className={`inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-[10px] font-bold uppercase tracking-[0.16em] ${tracking.doctorStatus === 'IN' ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-100 text-slate-600'}`}>
                    <span className={`h-2 w-2 rounded-full ${tracking.doctorStatus === 'IN' ? 'bg-emerald-500' : 'bg-slate-400'}`} aria-hidden="true" />
                    Doctor: {tracking.doctorStatus === 'IN' ? 'Available' : 'Not started'}
                  </span>
                  <p className="mt-3 text-3xl font-black leading-none tracking-[-0.04em] text-slate-900 sm:text-4xl">{tracking.token}</p>
                </div>
              </div>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div className="min-h-[148px] rounded-2xl border border-emerald-100 bg-[linear-gradient(180deg,#ecfdf5_0%,#f8fffd_100%)] p-4 text-center shadow-inner shadow-emerald-100/60 transition hover:border-emerald-300">
                  <p className="text-xs font-bold uppercase tracking-[0.2em] text-emerald-700">Your position</p>
                  <div className="mt-3 text-3xl font-black tracking-[-0.05em] text-slate-900">{isCompleted(tracking) ? 'Completed' : `#${getQueuePosition(tracking)}`}</div>
                  <p className="mt-1 text-sm text-slate-600">{isCompleted(tracking) ? 'Your consultation is complete.' : 'in the queue'}</p>
                </div>
                <div className="min-h-[148px] rounded-2xl border border-slate-200 bg-slate-50 p-4 transition hover:border-emerald-200 hover:bg-emerald-50/40">
                  <p className="text-xs font-bold uppercase tracking-[0.2em] text-slate-500">Currently serving</p>
                  <p className="mt-3 text-2xl font-black text-slate-900">{isCompleted(tracking) ? 'Completed' : tracking.currentlyServingToken || 'Not started'}</p>
                  <p className="mt-1 text-xs text-slate-500">{isCompleted(tracking) ? 'No further queue action is needed.' : tracking.currentlyServingToken ? 'The doctor is with this patient.' : 'Waiting for the queue to begin.'}</p>
                </div>
                <div className="min-h-[148px] rounded-2xl border border-emerald-200 bg-emerald-50/60 p-4 transition hover:border-emerald-300 hover:bg-emerald-50">
                  <p className="text-xs font-bold uppercase tracking-[0.2em] text-emerald-700">{isCompleted(tracking) ? 'Appointment status' : 'Estimated appointment'}</p>
                  <p className="mt-3 text-2xl font-black text-slate-900">{isCompleted(tracking) ? 'Completed' : `Around ${tracking.estimatedConsultationTime}`}</p>
                  {!isCompleted(tracking) && tracking.doctorStatus === 'IN' && <p className="mt-1 text-xs text-slate-500">Wait: ~{tracking.estimatedWaitMinutes} min</p>}
                  <p className="mt-2 text-xs text-slate-500">{isCompleted(tracking) ? 'This appointment has already been completed.' : 'Approximate time based on your booking and clinic schedule.'}</p>
                </div>
              </div>

              <div className="space-y-2 border-t border-slate-200 pt-3 text-sm text-slate-600">
                <p>Average consultation duration: about {tracking.estimatedConsultationMinutes} min</p>
                {tracking.delayMinutes > 0 && <p className="text-amber-700">Current delay: +{tracking.delayMinutes} min</p>}
              </div>

              <div className="pt-1">
                <button
                  type="button"
                  onClick={() => void findBooking()}
                  className="w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-semibold text-slate-700 transition hover:border-slate-300 hover:bg-slate-100"
                >
                  Refresh Status
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
