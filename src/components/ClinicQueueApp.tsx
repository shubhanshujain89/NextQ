import React, { useState, useEffect } from 'react';
import {
  Clinic,
  TokenItem,
  QueueSession,
  UserRole
} from '../types/queue';
import {
  auth,
  doc,
  signInWithPopup,
  googleProvider,
  onAuthStateChanged,
  User
} from '../lib/firebase';
import { Navbar } from './Navbar';
import { DoctorView } from './DoctorView';
import { ReceptionistView } from './ReceptionistView';
import { BookingView } from './BookingView';
import { TvDisplayView } from './TvDisplayView';
import { AddPatientModal } from './AddPatientModal';
import { DelayBroadcastModal } from './DelayBroadcastModal';
import { LogOut, Tv } from 'lucide-react';

interface ClinicQueueAppProps {
  userId: string;
  role: string;
  clinicId?: string;
  onLogout: () => void;
}

type QueueTokenUpdate = Partial<TokenItem> & Pick<TokenItem, 'id'>;

export function ClinicQueueApp({ userId, role, clinicId: selectedClinicId, onLogout }: ClinicQueueAppProps) {
  const [currentRole, setCurrentRole] = useState<UserRole>(() => (
    new URLSearchParams(window.location.search).get('view') === 'tv' ? 'TV_DISPLAY' : 'DOCTOR'
  ));
  const [isBookingActive, setIsBookingActive] = useState(false);
  const [clinicId, setClinicId] = useState<string>(selectedClinicId || '');
  const [clinic, setClinic] = useState<Clinic | null>(null);
  const [session, setSession] = useState<QueueSession | null>(null);
  const [tokens, setTokens] = useState<TokenItem[]>([]);
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [queueAccessError, setQueueAccessError] = useState('');
  const normalizedRole = String(role || '').toUpperCase();
  const isStaffRole = normalizedRole === 'STAFF';

  // Modals state
  const [isAddPatientOpen, setIsAddPatientOpen] = useState(false);
  const [isDelayModalOpen, setIsDelayModalOpen] = useState(false);

  const handleTokenUpdated = (updatedToken: QueueTokenUpdate) => {
    setTokens((currentTokens) => {
      if (updatedToken.status === 'CANCELLED' || updatedToken.status === 'NO_SHOW') {
        return currentTokens.filter((token) => token.id !== updatedToken.id);
      }
      return currentTokens.map((token) => (
        token.id === updatedToken.id ? { ...token, ...updatedToken } : token
      ));
    });
  };

  useEffect(() => {
    setClinicId(selectedClinicId || '');
  }, [selectedClinicId]);

  // Set role based on login
  useEffect(() => {
    if (new URLSearchParams(window.location.search).get('view') === 'tv') {
      setCurrentRole('TV_DISPLAY');
      return;
    }
    if (normalizedRole === 'DOCTOR') {
      setCurrentRole('DOCTOR');
    } else if (normalizedRole === 'STAFF') {
      setCurrentRole('RECEPTIONIST');
    }
  }, [normalizedRole]);

  useEffect(() => {
    if (isStaffRole && currentRole === 'DOCTOR') {
      setCurrentRole('RECEPTIONIST');
    }
  }, [isStaffRole, currentRole]);

  // Get current user info
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (user) => {
      setCurrentUser(user);
    });
    return () => unsubscribe();
  }, []);

  // Load the current clinic queue from MySQL. Queue mutations remain on Firebase until migrated.
  // Poll periodically so Doctor, Receptionist and TV views stay in sync in real time.
  useEffect(() => {
    if (!clinicId) {
      setClinic(null);
      setSession(null);
      setTokens([]);
      setQueueAccessError('No clinic is assigned to this account.');
      return;
    }

    let active = true;
    const abortController = new AbortController();
    const loadQueue = async () => {
      try {
        const response = await fetch(`/api/staff/queue/${encodeURIComponent(clinicId)}`, {
          signal: abortController.signal,
          credentials: 'include',
        });
        const payload = await response.json();
        if (!active) return;
        if (!response.ok) {
          setQueueAccessError(payload.error || 'Clinic queue access is unavailable.');
          setSession(null);
          setTokens([]);
          return;
        }
        setQueueAccessError('');
        setClinic(payload.clinic as Clinic);
        setSession(payload.session as QueueSession | null);
        setTokens((payload.tokens || []) as TokenItem[]);
      } catch (error: any) {
        if (!active && (error?.name === 'AbortError' || abortController.signal.aborted)) return;
        console.warn('MySQL queue load failed:', error);
      }
    };

    loadQueue();
    const pollId = window.setInterval(loadQueue, currentRole === 'TV_DISPLAY' ? 2000 : 5000);
    return () => {
      active = false;
      abortController.abort();
      window.clearInterval(pollId);
    };
  }, [clinicId, currentRole]);

  const handleGoogleSignIn = async () => {
    try {
      await signInWithPopup(auth, googleProvider);
    } catch (err: any) {
      console.error('Google Sign In error:', err);
    }
  };

  const handleOpenTvDisplay = () => {
    const tvUrl = new URL(window.location.href);
    tvUrl.searchParams.set('view', 'tv');
    window.open(tvUrl.toString(), '_blank', 'noopener,noreferrer');
  };

  const handleToggleDoctorStatus = async () => {
    const newStatus = clinic.doctorStatus === 'IN' ? 'OUT' : 'IN';
    try {
      const response = await fetch(`/api/staff/clinic/${encodeURIComponent(clinic.id)}/status`, {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: newStatus }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || 'Unable to update doctor status.');
      if (payload.clinic) {
        setClinic((current) => current ? { ...current, ...payload.clinic } : current);
      } else {
        setClinic((current) => current ? { ...current, doctorStatus: newStatus } : current);
      }
    } catch (error) {
      console.error('Error toggling doctor status:', error);
      throw error;
    }
  };

  // TV Display Mode
  if (!clinic) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-950 px-6 text-center text-slate-200">
        <div>
          <h1 className="text-xl font-semibold">Clinic queue unavailable</h1>
          <p className="mt-2 text-sm text-slate-400">{queueAccessError || 'Loading clinic data...'}</p>
        </div>
      </div>
    );
  }

  if (currentRole === 'TV_DISPLAY') {
    return (
      <TvDisplayView
        clinic={clinic}
        session={session}
        tokens={tokens}
      />
    );
  }

  return (
    <div className="app-shell min-h-screen overflow-x-hidden text-slate-100 flex flex-col selection:bg-teal-500 selection:text-slate-950">
      <div className="relative z-10 flex h-full min-h-0 flex-col">
        <div className="fixed inset-x-0 top-0 z-50 border-b border-slate-700/50 bg-slate-950/90 backdrop-blur-sm">
          <div className="w-full px-4 sm:px-6 lg:px-8 py-4 flex items-center justify-between">
            <div className="flex min-w-0 items-center gap-3">
              <img src="/nextq-logo.png" alt="NEXTQ" className="h-12 w-36 shrink-0 object-contain object-left" />
              <div className="min-w-0">
                <p className="truncate text-lg font-black text-white">
                  {clinic.name}
                </p>
                <p className="truncate text-sm text-slate-400">
                  {currentRole === 'DOCTOR' ? 'Doctor Console' : 'Reception Desk'}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-4">
              {(currentRole === 'DOCTOR' || currentRole === 'RECEPTIONIST') && (
                <button
                  onClick={handleToggleDoctorStatus}
                  className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-xs font-semibold transition ${
                    clinic.doctorStatus === 'IN'
                      ? 'border-emerald-400/40 bg-emerald-400/10 text-emerald-200 hover:bg-emerald-400/20'
                      : 'border-rose-400/40 bg-rose-400/10 text-rose-200 hover:bg-rose-400/20'
                  }`}
                  title="Toggle doctor presence status"
                >
                  <span className={`h-2 w-2 rounded-full ${clinic.doctorStatus === 'IN' ? 'bg-emerald-400' : 'bg-rose-400'}`} />
                  <span>{clinic.doctorStatus === 'IN' ? 'Doctor IN' : 'Doctor OUT'}</span>
                </button>
              )}
              <button
                onClick={handleOpenTvDisplay}
                className="flex items-center gap-2 rounded-lg border border-amber-400/40 bg-amber-400/10 px-3 py-2 text-sm font-semibold text-amber-200 transition hover:bg-amber-400/20"
                title="Open TV display in a new tab"
              >
                <Tv className="h-4 w-4" />
                <span>TV</span>
              </button>
              <button
                onClick={onLogout}
                className="px-4 py-2 bg-red-500/20 hover:bg-red-500/30 border border-red-400 rounded-lg flex items-center gap-2 transition"
              >
                <LogOut className="w-4 h-4" />
                Logout
              </button>
            </div>
          </div>
        </div>

        <main className="min-h-0 flex-1 max-w-7xl w-full mx-auto p-4 pt-24 sm:p-6 sm:pt-24 lg:p-8 lg:pt-24">
          {queueAccessError && (
            <div className="mx-auto max-w-2xl rounded-2xl border border-amber-500/40 bg-amber-500/10 p-6 text-center">
              <h2 className="text-xl font-bold text-amber-200">Clinic access restricted</h2>
              <p className="mt-2 text-sm text-amber-100/80">{queueAccessError} Contact the clinic administrator to renew or activate the subscription.</p>
            </div>
          )}
          {!queueAccessError && (
          <>
          {/* Doctor View */}
          {currentRole === 'DOCTOR' && (
            <DoctorView
              clinic={clinic}
              session={session}
              tokens={tokens}
              currentUser={currentUser}
              onGoogleSignIn={handleGoogleSignIn}
              onClinicUpdated={(nextClinic) => setClinic(nextClinic)}
              onTokenUpdated={handleTokenUpdated}
            />
          )}

          {/* Receptionist View */}
          {currentRole === 'RECEPTIONIST' && (
            <ReceptionistView
              clinic={clinic}
              session={session}
              tokens={tokens}
              onTokenUpdated={handleTokenUpdated}
              onOpenAddWalkIn={() => setIsAddPatientOpen(true)}
              onOpenDelayBroadcast={() => setIsDelayModalOpen(true)}
            />
          )}
          </>)}
        </main>

        {/* Modals */}
        {isAddPatientOpen && (
          <AddPatientModal
            clinic={clinic}
            onClose={() => setIsAddPatientOpen(false)}
            onAdded={(token) => {
              setTokens((prev) => [token, ...prev]);
              setIsAddPatientOpen(false);
            }}
          />
        )}

        {isDelayModalOpen && (
          <DelayBroadcastModal
            clinic={clinic}
            tokens={tokens}
            onClose={() => setIsDelayModalOpen(false)}
          />
        )}

      </div>
    </div>
  );
}
