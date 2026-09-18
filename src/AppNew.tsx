import React, { lazy, Suspense, useState, useEffect } from 'react';
import { LogIn, Lock, Mail, Eye, EyeOff } from 'lucide-react';
import { auth, onAuthStateChanged, User, signInWithEmailAndPassword, signOut } from './lib/firebase';
import { GlobalHeader } from './components/GlobalHeader';
import { useSiteConfig } from './lib/siteConfig';
import { applyRouteMetadata } from './lib/seo';

const LandingPage = lazy(() => import('./pages/LandingPage').then(({ LandingPage }) => ({ default: LandingPage })));
const LoginPage = lazy(() => import('./pages/LoginPage').then(({ LoginPage }) => ({ default: LoginPage })));
const ClinicAdminDashboard = lazy(() => import('./pages/ClinicAdminDashboard').then(({ ClinicAdminDashboard }) => ({ default: ClinicAdminDashboard })));
const DoctorManagement = lazy(() => import('./pages/DoctorManagement').then(({ DoctorManagement }) => ({ default: DoctorManagement })));
const PatientBooking = lazy(() => import('./pages/PatientBooking').then(({ PatientBooking }) => ({ default: PatientBooking })));
const PatientTracking = lazy(() => import('./pages/PatientTracking').then(({ PatientTracking }) => ({ default: PatientTracking })));
const ClinicQueueApp = lazy(() => import('./components/ClinicQueueApp').then(({ ClinicQueueApp }) => ({ default: ClinicQueueApp })));
const WhatWeProvidePage = lazy(() => import('./pages/WhatWeProvidePage').then(({ WhatWeProvidePage }) => ({ default: WhatWeProvidePage })));
const HowItWorksPage = lazy(() => import('./pages/HowItWorksPage').then(({ HowItWorksPage }) => ({ default: HowItWorksPage })));
const WhyChooseUsPage = lazy(() => import('./pages/WhyChooseUsPage').then(({ WhyChooseUsPage }) => ({ default: WhyChooseUsPage })));
const BenefitsPage = lazy(() => import('./pages/BenefitsPage').then(({ BenefitsPage }) => ({ default: BenefitsPage })));
const ContactPage = lazy(() => import('./pages/ContactPage').then(({ ContactPage }) => ({ default: ContactPage })));

type AppPage = 'landing' | 'what-we-provide' | 'how-it-works' | 'why-choose-us' | 'benefits' | 'contact' | 'login' | 'clinic-admin' | 'site-admin' | 'doctor-management' | 'patient-booking' | 'patient-tracking' | 'clinic-queue';

interface UserSession {
  userId: string;
  role: string;
  clinicId?: string;
}

const INACTIVITY_TIMEOUT_MS = 60 * 60 * 1000;

const normalizeRole = (value?: string | null) => String(value || '').trim().toUpperCase().replace(/[\s-]+/g, '_');

export const resolveAppPageForRoute = (path: string, userRole?: string | null): AppPage => {
  const normalizedRole = normalizeRole(userRole);

  if (path === '/site/admin') {
    if (normalizedRole === 'SUPER_ADMIN') return 'site-admin';
    if (normalizedRole === 'CLINIC_ADMIN') return 'clinic-admin';
    if (normalizedRole === 'DOCTOR' || normalizedRole === 'STAFF') return 'clinic-queue';
    return 'site-admin';
  }

  if (path === '/site/queue') {
    if (normalizedRole === 'DOCTOR' || normalizedRole === 'STAFF') return 'clinic-queue';
    if (normalizedRole === 'CLINIC_ADMIN') return 'clinic-admin';
    if (normalizedRole === 'SUPER_ADMIN') return 'site-admin';
    return 'login';
  }

  if ((path === '/site/login' || path === '/login') && normalizedRole) {
    if (normalizedRole === 'SUPER_ADMIN') return 'site-admin';
    if (normalizedRole === 'CLINIC_ADMIN') return 'clinic-admin';
    if (normalizedRole === 'DOCTOR' || normalizedRole === 'STAFF') return 'clinic-queue';
    return 'landing';
  }

  if (path === '/site/login') return 'login';

  if (path.startsWith('/track/')) return 'patient-tracking';
  if (path === '/track') return 'patient-tracking';
  if (path.startsWith('/q/')) return 'patient-booking';
  if (path === '/booking') return 'patient-booking';
  if (path === '/login') return 'login';
  if (path === '/what-we-provide') return 'what-we-provide';
  if (path === '/how-it-works') return 'how-it-works';
  if (path === '/why-choose-us') return 'why-choose-us';
  if (path === '/benefits') return 'benefits';
  if (path === '/contact') return 'contact';
  return 'landing';
};

const isPublicRoute = (path: string) => {
  return path === '/' || path === '/login' || path === '/booking' || path.startsWith('/q/') || path === '/track' || path.startsWith('/track/') || path === '/what-we-provide' || path === '/how-it-works' || path === '/why-choose-us' || path === '/benefits' || path === '/contact';
};

export default function App() {
  const { settings, content } = useSiteConfig();
  const [currentPage, setCurrentPage] = useState<AppPage>('landing');
  const [userSession, setUserSession] = useState<UserSession | null>(null);
  const [authUser, setAuthUser] = useState<User | null>(null);
  const [selectedClinicId, setSelectedClinicId] = useState<string>('');
  const [selectedClinicName, setSelectedClinicName] = useState<string>('');
  const [siteAdminLogin, setSiteAdminLogin] = useState({ username: '', password: '' });
  const [siteAdminError, setSiteAdminError] = useState('');
  const [siteAdminShowPassword, setSiteAdminShowPassword] = useState(false);
  const [siteAdminLoading, setSiteAdminLoading] = useState(false);
  const [isLoading, setIsLoading] = useState(() => !isPublicRoute(window.location.pathname));
  const [profileOpen, setProfileOpen] = useState(false);
  const [profileForm, setProfileForm] = useState({ displayName: '', photoURL: '', password: '', confirmPassword: '' });

  // Monitor auth state
  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      setIsLoading(false);
    }, 2500);

    const unsubscribe = onAuthStateChanged(auth, (user) => {
      setAuthUser(user);
      if (!user) {
        setUserSession(null);
        const path = window.location.pathname;
        const isPublicPage = isPublicRoute(path);
        if (path === '/site/admin' || path === '/site/queue') {
          setCurrentPage(path === '/site/admin' ? 'site-admin' : 'login');
          if (path === '/site/queue') {
            window.history.replaceState({}, '', '/site/login');
          }
        } else if (path === '/site/login' || path === '/login' || isPublicPage) {
          setCurrentPage(resolveAppPageForRoute(path, null));
        } else {
          setCurrentPage('landing');
        }
      } else {
        const nextSession = {
          userId: user.uid,
          role: normalizeRole(user.role || 'CLINIC_ADMIN'),
          clinicId: user.clinicId,
        };
        setUserSession((current) => {
          if (current && current.userId === nextSession.userId && current.role === nextSession.role) {
            return current;
          }
          return nextSession;
        });
      }
      setIsLoading(false);
    });

    return () => {
      window.clearTimeout(timeoutId);
      unsubscribe();
    };
  }, []);

  useEffect(() => {
    const path = window.location.pathname;
    const nextPage = resolveAppPageForRoute(path, userSession?.role);
    if (userSession && (path === '/login' || path === '/site/login')) {
      const securePath = userSession.role === 'DOCTOR' || userSession.role === 'STAFF' ? '/site/queue' : '/site/admin';
      if (window.location.pathname !== securePath) {
        window.history.replaceState({}, '', securePath);
      }
      setCurrentPage(nextPage);
      return;
    }
    setCurrentPage(nextPage);
  }, [userSession]);

  useEffect(() => {
    if (!userSession || currentPage !== 'site-admin' || userSession.role === 'SUPER_ADMIN') return;
    if (userSession.role === 'CLINIC_ADMIN') {
      setCurrentPage('clinic-admin');
    } else if (userSession.role === 'DOCTOR' || userSession.role === 'STAFF') {
      setCurrentPage('clinic-queue');
    } else {
      setCurrentPage('landing');
    }
  }, [currentPage, userSession]);

  // Sync UI with browser back/forward navigation
  useEffect(() => {
    const handlePopState = () => {
      const path = window.location.pathname;
      const nextPage = resolveAppPageForRoute(path, userSession?.role);
      setCurrentPage(nextPage);
    };
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, [userSession]);

  useEffect(() => {
    if (!userSession) return;
    const savedProfile = localStorage.getItem(`nextq-profile-${userSession.userId}`);
    const existing = savedProfile ? JSON.parse(savedProfile) : null;
    setProfileForm({
      displayName: existing?.displayName || authUser?.displayName || userSession.role || 'User',
      photoURL: existing?.photoURL || authUser?.photoURL || '',
      password: '',
      confirmPassword: '',
    });
  }, [userSession, authUser]);

  const routePathByPage: Record<string, string> = {
    landing: '/',
    'what-we-provide': '/what-we-provide',
    'how-it-works': '/how-it-works',
    'why-choose-us': '/why-choose-us',
    benefits: '/benefits',
    contact: '/contact',
    'patient-booking': '/booking',
  };

  useEffect(() => {
    const path = routePathByPage[currentPage] || window.location.pathname || '/';
    applyRouteMetadata(path);
  }, [currentPage]);

  const handleNavigate = (page: string, role?: string) => {
    const effectiveRole = role || userSession?.role || '';

    if (page === 'dashboard') {
      if (effectiveRole === 'SUPER_ADMIN' || effectiveRole === 'CLINIC_ADMIN') {
        setCurrentPage(effectiveRole === 'SUPER_ADMIN' ? 'site-admin' : 'clinic-admin');
        window.history.pushState({}, '', '/site/admin');
      } else if (effectiveRole === 'DOCTOR' || effectiveRole === 'STAFF') {
        setCurrentPage('clinic-queue');
        window.history.pushState({}, '', '/site/queue');
      }
    } else if (page === 'login') {
      if (userSession) {
        if (userSession.role === 'SUPER_ADMIN') {
          setCurrentPage('site-admin');
          window.history.replaceState({}, '', '/site/admin');
        } else if (userSession.role === 'CLINIC_ADMIN') {
          setCurrentPage('clinic-admin');
          window.history.replaceState({}, '', '/site/admin');
        } else if (userSession.role === 'DOCTOR' || userSession.role === 'STAFF') {
          setCurrentPage('clinic-queue');
          window.history.replaceState({}, '', '/site/queue');
        }
        return;
      }
      setCurrentPage('login');
      window.history.pushState({}, '', '/login');
    } else if (page === 'booking') {
      setCurrentPage('patient-booking');
      window.history.pushState({}, '', '/booking');
      applyRouteMetadata('/booking');
    } else if (page === 'what-we-provide') {
      setCurrentPage('what-we-provide');
      window.history.pushState({}, '', '/what-we-provide');
      applyRouteMetadata('/what-we-provide');
    } else if (page === 'how-it-works') {
      setCurrentPage('how-it-works');
      window.history.pushState({}, '', '/how-it-works');
      applyRouteMetadata('/how-it-works');
    } else if (page === 'why-choose-us') {
      setCurrentPage('why-choose-us');
      window.history.pushState({}, '', '/why-choose-us');
      applyRouteMetadata('/why-choose-us');
    } else if (page === 'benefits') {
      setCurrentPage('benefits');
      window.history.pushState({}, '', '/benefits');
      applyRouteMetadata('/benefits');
    } else if (page === 'contact') {
      setCurrentPage('contact');
      window.history.pushState({}, '', '/contact');
      applyRouteMetadata('/contact');
    } else if (page === 'site-admin') {
      if (effectiveRole === 'SUPER_ADMIN') {
        setCurrentPage('site-admin');
        window.history.pushState({}, '', '/site/admin');
      } else if (effectiveRole === 'CLINIC_ADMIN') {
        setCurrentPage('clinic-admin');
        window.history.pushState({}, '', '/site/admin');
      } else if (effectiveRole === 'DOCTOR' || effectiveRole === 'STAFF') {
        setCurrentPage('clinic-queue');
        window.history.pushState({}, '', '/site/queue');
      } else {
        setCurrentPage('site-admin');
        window.history.pushState({}, '', '/site/admin');
      }
    } else if (page === 'landing') {
      setCurrentPage('landing');
      window.history.pushState({}, '', '/');
      applyRouteMetadata('/');
    }
  };

  const handleLoginSuccess = (userId: string, role: string, clinicId?: string) => {
    const normalizedRole = normalizeRole(role);
    const uiRole = normalizedRole === 'SUPER_ADMIN' ? 'SUPER_ADMIN' : normalizedRole === 'CLINIC_ADMIN' ? 'CLINIC_ADMIN' : normalizedRole === 'DOCTOR' ? 'DOCTOR' : normalizedRole === 'STAFF' ? 'STAFF' : 'CLINIC_ADMIN';
    const session: UserSession = { userId, role: uiRole, clinicId };
    setUserSession(session);

    if (uiRole === 'SUPER_ADMIN') {
      setCurrentPage('site-admin');
      window.history.replaceState({}, '', '/site/admin');
      return;
    }

    if (uiRole === 'CLINIC_ADMIN') {
      setCurrentPage('clinic-admin');
      window.history.replaceState({}, '', '/site/admin');
    } else if (uiRole === 'DOCTOR' || uiRole === 'STAFF') {
      setCurrentPage('clinic-queue');
      window.history.replaceState({}, '', '/site/queue');
    } else {
      setCurrentPage('landing');
      window.history.replaceState({}, '', '/');
    }
  };

  const handleLogout = () => {
    void signOut(auth);
    setUserSession(null);
    setAuthUser(null);
    setProfileOpen(false);
    setSiteAdminLogin({ username: '', password: '' });
    setSiteAdminError('');
    setCurrentPage('login');
    window.history.replaceState({}, '', '/login');
  };

  useEffect(() => {
    if (!userSession) return;

    let inactivityTimer = window.setTimeout(handleLogout, INACTIVITY_TIMEOUT_MS);
    const resetInactivityTimer = () => {
      window.clearTimeout(inactivityTimer);
      inactivityTimer = window.setTimeout(handleLogout, INACTIVITY_TIMEOUT_MS);
    };
    const activityEvents: Array<keyof WindowEventMap> = ['keydown', 'pointerdown', 'scroll', 'touchstart'];

    activityEvents.forEach((eventName) => {
      window.addEventListener(eventName, resetInactivityTimer, { passive: true });
    });

    return () => {
      window.clearTimeout(inactivityTimer);
      activityEvents.forEach((eventName) => {
        window.removeEventListener(eventName, resetInactivityTimer);
      });
    };
  }, [userSession]);

  const handleSaveProfile = () => {
    if (!userSession) return;
    if (profileForm.password && profileForm.password !== profileForm.confirmPassword) {
      window.alert('Passwords do not match.');
      return;
    }
    // Do not store plaintext passwords in localStorage. Password changes are
    // handled server-side by an administrator via the reset-password flow.
    const nextProfile = {
      displayName: profileForm.displayName || 'User',
      photoURL: profileForm.photoURL || '',
    };
    localStorage.setItem(`nextq-profile-${userSession.userId}`, JSON.stringify(nextProfile));
    if (profileForm.password) {
      void fetch('/api/users/reset-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ userId: userSession.userId, newPassword: profileForm.password }),
      }).catch(() => {});
    }
    setProfileOpen(false);
    if (authUser) {
      setAuthUser({ ...authUser, displayName: nextProfile.displayName, photoURL: nextProfile.photoURL });
    }
    window.alert('Profile updated successfully.');
  };

  const handleBackFromClinicAdmin = () => {
    setCurrentPage('landing');
  };

  const handleManageDoctors = (clinicId: string, clinicName: string) => {
    setSelectedClinicId(clinicId);
    setSelectedClinicName(clinicName);
    setCurrentPage('doctor-management');
  };

  const handleBackFromDoctorManagement = () => {
    setCurrentPage('clinic-admin');
    setSelectedClinicId('');
    setSelectedClinicName('');
  };

  if (isLoading) {
    return (
      <div className="app-root min-h-screen flex items-center justify-center">
        <div className="text-center">
          <div className="w-12 h-12 border-4 border-emerald-400/30 border-t-emerald-400 rounded-full animate-spin mx-auto mb-4" />
          <p className="text-slate-400">Loading...</p>
        </div>
      </div>
    );
  }

  const isAdminArea = currentPage === 'site-admin' || currentPage === 'clinic-admin' || currentPage === 'doctor-management';
  const isTvDisplay = currentPage === 'clinic-queue' && new URLSearchParams(window.location.search).get('view') === 'tv';
  const isClinicQueue = currentPage === 'clinic-queue';
  const isPublicBookingOrTracking = currentPage === 'patient-booking' || currentPage === 'patient-tracking';
  const showPublicHeader = !isAdminArea && !isClinicQueue && !isTvDisplay && !isPublicBookingOrTracking;

  return (
    <div className="app-root min-h-screen flex flex-col">
      {showPublicHeader && (
        <GlobalHeader
          currentPage={currentPage}
          onNavigate={handleNavigate}
          onLogout={handleLogout}
          onOpenProfile={() => setProfileOpen(true)}
          isLoggedIn={!!userSession}
          userName={userSession?.role ? userSession.role.replace('-', ' ').toUpperCase() : undefined}
        />
      )}

      {/* Page Content */}
      <div className="flex-1 min-h-0 flex flex-col">
        <Suspense fallback={<div className="flex min-h-[40vh] items-center justify-center text-sm text-slate-400">Loading NEXTQ...</div>}>
        {/* Landing Page */}
        {currentPage === 'landing' && (
          <LandingPage onNavigate={handleNavigate} />
        )}

        {currentPage === 'what-we-provide' && (
          <WhatWeProvidePage onNavigate={handleNavigate} />
        )}

        {currentPage === 'how-it-works' && (
          <HowItWorksPage onNavigate={handleNavigate} />
        )}

        {currentPage === 'why-choose-us' && (
          <WhyChooseUsPage onNavigate={handleNavigate} />
        )}

        {currentPage === 'benefits' && (
          <BenefitsPage onNavigate={handleNavigate} />
        )}

        {currentPage === 'contact' && (
          <ContactPage onNavigate={handleNavigate} />
        )}

        {/* Login Page */}
        {currentPage === 'login' && (
          <LoginPage
            onLoginSuccess={handleLoginSuccess}
            onBack={() => handleNavigate('landing')}
          />
        )}

        {/* Site Admin Login */}
        {currentPage === 'site-admin' && !userSession && (
          <div className="flex flex-1 bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 text-white items-start justify-center p-3 pt-4 pb-0">
            <div className="w-full max-w-md">
              <button
                onClick={() => handleNavigate('landing')}
                className="mb-3 flex items-center gap-2 text-slate-400 transition hover:text-white"
              >
                ← Back
              </button>

              <div className="rounded-2xl border border-slate-800 bg-slate-900/75 p-5 shadow-2xl shadow-slate-950/40">
                <div className="mb-5 text-center">
                  <div className="mb-3 flex items-center justify-center gap-2">
                    <img src="/nextq-logo.png" alt="NEXTQ" className="h-24 w-64 object-contain" />
                    <h1 className="text-3xl font-bold">NEXTQ</h1>
                  </div>
                  <div className="mb-2 inline-flex rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.2em] text-emerald-300">
                    Super Admin
                  </div>
                  <p className="text-slate-400">Smart Queue. Less Waiting.</p>
                </div>

                {siteAdminError && (
                  <div className="mb-4 rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-200">
                    {siteAdminError}
                  </div>
                )}

                <div className="space-y-3">
                  <div>
                    <label className="mb-1.5 block text-sm font-semibold">Username</label>
                    <div className="relative">
                      <Mail className="absolute left-3 top-3 h-5 w-5 text-slate-400" />
                      <input
                        type="text"
                        value={siteAdminLogin.username}
                        onChange={(e) => setSiteAdminLogin({ ...siteAdminLogin, username: e.target.value })}
                        className="w-full rounded-lg border border-slate-700 bg-slate-800 py-2 pl-10 pr-4 text-white placeholder-slate-500 outline-none transition focus:border-emerald-400"
                        placeholder="admin"
                        required
                      />
                    </div>
                  </div>

                  <div>
                    <label className="mb-1.5 block text-sm font-semibold">Password</label>
                    <div className="relative">
                      <Lock className="absolute left-3 top-3 h-5 w-5 text-slate-400" />
                      <input
                        type={siteAdminShowPassword ? 'text' : 'password'}
                        value={siteAdminLogin.password}
                        onChange={(e) => setSiteAdminLogin({ ...siteAdminLogin, password: e.target.value })}
                        className="w-full rounded-lg border border-slate-700 bg-slate-800 py-2 pl-10 pr-10 text-white placeholder-slate-500 outline-none transition focus:border-emerald-400"
                        placeholder="••••••••"
                        required
                      />
                      <button
                        type="button"
                        onClick={() => setSiteAdminShowPassword((value) => !value)}
                        className="absolute right-3 top-3 text-slate-400 transition hover:text-white"
                        aria-label="Toggle password visibility"
                      >
                        {siteAdminShowPassword ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
                      </button>
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={async () => {
                      setSiteAdminError('');
                      setSiteAdminLoading(true);

                      try {
                        const result = await signInWithEmailAndPassword(auth, siteAdminLogin.username, siteAdminLogin.password, 'SUPER_ADMIN');
                        handleLoginSuccess(result.user.uid, result.user.role || 'SUPER_ADMIN');
                      } catch {
                        setSiteAdminError('Invalid site admin credentials.');
                      } finally {
                        setSiteAdminLoading(false);
                      }
                    }}
                    disabled={siteAdminLoading}
                    className="flex w-full items-center justify-center gap-2 rounded-xl border border-emerald-400/40 bg-emerald-500 px-6 py-3 font-extrabold text-slate-950 shadow-[0_10px_24px_rgba(16,185,129,0.22)] transition hover:bg-emerald-400 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {siteAdminLoading ? (
                      <>
                        <div className="h-5 w-5 animate-spin rounded-full border-2 border-slate-900/30 border-t-slate-900" />
                        Processing...
                      </>
                    ) : (
                      <>
                        <LogIn className="h-5 w-5" />
                        Access Admin Panel
                      </>
                    )}
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {currentPage === 'site-admin' && userSession && userSession.role === 'SUPER_ADMIN' && (
          <ClinicAdminDashboard
            adminId={userSession.userId}
            onLogout={handleLogout}
            onManageDoctors={handleManageDoctors}
            mode="site-admin"
          />
        )}

        {currentPage === 'site-admin' && userSession && userSession.role !== 'SUPER_ADMIN' && (
          <ClinicAdminDashboard
            adminId={userSession.userId}
            onLogout={handleLogout}
            onManageDoctors={handleManageDoctors}
            mode="clinic-admin"
          />
        )}

        {/* Admin Dashboard */}
        {currentPage === 'clinic-admin' && userSession && (
          <ClinicAdminDashboard
            adminId={userSession.userId}
            onLogout={handleLogout}
            onManageDoctors={handleManageDoctors}
            mode="clinic-admin"
          />
        )}

        {/* Doctor Management */}
        {currentPage === 'doctor-management' && (
          <DoctorManagement
            clinicId={selectedClinicId}
            clinicName={selectedClinicName}
            onBack={handleBackFromDoctorManagement}
          />
        )}

        {/* Patient Booking */}
        {currentPage === 'patient-booking' && (
          <PatientBooking onBack={() => handleNavigate('landing')} />
        )}

        {currentPage === 'patient-tracking' && (
          <PatientTracking onBack={() => handleNavigate('landing')} />
        )}

        {/* Clinic Queue App (for doctors and staff) */}
        {currentPage === 'clinic-queue' && userSession && (
          <ClinicQueueApp
            userId={userSession.userId}
            role={userSession.role}
            clinicId={userSession.clinicId}
            onLogout={handleLogout}
          />
        )}
        </Suspense>
      </div>

      {profileOpen && userSession && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-md rounded-2xl border border-slate-700 bg-slate-900 p-6">
            <div className="mb-4 flex items-center justify-between">
              <h3 className="text-xl font-bold text-white">My Profile</h3>
              <button onClick={() => setProfileOpen(false)} className="text-slate-400 hover:text-white">✕</button>
            </div>
            <div className="space-y-4">
              <div>
                <label className="mb-2 block text-sm font-medium text-slate-300">Display name</label>
                <input value={profileForm.displayName} onChange={(e) => setProfileForm({ ...profileForm, displayName: e.target.value })} className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-white" />
              </div>
              <div>
                <label className="mb-2 block text-sm font-medium text-slate-300">Profile photo URL</label>
                <input value={profileForm.photoURL} onChange={(e) => setProfileForm({ ...profileForm, photoURL: e.target.value })} className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-white" placeholder="https://..." />
              </div>
              <div>
                <label className="mb-2 block text-sm font-medium text-slate-300">New password</label>
                <input type="password" value={profileForm.password} onChange={(e) => setProfileForm({ ...profileForm, password: e.target.value })} className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-white" placeholder="Leave blank to keep current" />
              </div>
              <div>
                <label className="mb-2 block text-sm font-medium text-slate-300">Confirm password</label>
                <input type="password" value={profileForm.confirmPassword} onChange={(e) => setProfileForm({ ...profileForm, confirmPassword: e.target.value })} className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-white" placeholder="Confirm new password" />
              </div>
              <div className="flex gap-3 pt-2">
                <button onClick={() => setProfileOpen(false)} className="flex-1 rounded-lg border border-slate-600 px-4 py-2 text-slate-200">Cancel</button>
                <button onClick={handleSaveProfile} className="flex-1 rounded-lg bg-emerald-500 px-4 py-2 font-semibold text-slate-950">Save Profile</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {!isTvDisplay && <footer className="site-footer border-t border-slate-200 bg-white">
        <div className="site-footer-content">
          <div className="site-footer-brand">
            <img src="/nextq-logo.png" alt="NEXTQ" className="site-footer-brand-logo" />
            <div className="site-footer-brand-copy-block">
              <span className="site-footer-brand-name">NEXTQ</span>
              <span className="site-footer-brand-tagline">Smart Queue. Less Waiting.</span>
              <span className="site-footer-brand-copy">© 2026 NEXTQ. All rights reserved.</span>
            </div>
          </div>

          <div className="site-footer-growth">
            <span className="site-footer-growth-label">Looking to grow your business?</span>
            <a
              href="https://ybgp.in"
              target="_blank"
              rel="noreferrer"
              className="site-footer-ybgp"
            >
              <span className="site-footer-ybgp-text">YBGP  — Your Business Growth Partner <span aria-hidden="true">→</span></span>
              <img src="/ybgp-logo.png" alt="YBGP" className="site-footer-ybgp-logo" />
            </a>
          </div>
        </div>
      </footer>}
    </div>
  );
}
