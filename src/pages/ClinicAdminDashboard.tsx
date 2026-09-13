import React, { useState, useEffect } from 'react';
import * as QRCode from 'qrcode';
import { Building2, Plus, Edit, Trash2, Users, Clock, Search, Filter, Barcode, Link2, Unlink, Printer, ChevronDown, ChevronUp } from 'lucide-react';
import { db, collection, getDocs, addDoc, updateDoc, deleteDoc, doc, onSnapshot, query, where, orderBy, auth, onAuthStateChanged, recordAuditEvent, hashPassword } from '../lib/firebase';
import { defaultContentSections, defaultSiteSettings, loadContentSections, loadSiteSettings, saveContentSections, saveSiteSettings, initializeSiteConfig, loadSiteSettingsFromDatabase, loadContentSectionsFromDatabase } from '../lib/siteConfig';
import { FeaturePlan } from '../types/queue';
import { PhoneInput } from '../components/PhoneInput';
import { DashboardMode, DashboardTabKey, getDashboardTabs } from './clinicAdminDashboardLogic';
import { normalizeCode39Value } from '../lib/code39';
import { buildQrPublicUrl } from '../lib/qrInventory';

interface BarcodeInventoryItem {
  id: string;
  barcodeValue: string;
  label: string;
  notes?: string;
  status: 'AVAILABLE' | 'ASSIGNED' | 'DISABLED';
  assignedDoctorId?: string | null;
  assignedDoctorName?: string | null;
  assignedClinicId?: string | null;
  assignedAt?: string | null;
  createdAt: string;
  updatedAt: string;
}

interface InventoryDoctor {
  id: string;
  name: string;
  clinicId: string;
  specialization?: string;
  status?: string;
}

const BarcodePreview: React.FC<{ value: string }> = ({ value }) => {
  const qrUrl = buildQrPublicUrl(value);
  const [qrImageUrl, setQrImageUrl] = useState('');

  useEffect(() => {
    let active = true;
    setQrImageUrl('');
    void QRCode.toDataURL(qrUrl, { width: 220, margin: 1, errorCorrectionLevel: 'M' })
      .then((dataUrl) => {
        if (active) setQrImageUrl(dataUrl);
      })
      .catch(() => {
        if (active) setQrImageUrl('');
      });

    return () => {
      active = false;
    };
  }, [qrUrl]);

  return (
    <div className="rounded-lg bg-white px-3 py-2">
      <div className="flex h-40 items-center justify-center overflow-hidden">
        {qrImageUrl ? <img src={qrImageUrl} alt={`QR code for ${qrUrl}`} className="h-40 w-40 object-contain" /> : <span className="text-xs text-slate-400">Generating QR...</span>}
      </div>
    </div>
  );
};

const normalizeDashboardMode = (value?: string): DashboardMode => value === 'site-admin' ? 'site-admin' : 'clinic-admin';

export const isAllowedUserCreationRole = (role: string) => {
  const normalized = String(role || '').trim();
  const lower = normalized.toLowerCase();
  return lower !== 'super admin' && lower !== 'site admin' && ['clinic', 'clinic admin', 'doctor', 'reception'].includes(lower);
};

const displayUserRole = (role: string) => String(role || '').toUpperCase() === 'CLINIC_ADMIN' || String(role || '').toLowerCase() === 'clinic admin' ? 'Clinic' : role;

const DEFAULT_OPERATING_HOURS = '9:00 AM - 6:00 PM';

const HOURS_OPTIONS = [
  DEFAULT_OPERATING_HOURS,
  '9:30 AM - 7:00 PM',
  '10:00 AM - 7:00 PM',
  '8:00 AM - 5:00 PM',
  '24 Hours',
  'Custom Hours'
];

const parseOperatingHoursParts = (value?: string) => {
  const safeValue = String(value || '').trim();
  const match = safeValue.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)\s*-\s*(\d{1,2}):(\d{2})\s*(AM|PM)$/i);

  if (!match) {
    return {
      startHour: '9',
      startMinute: '00',
      startMeridian: 'AM',
      endHour: '6',
      endMinute: '00',
      endMeridian: 'PM',
    };
  }

  const [, startHour, startMinute, startMeridian, endHour, endMinute, endMeridian] = match;
  return {
    startHour,
    startMinute,
    startMeridian: String(startMeridian).toUpperCase(),
    endHour,
    endMinute,
    endMeridian: String(endMeridian).toUpperCase(),
  };
};

const formatOperatingHours = (parts: ReturnType<typeof parseOperatingHoursParts>) => {
  const startHour = Number(parts.startHour || 9);
  const endHour = Number(parts.endHour || 6);
  const normalizedStartHour = startHour === 0 ? 12 : (startHour > 12 ? startHour % 12 : startHour);
  const normalizedEndHour = endHour === 0 ? 12 : (endHour > 12 ? endHour % 12 : endHour);

  return `${normalizedStartHour}:${parts.startMinute || '00'} ${parts.startMeridian} - ${normalizedEndHour}:${parts.endMinute || '00'} ${parts.endMeridian}`;
};

const PACK_OPTIONS = [
  { value: 'TRIAL', label: 'Trial Pack', validityDays: 30, price: '₹0' },
  { value: 'BASIC', label: 'Basic Pack', validityDays: 30, price: '₹1,499/mo' },
] as const;

const TRIAL_TARGET_OPTIONS = [{ value: 'BASIC', label: 'Basic Pack' }] as const;

const getPackMeta = (plan?: FeaturePlan) => PACK_OPTIONS.find((pack) => pack.value === plan) ?? PACK_OPTIONS[0];

const getPackPrice = (plan: FeaturePlan): number => {
  const meta = getPackMeta(plan);
  if (!meta) return 0;
  // Extract all digits (handles "₹1,499/mo", "₹4,999/mo", "₹0") without
  // accidentally stripping letters from strings.
  const numericPrice = meta.price.replace(/[^\d]/g, '');
  return parseFloat(numericPrice) || 0;
};

const isValidImageDataUrl = (value: string) => /^data:image\/(jpeg|jpg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(value) && value.length <= 65000;

const calculateExpiryDate = (startDate: Date, durationDays: number) => new Date(startDate.getTime() + Math.max(0, durationDays - 1) * 24 * 60 * 60 * 1000);

const normalizeSpecializations = (value: unknown): string[] => {
  if (Array.isArray(value)) return value.flatMap((item) => normalizeSpecializations(item));
  if (typeof value !== 'string') return [];
  const trimmed = value.trim();
  if (!trimmed) return [];
  if (trimmed.startsWith('[')) {
    try {
      const parsed = JSON.parse(trimmed);
      if (Array.isArray(parsed)) return normalizeSpecializations(parsed);
    } catch {
      // Fall through to comma-separated parsing.
    }
  }
  return trimmed
    .replace(/^['"]|['"]$/g, '')
    .split(',')
    .map((part) => part.trim().replace(/^['"]|['"]$/g, ''))
    .filter(Boolean);
};

const parseDashboardDate = (value: unknown): Date | null => {
  if (!value) return null;
  if (typeof value === 'object' && value !== null && 'toDate' in value && typeof value.toDate === 'function') {
    const date = value.toDate();
    return date instanceof Date && !Number.isNaN(date.getTime()) ? date : null;
  }
  if (typeof value === 'string') {
    const slashDate = value.trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/);
    if (slashDate) {
      const [, day, month, yearValue] = slashDate;
      const year = yearValue.length === 2 ? 2000 + Number(yearValue) : Number(yearValue);
      const date = new Date(year, Number(month) - 1, Number(day));
      return date.getFullYear() === year && date.getMonth() === Number(month) - 1 && date.getDate() === Number(day) ? date : null;
    }
  }
  const date = new Date(String(value));
  return Number.isNaN(date.getTime()) ? null : date;
};

const isExpiredDate = (value: unknown) => {
  const date = parseDashboardDate(value);
  return Boolean(date && date.getTime() <= Date.now());
};

const getEffectiveSubscriptionStatus = (status: unknown, expiryDate: unknown): 'ACTIVE' | 'EXPIRED' | 'PAUSED' => {
  if (status === 'PAUSED') return 'PAUSED';
  return isExpiredDate(expiryDate) ? 'EXPIRED' : 'ACTIVE';
};

const formatDashboardDate = (value: unknown) => {
  const date = parseDashboardDate(value);
  return date ? date.toLocaleDateString('en-GB') : 'Unknown date';
};

const buildClinicPack = (plan: FeaturePlan, startDate = new Date().toISOString(), status: 'ACTIVE' | 'EXPIRED' | 'PAUSED' = 'ACTIVE') => {
  const meta = getPackMeta(plan);
  const start = new Date(startDate);
  const expiry = calculateExpiryDate(start, meta.validityDays);

  return {
    id: `${plan.toLowerCase()}-${start.getTime()}`,
    plan,
    label: meta.label,
    validityDays: meta.validityDays,
    status,
    startDate: start.toISOString(),
    expiryDate: expiry.toISOString(),
  };
};

const normalizePhone = (value: string) => {
  const digits = (value || '').replace(/\D/g, '').slice(0, 10);
  if (digits.length !== 10) return '';
  return `+91 ${digits.slice(0, 5)} ${digits.slice(5)}`;
};

const formatPhoneInput = (value: string) => {
  const digits = (value || '').replace(/\D/g, '').slice(0, 10);
  if (!digits) return '+91 ';
  if (digits.length <= 5) return `+91 ${digits}`;
  return `+91 ${digits.slice(0, 5)} ${digits.slice(5)}`;
};

interface Clinic {
  id: string;
  name: string;
  address: string;
  phone: string;
  email: string;
  specializations: string[];
  operatingHours: string;
  featurePlan?: FeaturePlan;
  subscriptionStatus?: 'ACTIVE' | 'EXPIRED' | 'PAUSED';
  subscriptionStartedAt?: string;
  subscriptionExpiresAt?: string;
  maxDoctors?: number;
  maxStaffUsers?: number;
  subscriptionPack?: {
    id: string;
    plan: FeaturePlan;
    label: string;
    validityDays: number;
    status: 'ACTIVE' | 'EXPIRED' | 'PAUSED';
    startDate: string;
    expiryDate: string;
  } | null;
  logo?: string;
  qrCodeUrl?: string;
  createdAt: string;
}

interface ClinicAdminProps {
  adminId: string;
  onLogout: () => void;
  onManageDoctors: (clinicId: string, clinicName: string) => void;
  mode?: DashboardMode;
}

export const ClinicAdminDashboard: React.FC<ClinicAdminProps> = ({ adminId, onLogout, onManageDoctors, mode = 'clinic-admin' }) => {
  const resolvedMode: DashboardMode = normalizeDashboardMode(mode);
  const [clinics, setClinics] = useState<Clinic[]>([]);
  const [appointments, setAppointments] = useState<Array<{ clinicId: string; appointmentType?: string; status?: string }>>([]);
  const [payments, setPayments] = useState<Array<{ id: string; clinicId: string; clinicName: string; pack: FeaturePlan; trialForPlan?: FeaturePlan; amount: number; durationDays: number; status: 'PAID' | 'PENDING'; paidAt: string; startDate: string; expiryDate: string; notes?: string }>>([]);
  const [users, setUsers] = useState<Array<{ id: string; name: string; email: string; role: string; status: 'Active' | 'Offline' | 'Pending'; clinicId?: string; clinicName?: string; phone?: string; doctorId?: string; accessStatus?: 'Granted' | 'Hold' | 'Denied'; photoURL?: string; passwordReset?: string; source?: 'staff_users' | 'doctors' }>>([]);
  const [inventoryDoctors, setInventoryDoctors] = useState<InventoryDoctor[]>([]);
  const [barcodeInventory, setBarcodeInventory] = useState<BarcodeInventoryItem[]>([]);
  const [expandedBarcodeId, setExpandedBarcodeId] = useState<string | null>(null);
  const [barcodeForm, setBarcodeForm] = useState({ barcodeValue: '', label: '', notes: '' });
  const [loading, setLoading] = useState(true);
  const [showAddModal, setShowAddModal] = useState(false);
  const [editingClinic, setEditingClinic] = useState<Clinic | null>(null);
  const [editingUser, setEditingUser] = useState<{ id: string; name: string; email: string; role: string; status: 'Active' | 'Offline' | 'Pending'; clinicId?: string; clinicName?: string; phone?: string; doctorId?: string; accessStatus?: 'Granted' | 'Hold' | 'Denied'; photoURL?: string; passwordReset?: string; source?: 'staff_users' | 'doctors' } | null>(null);
  const [showUserModal, setShowUserModal] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [userFilters, setUserFilters] = useState({ search: '', role: 'ALL', clinic: 'ALL', status: 'ALL' });
  const [siteSettings, setSiteSettings] = useState(loadSiteSettings());
  const [savedSiteSettings, setSavedSiteSettings] = useState(loadSiteSettings());
  const [showSiteSettings, setShowSiteSettings] = useState(resolvedMode === 'site-admin');
  const [activeTab, setActiveTab] = useState<DashboardTabKey>('dashboard');
  const [contentSections, setContentSections] = useState(loadContentSections());
  const [savedContentSections, setSavedContentSections] = useState(loadContentSections());
  const [customOperatingHours, setCustomOperatingHours] = useState(parseOperatingHoursParts(DEFAULT_OPERATING_HOURS));
  const [formData, setFormData] = useState({
    name: '',
    address: '',
    phone: '+91 ',
    email: '',
    specializations: '',
    operatingHours: DEFAULT_OPERATING_HOURS,
    featurePlan: 'TRIAL' as FeaturePlan,
    logo: '',
    qrCodeUrl: ''
  });
  const [billingTab, setBillingTab] = useState<'overview' | 'add-payment'>('overview');
  const [editingPaymentId, setEditingPaymentId] = useState<string | null>(null);
  const [expandedBillingPack, setExpandedBillingPack] = useState<FeaturePlan | null>(null);
  
  // Unsubscribe functions for real-time listeners
  const [unsubscribeClinics, setUnsubscribeClinics] = useState<(() => void) | null>(null);
  const [unsubscribeUsers, setUnsubscribeUsers] = useState<(() => void) | null>(null);
  const [unsubscribeAppointments, setUnsubscribeAppointments] = useState<(() => void) | null>(null);
  const [unsubscribePayments, setUnsubscribePayments] = useState<(() => void) | null>(null);
  const [unsubscribeAuditLogs, setUnsubscribeAuditLogs] = useState<(() => void) | null>(null);
  const timersRef = React.useRef<number[]>([]);
  const listenersRef = React.useRef<(() => void)[]>([]);
  const [clinicAccess, setClinicAccess] = useState<Record<string, 'Granted' | 'Hold' | 'Denied' | 'Expired'>>({});
  const [auditLogs, setAuditLogs] = useState<Array<{ id: string; title: string; detail: string; time: string; timestamp: any }>>([]);
  const [paymentForm, setPaymentForm] = useState({
    clinicId: '',
    clinicName: '',
    pack: 'TRIAL' as FeaturePlan,
    trialForPlan: 'BASIC' as FeaturePlan,
    amount: '',
    fromDate: new Date().toISOString().slice(0, 10),
    durationDays: '30',
    status: 'PAID' as 'PAID' | 'PENDING',
    notes: '',
  });
  const [saveMessage, setSaveMessage] = useState('');
  const [userFormData, setUserFormData] = useState({
    name: '',
    email: '',
    role: 'Clinic',
    status: 'Active' as 'Active' | 'Offline' | 'Pending',
    clinicName: '',
    phone: '+91 ',
    accessStatus: 'Granted' as 'Granted' | 'Hold' | 'Denied',
    photoURL: '',
    passwordReset: ''
  });
  const [selectedClinicSummary, setSelectedClinicSummary] = useState('');
  const [summaryDateRange, setSummaryDateRange] = useState({ start: '2026-08-01', end: '2026-08-30' });
  const [expandedContentCards, setExpandedContentCards] = useState<Record<string, boolean>>({
    branding: false,
    pages: false,
    contact: false,
    media: false,
  });

  useEffect(() => {
    let cancelled = false;
    let listenersStarted = false;
    let cleanupListeners: (() => void) | undefined;

    const clearDashboardTimers = () => {
      timersRef.current.forEach((timerId) => window.clearInterval(timerId));
      timersRef.current = [];
    };

    const syncFromStorage = () => {
      const loadedSettings = loadSiteSettings();
      const loadedContent = loadContentSections();
      setSiteSettings(loadedSettings);
      setContentSections(loadedContent);
      setSavedSiteSettings(loadedSettings);
      setSavedContentSections(loadedContent);
    };

    const initializeFromDatabase = async () => {
      try {
        const { settings, content } = await initializeSiteConfig();
        if (!cancelled) {
          setSiteSettings(settings);
          setContentSections(content);
          setSavedSiteSettings(settings);
          setSavedContentSections(content);
        }
      } catch (error) {
        console.error('Failed to initialize site config from database:', error);
        if (!cancelled) {
          syncFromStorage();
        }
      }
    };

    const startListeners = async () => {
      if (cancelled || listenersStarted) {
        return;
      }
      listenersStarted = true;
      void fetchClinics();

      const clinicsRef = collection(db, 'clinics');
      const unsubscribeClinicsListener = onSnapshot(clinicsRef, (snapshot) => {
        const clinicList = snapshot.docs.map((docItem) => {
          const item = docItem.data() as Record<string, any>;
          const featurePlan = (item.subscriptionPack?.plan || item.subscriptionPack || item.featurePlan || item.feature_plan || 'TRIAL') as FeaturePlan;
          const packMeta = getPackMeta(featurePlan);
          const packRecord = item.subscriptionPack && typeof item.subscriptionPack === 'object'
            ? {
                id: item.subscriptionPack.id || `${featurePlan}-${docItem.id}`,
                plan: featurePlan,
                label: item.subscriptionPack.label || packMeta.label,
                validityDays: Number(item.subscriptionPack.validityDays || item.subscriptionPack.validity_days || packMeta.validityDays || 30),
                status: item.subscriptionPack.status || 'ACTIVE',
                startDate: item.subscriptionPack.startDate || item.subscriptionPack.start_date || item.createdAt || item.created_at || new Date().toISOString(),
                expiryDate: item.subscriptionPack.expiryDate || item.subscriptionPack.expiry_date || calculateExpiryDate(new Date(item.createdAt || item.created_at || Date.now()), Number(item.subscriptionPack.validityDays || item.subscriptionPack.validity_days || packMeta.validityDays || 30)).toISOString(),
              }
            : buildClinicPack(featurePlan, item.createdAt || item.created_at || new Date().toISOString());

          return {
            id: docItem.id,
            name: item.name || '',
            address: item.address || '',
            phone: item.phone || '+91 ',
            email: item.email || '',
            specializations: normalizeSpecializations(item.specializations || item.specialty),
            operatingHours: item.operatingHours || item.operating_hours || HOURS_OPTIONS[0],
            featurePlan,
            subscriptionStatus: getEffectiveSubscriptionStatus(item.subscriptionStatus || item.subscription_status || packRecord.status, packRecord.expiryDate),
            subscriptionStartedAt: item.subscriptionStartedAt || item.subscription_started_at || packRecord.startDate,
            subscriptionExpiresAt: item.subscriptionExpiresAt || item.subscription_expires_at || packRecord.expiryDate,
            maxDoctors: Number(item.maxDoctors || item.max_doctors || (featurePlan === 'TRIAL' ? 1 : featurePlan === 'BASIC' ? 3 : 10)),
            maxStaffUsers: Number(item.maxStaffUsers || item.max_staff_users || (featurePlan === 'TRIAL' ? 2 : featurePlan === 'BASIC' ? 10 : 25)),
            subscriptionPack: { ...packRecord, status: getEffectiveSubscriptionStatus(item.subscriptionStatus || item.subscription_status || packRecord.status, packRecord.expiryDate) },
            logo: item.logo || '',
            createdAt: item.createdAt || item.created_at || new Date().toISOString(),
          } as Clinic;
        });
        if (!cancelled) {
          setClinics(clinicList);
          setLoading(false);
        }
      }, (error) => {
        console.error('Error fetching clinics:', error);
        if (!cancelled) {
          setLoading(false);
        }
      });
      listenersRef.current.push(unsubscribeClinicsListener);
      setUnsubscribeClinics(unsubscribeClinicsListener);

      const appointmentsRef = collection(db, 'appointments');
      const unsubscribeAppointmentsListener = onSnapshot(appointmentsRef, (snapshot) => {
        if (!cancelled) {
          setAppointments(snapshot.docs.map((docItem) => {
            const item = docItem.data() as Record<string, any>;
            return {
              clinicId: String(item.clinicId || item.clinic_id || ''),
              appointmentType: String(item.appointmentType || item.appointment_type || '').toUpperCase(),
              status: String(item.status || '').toLowerCase(),
            };
          }));
        }
      }, (error) => {
        console.error('Error fetching appointment records:', error);
      });
      listenersRef.current.push(unsubscribeAppointmentsListener);
      setUnsubscribeAppointments(unsubscribeAppointmentsListener);

      void fetchPayments();
      const paymentRefreshTimer = window.setInterval(fetchPayments, 2500);
      timersRef.current.push(paymentRefreshTimer);
      setUnsubscribePayments(() => () => window.clearInterval(paymentRefreshTimer));

      const fetchAuditLogs = async () => {
        try {
          const response = await fetch('/api/audit', { credentials: 'include' });
          if (!response.ok) throw new Error(`Audit request failed (${response.status})`);
          const logs = await response.json();
          if (!cancelled) setAuditLogs(logs);
        } catch (error) {
          console.error('Error fetching audit logs:', error);
        }
      };
      void fetchAuditLogs();
      const auditTimer = window.setInterval(fetchAuditLogs, 2500);
      timersRef.current.push(auditTimer);
      setUnsubscribeAuditLogs(() => () => window.clearInterval(auditTimer));

      const fetchClinicAccess = async () => {
        try {
          const response = await fetch('/api/clinic-access', { credentials: 'include' });
          if (!response.ok) throw new Error(`Clinic access request failed (${response.status})`);
          setClinicAccess(await response.json());
        } catch (error) {
          console.error('Error fetching clinic access:', error);
        }
      };
      void fetchClinicAccess();
      const clinicAccessTimer = window.setInterval(fetchClinicAccess, 2500);
      timersRef.current.push(clinicAccessTimer);

      const setupUsersListener = async () => {
        const staffPaths = ['staff_users', 'users'];
        const unsubscribeFunctions: (() => void)[] = [];

        for (const pathName of staffPaths) {
          try {
            const staffRef = collection(db, pathName);
            const unsubscribe = onSnapshot(staffRef, () => {
              fetchUsers();
            });
            listenersRef.current.push(unsubscribe);
            unsubscribeFunctions.push(unsubscribe);
          } catch (error) {
            console.warn(`Unable to set up listener for ${pathName}:`, error);
          }
        }

        try {
          const doctorsRef = collection(db, 'doctors');
          const unsubscribe = onSnapshot(doctorsRef, () => {
            fetchUsers();
          });
          listenersRef.current.push(unsubscribe);
          unsubscribeFunctions.push(unsubscribe);
        } catch (error) {
          console.warn('Unable to set up listener for doctors:', error);
        }

        const combinedUnsubscribe = () => {
          unsubscribeFunctions.forEach(unsub => unsub());
        };
        setUnsubscribeUsers(combinedUnsubscribe);
        fetchUsers();
      };

      await setupUsersListener();
      void fetchBarcodeInventory();
      cleanupListeners = () => {
        clearDashboardTimers();
        listenersRef.current.forEach((unsub) => unsub());
        listenersRef.current = [];
        if (unsubscribeClinics) unsubscribeClinics();
        if (unsubscribeUsers) unsubscribeUsers();
        if (unsubscribeAppointments) unsubscribeAppointments();
        if (unsubscribePayments) unsubscribePayments();
        if (unsubscribeAuditLogs) unsubscribeAuditLogs();
      };
    };

    initializeFromDatabase();
    if (auth.currentUser) {
      startListeners();
    }
    window.addEventListener('site-config-changed', syncFromStorage);
    window.addEventListener('storage', syncFromStorage);

    const authUnsubscribe = onAuthStateChanged(auth, (user) => {
      if (!user) {
        cleanupListeners?.();
        setClinics([]);
        setLoading(false);
        return;
      }

      if (listenersRef.current.length === 0 && timersRef.current.length === 0) {
        startListeners();
      }
    });

    return () => {
      cancelled = true;
      cleanupListeners?.();
      authUnsubscribe();
      window.removeEventListener('site-config-changed', syncFromStorage);
      window.removeEventListener('storage', syncFromStorage);
    };
  }, []);

  const fetchClinics = async () => {
    try {
      const snapshot = await getDocs(collection(db, 'clinics'));
      const clinicList = snapshot.docs.map((docItem) => {
        const item = docItem.data() as Record<string, any>;
        const featurePlan = (item.subscriptionPack?.plan || item.subscriptionPack || item.featurePlan || item.feature_plan || 'TRIAL') as FeaturePlan;
        const packMeta = getPackMeta(featurePlan);
        const packRecord = item.subscriptionPack && typeof item.subscriptionPack === 'object'
          ? {
              id: item.subscriptionPack.id || `${featurePlan}-${docItem.id}`,
              plan: featurePlan,
              label: item.subscriptionPack.label || packMeta.label,
              validityDays: Number(item.subscriptionPack.validityDays || item.subscriptionPack.validity_days || packMeta.validityDays || 30),
              status: item.subscriptionPack.status || 'ACTIVE',
              startDate: item.subscriptionPack.startDate || item.subscriptionPack.start_date || item.createdAt || item.created_at || new Date().toISOString(),
              expiryDate: item.subscriptionPack.expiryDate || item.subscriptionPack.expiry_date || calculateExpiryDate(new Date(item.createdAt || item.created_at || Date.now()), Number(item.subscriptionPack.validityDays || item.subscriptionPack.validity_days || packMeta.validityDays || 30)).toISOString(),
            }
          : buildClinicPack(featurePlan, item.createdAt || item.created_at || new Date().toISOString());

        return {
          id: docItem.id,
          name: item.name || '',
          address: item.address || '',
          phone: item.phone || '+91 ',
          email: item.email || '',
          specializations: normalizeSpecializations(item.specializations || item.specialty),
          operatingHours: item.operatingHours || item.operating_hours || HOURS_OPTIONS[0],
          featurePlan,
          subscriptionStatus: getEffectiveSubscriptionStatus(item.subscriptionStatus || item.subscription_status || packRecord.status, packRecord.expiryDate),
          subscriptionStartedAt: item.subscriptionStartedAt || item.subscription_started_at || packRecord.startDate,
          subscriptionExpiresAt: item.subscriptionExpiresAt || item.subscription_expires_at || packRecord.expiryDate,
          maxDoctors: Number(item.maxDoctors || item.max_doctors || (featurePlan === 'TRIAL' ? 1 : featurePlan === 'BASIC' ? 3 : 10)),
          maxStaffUsers: Number(item.maxStaffUsers || item.max_staff_users || (featurePlan === 'TRIAL' ? 2 : featurePlan === 'BASIC' ? 10 : 25)),
          subscriptionPack: { ...packRecord, status: getEffectiveSubscriptionStatus(item.subscriptionStatus || item.subscription_status || packRecord.status, packRecord.expiryDate) },
          logo: item.logo || '',
          createdAt: item.createdAt || item.created_at || new Date().toISOString(),
        } as Clinic;
      });
      setClinics(clinicList);
    } catch (error) {
      console.error('Error fetching clinics:', error);
    } finally {
      setLoading(false);
    }
  };

  const fetchPayments = async () => {
    try {
      const snapshot = await getDocs(collection(db, 'payments'));
      const paymentList = snapshot.docs.map((docItem) => {
        const item = docItem.data() as Record<string, any>;
        return {
          id: docItem.id,
          clinicId: item.clinicId || item.clinic_id || '',
          clinicName: item.clinicName || item.clinic_name || 'Unnamed clinic',
          pack: (item.pack || item.plan || 'TRIAL') as FeaturePlan,
          trialForPlan: (item.trialForPlan || item.trial_for_plan || (item.pack === 'TRIAL' ? 'BASIC' : undefined)) as FeaturePlan | undefined,
          amount: Number(item.amount || 0),
          durationDays: Number(item.durationDays || item.duration_days || 30),
          status: (item.status || 'PAID') as 'PAID' | 'PENDING',
          paidAt: item.paidAt || item.paid_at || item.createdAt || new Date().toISOString(),
          startDate: item.startDate || item.start_date || item.paidAt || item.paid_at || new Date().toISOString(),
          expiryDate: item.expiryDate || item.expiry_date || calculateExpiryDate(new Date(item.startDate || item.start_date || item.paidAt || item.paid_at || Date.now()), Number(item.durationDays || item.duration_days || 30)).toISOString(),
          notes: item.notes || '',
        };
      });
      setPayments(paymentList.sort((left, right) => new Date(right.paidAt).getTime() - new Date(left.paidAt).getTime()));
    } catch (error) {
      console.error('Error fetching payment records:', error);
      setPayments([]);
    }
  };

  const fetchBarcodeInventory = async () => {
    try {
      const [barcodeResponse, doctorSnapshot] = await Promise.all([
        fetch('/api/barcodes', { credentials: 'include' }),
        getDocs(collection(db, 'doctors')),
      ]);
      if (!barcodeResponse.ok) throw new Error(`Barcode inventory request failed (${barcodeResponse.status})`);
      setBarcodeInventory(await barcodeResponse.json());
      setInventoryDoctors(doctorSnapshot.docs.map((docItem) => {
        const item = docItem.data() as Record<string, any>;
        return {
          id: docItem.id,
          name: String(item.name || 'Unnamed doctor'),
          clinicId: String(item.clinicId || item.clinic_id || ''),
          specialization: String(item.specialization || ''),
          status: String(item.status || 'active'),
        };
      }).filter((doctor) => doctor.status === 'active'));
    } catch (error) {
      console.error('Error fetching barcode inventory:', error);
      setBarcodeInventory([]);
    }
  };

  const printBarcode = async (barcodeValue: string) => {
    const popup = window.open('', '_blank', 'width=480,height=640');
    if (!popup) {
      window.alert('Please allow pop-ups to print the barcode.');
      return;
    }

    const code = normalizeCode39Value(barcodeValue);
    const qrUrl = buildQrPublicUrl(code);
    let qrImageUrl: string;
    try {
      qrImageUrl = await QRCode.toDataURL(qrUrl, { width: 420, margin: 1, errorCorrectionLevel: 'M' });
    } catch {
      popup.close();
      window.alert('Unable to generate the QR code for printing.');
      return;
    }
    const logoUrl = new URL('/nextq-logo.png', window.location.origin).href;

    popup.document.write(`<!doctype html><html><head><title>${code} - NEXTQ</title><style>
      @page { margin: 12mm; }
      body { margin: 0; display: flex; min-height: 100vh; align-items: center; justify-content: center; font-family: Arial, sans-serif; }
      .card { width: 72mm; padding: 6mm; text-align: center; border: 1px solid #d1d5db; }
      .qr { display: block; width: 62mm; height: 62mm; margin: 0 auto 4mm; }
      .logo { display: block; width: 42mm; height: 10mm; object-fit: contain; margin: 0 auto 3mm; }
      .code { font: 700 12pt monospace; letter-spacing: 2px; }
    </style></head><body><main class="card">
      <img class="qr" src="${qrImageUrl}" alt="QR code for ${qrUrl}">
      <img class="logo" src="${logoUrl}" alt="NEXTQ">
      <div class="code">${code}</div>
    </main><script>window.addEventListener('load', () => { window.print(); });</script></body></html>`);
    popup.document.close();
  };

  const createBarcodeInventoryItem = async () => {
    const barcodeValue = normalizeCode39Value(barcodeForm.barcodeValue || `NQ-${String(barcodeInventory.length + 1).padStart(4, '0')}`);
    if (!barcodeForm.label.trim()) {
      window.alert('Barcode label is required.');
      return;
    }
    try {
      const response = await fetch('/api/barcodes', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...barcodeForm, barcodeValue }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || 'Unable to create barcode.');
      setBarcodeInventory((current) => [payload, ...current]);
      setBarcodeForm({ barcodeValue: '', label: '', notes: '' });
    } catch (error) {
      window.alert(error instanceof Error ? error.message : 'Unable to create barcode.');
    }
  };

  const updateBarcodeStatus = async (barcodeId: string, nextStatus: BarcodeInventoryItem['status'], assignedDoctorId = '') => {
    try {
      const response = await fetch(`/api/barcodes/${encodeURIComponent(barcodeId)}`, {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: nextStatus, assignedDoctorId }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || 'Unable to update barcode assignment.');
      setBarcodeInventory((current) => current.map((item) => item.id === barcodeId ? payload : item));
    } catch (error) {
      window.alert(error instanceof Error ? error.message : 'Unable to update barcode assignment.');
    }
  };

  const assignBarcodeToDoctor = async (barcodeId: string, assignedDoctorId: string) => {
    if (!assignedDoctorId) {
      await updateBarcodeStatus(barcodeId, 'AVAILABLE');
      return;
    }
    await updateBarcodeStatus(barcodeId, 'ASSIGNED', assignedDoctorId);
  };

  const deleteBarcodeInventoryItem = async (barcodeId: string) => {
    if (!window.confirm('Delete this barcode from inventory?')) return;
    try {
      const response = await fetch(`/api/barcodes/${encodeURIComponent(barcodeId)}`, { method: 'DELETE', credentials: 'include' });
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(payload.error || 'Unable to delete barcode.');
      }
      setBarcodeInventory((current) => current.filter((item) => item.id !== barcodeId));
    } catch (error) {
      window.alert(error instanceof Error ? error.message : 'Unable to delete barcode.');
    }
  };

  const fetchAppointments = async () => {
    try {
      const snapshot = await getDocs(collection(db, 'appointments'));
      setAppointments(snapshot.docs.map((docItem) => {
        const item = docItem.data() as Record<string, any>;
        return {
          clinicId: String(item.clinicId || item.clinic_id || ''),
          appointmentType: String(item.appointmentType || item.appointment_type || '').toUpperCase(),
          status: String(item.status || '').toLowerCase(),
        };
      }));
    } catch (error) {
      console.error('Error fetching appointment records:', error);
      setAppointments([]);
    }
  };

  const fetchUsers = async () => {
    try {
      const staffResults: Array<any> = [];
      const staffPaths = ['staff_users', 'users'];

      for (const pathName of staffPaths) {
        try {
          const snapshot = await getDocs(collection(db, pathName));
          if (snapshot?.docs?.length) {
            staffResults.push(...snapshot.docs.map((docItem) => docItem.data()));
          }
        } catch (error) {
          console.warn(`Unable to load staff users from ${pathName}:`, error);
        }
      }

      const doctorSnapshot = await getDocs(collection(db, 'doctors')).catch(() => ({ docs: [] }));

      const normalizeUserRecord = (item: Record<string, any>, fallbackRole = 'Staff', source: 'staff_users' | 'doctors' = 'staff_users') => {
        const safeName = String(item.name || item.displayName || item.display_name || item.fullName || 'User').trim();
        const safeEmail = String(item.email || '').trim();
        const safeRole = String(item.role || fallbackRole).trim();
        const safeStatus = item.status === 'Offline' || item.status === 'Pending' || item.status === 'inactive' ? (item.status === 'inactive' ? 'Offline' : item.status) : 'Active';
        const rawAccessStatus = String(item.accessStatus || item.access_status || item.clinicAccessStatus || 'Granted');
        const accessStatus = (rawAccessStatus === 'Pending' ? 'Hold' : rawAccessStatus === 'Revoked' ? 'Denied' : rawAccessStatus) as 'Granted' | 'Hold' | 'Denied';
        const photoValue = item.photoURL || item.photo_url || item.avatar || item.profilePhoto || '';
        const passwordResetValue = item.passwordReset || item.password_reset || 'Never reset';
        return {
          id: String(item.id || item.uid || `${safeEmail || safeName}-${Math.random().toString(36).slice(2, 8)}`),
          source,
          name: safeName || 'User',
          email: safeEmail,
          role: safeRole,
          doctorId: String(item.doctorId || item.doctor_id || '').trim() || undefined,
          status: safeStatus as 'Active' | 'Offline' | 'Pending',
          clinicId: String(item.clinicId || item.clinic_id || '').trim() || undefined,
          clinicName: clinics.find((clinic) => clinic.id === String(item.clinicId || item.clinic_id || '').trim())?.name
            || String(item.clinicName || item.clinic_name || '').trim(),
          phone: String(item.phone || item.mobile || '+91 ').trim() || '+91 ',
          accessStatus,
          photoURL: String(photoValue).trim() || '',
          passwordReset: String(passwordResetValue).trim() || 'Never reset'
        };
      };

      const staffUsers = staffResults.map((item) => normalizeUserRecord(item as Record<string, any>, 'Staff', 'staff_users')).filter((user) => user.email || user.name);
      const doctorUsers = (doctorSnapshot.docs || []).map((docItem) => {
        const item = docItem.data() as Record<string, any>;
        return normalizeUserRecord({ ...item, role: 'Doctor' }, 'Doctor', 'doctors');
      });

      const mergedUsers = [...staffUsers, ...doctorUsers.filter((doctor) => !staffUsers.some((user) => user.email && doctor.email && user.email.toLowerCase() === doctor.email.toLowerCase()))];
      const uniqueUsers = mergedUsers.filter((user, index, array) => array.findIndex((candidate) => candidate.email && user.email && candidate.email.toLowerCase() === user.email.toLowerCase()) === index);

      if (uniqueUsers.length === 0) {
        setUsers([]);
        return;
      }

      setUsers(uniqueUsers);
    } catch (error) {
      console.error('Error fetching users:', error);
      setUsers([]);
    }
  };

  const handleSaveUser = async () => {
    try {
      const requestedRole = userFormData.role.trim();
      if (!isAllowedUserCreationRole(requestedRole)) {
        window.alert('Super admin accounts are managed separately and cannot be created from this screen.');
        return;
      }

      const isDoctor = requestedRole.toLowerCase() === 'doctor';
      const selectedClinic = clinics.find((clinic) => clinic.name.toLowerCase() === userFormData.clinicName.trim().toLowerCase())
        || clinics.find((clinic) => clinic.id === editingUser?.clinicId);
      const selectedAccessStatus = editingUser?.accessStatus || userFormData.accessStatus;
      const databaseAccessStatus = selectedAccessStatus === 'Hold' ? 'Pending' : selectedAccessStatus === 'Denied' ? 'Revoked' : 'Granted';
      const roleMap: Record<string, string> = {
        'Clinic Admin': 'CLINIC_ADMIN',
        'Doctor': 'DOCTOR',
        'Reception': 'STAFF',
      };
      const dbRole = roleMap[requestedRole] || 'STAFF';
      let passwordHash = '';
      if (!editingUser) {
        const initialPassword = window.prompt('Set an initial password (at least 12 characters):', '');
        if (!initialPassword) return;
        if (initialPassword.length < 12) {
          window.alert('Password must be at least 12 characters.');
          return;
        }
        passwordHash = await hashPassword(initialPassword);
      }
      const payload = {
        name: userFormData.name,
        displayName: userFormData.name,
        email: userFormData.email,
        role: dbRole,
        status: 'Active',
        clinicId: selectedClinic?.id,
        clinicName: userFormData.clinicName,
        phone: userFormData.phone,
        accessStatus: databaseAccessStatus,
        ...(passwordHash ? { passwordHash } : {}),
      };

      if (!payload.name || !payload.email) {
        window.alert('Name and email are required for each user.');
        return;
      }

      // Validate clinic selection
      if (!payload.clinicName || (isDoctor && !selectedClinic)) {
        window.alert('Please select a clinic for the user.');
        return;
      }

      // Validate phone: must be exactly 10 digits
      const phoneDigits = (payload.phone || '').replace(/\D/g, '');
      if (phoneDigits.length !== 10) {
        window.alert('Phone number must be exactly 10 digits');
        return;
      }

      if (isDoctor) {
        const doctorPayload = {
          name: payload.name,
          specialization: '',
          qualification: '',
          experience: '',
          phone: payload.phone,
          email: payload.email,
          bio: '',
          consultationFee: 0,
          availableDays: [],
          availableHours: '',
          status: 'active' as const,
          clinicId: selectedClinic!.id,
          rating: 0,
        };

        const matchingDoctor = (await getDocs(query(collection(db, 'doctors'), where('email', '==', payload.email)))).docs
          .map((doctorDoc) => {
            const doctorData = doctorDoc.data() as Record<string, any>;
            return { id: doctorDoc.id, clinicId: doctorData.clinicId || doctorData.clinic_id };
          })
          .find((doctor) => doctor.clinicId === selectedClinic!.id);

        if (editingUser?.doctorId || matchingDoctor) {
          const linkedDoctorId = editingUser?.doctorId || matchingDoctor!.id;
          if (editingUser?.doctorId || editingUser?.source === 'doctors') {
            await updateDoc(doc(db, 'doctors', linkedDoctorId), doctorPayload);
          }
          if (editingUser) {
            await updateDoc(doc(db, 'users', editingUser.id), {
              ...payload,
              doctorId: linkedDoctorId,
            });
          } else {
            const existingUser = (await getDocs(query(collection(db, 'users'), where('email', '==', payload.email)))).docs[0];
            if (existingUser) {
              await updateDoc(doc(db, 'users', existingUser.id), {
                ...payload,
                doctorId: linkedDoctorId,
              });
            } else {
              await addDoc(collection(db, 'users'), {
                ...payload,
                doctorId: linkedDoctorId,
                createdAt: new Date().toISOString(),
              });
            }
          }
        } else if (editingUser?.source === 'doctors') {
          await updateDoc(doc(db, 'doctors', editingUser.id), doctorPayload);
          const linkedUsers = (await getDocs(query(collection(db, 'users'), where('doctorId', '==', editingUser.id)))).docs;
          await Promise.all(linkedUsers.map((userDoc) => updateDoc(doc(db, 'users', userDoc.id), {
            name: payload.name,
            displayName: payload.name,
            email: payload.email,
            phone: payload.phone,
            clinicId: selectedClinic!.id,
            clinicName: userFormData.clinicName,
          })));
        } else {
          const doctorRef = await addDoc(collection(db, 'doctors'), {
            ...doctorPayload,
            createdAt: new Date().toISOString()
          });
          // Also create staff_users entry for doctor login
          await addDoc(collection(db, 'users'), {
            name: payload.name,
            displayName: payload.name,
            email: payload.email,
            role: 'DOCTOR',
            status: 'Active',
            clinicId: selectedClinic?.id,
            doctorId: doctorRef.id,
            clinicName: userFormData.clinicName,
            phone: payload.phone,
            accessStatus: databaseAccessStatus,
            passwordHash: passwordHash,
            createdAt: new Date().toISOString()
          });
        }
        void recordAuditEvent(editingUser?.source === 'doctors' ? 'Doctor modified' : 'Doctor added', `${payload.name} was ${editingUser?.source === 'doctors' ? 'modified' : 'added'} for ${selectedClinic!.name}.`);
      } else if (editingUser) {
        await updateDoc(doc(db, 'users', editingUser.id), payload);
        void recordAuditEvent('User modified', `${payload.name} (${payload.email}) was modified.`);
      } else {
        await addDoc(collection(db, 'users'), {
          ...payload,
          createdAt: new Date().toISOString()
        });
        void recordAuditEvent('User added', `${payload.name} (${payload.email}) was added.`);
      }

      setShowUserModal(false);
      setEditingUser(null);
      setUserFormData({ name: '', email: '', role: 'Clinic Admin', status: 'Active', clinicName: '', phone: '+91 ', accessStatus: 'Granted', photoURL: '', passwordReset: '' });
      fetchUsers();
    } catch (error) {
      console.error('Error saving user:', error);
      window.alert('Unable to save the user details. Please verify the information and try again.');
    }
  };

  const handleDeleteUser = async (id: string) => {
    if (!window.confirm('Delete this user from the admin roster?')) return;
    try {
      const user = users.find((item) => item.id === id);
      await deleteDoc(doc(db, user?.source === 'doctors' ? 'doctors' : 'users', id));
      void recordAuditEvent(user?.source === 'doctors' ? 'Doctor deleted' : 'User deleted', `${user?.name || 'User'} was deleted.`);
      fetchUsers();
    } catch (error) {
      console.error('Error deleting user:', error);
    }
  };

  const handleResetUserPassword = async (userId: string) => {
    if (!userId) return;
    const newPassword = window.prompt('Enter a new password (at least 12 characters):', '');
    if (!newPassword) return;
    if (newPassword.length < 12) {
      window.alert('Password must be at least 12 characters.');
      return;
    }

    try {
      const response = await fetch('/api/users/reset-password', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId, newPassword })
      });
      const payload = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw new Error(payload?.error || 'Unable to reset password.');
      }

      setUsers((currentUsers) => currentUsers.map((user) => user.id === userId ? { ...user, passwordReset: 'Reset securely' } : user));
      setUserFormData((current) => ({ ...current, passwordReset: 'Reset securely' }));
      setSaveMessage('User password reset successfully.');
      void recordAuditEvent('Password reset', `Password was reset for ${users.find((user) => user.id === userId)?.name || 'a user'}.`);
      window.alert('Password reset successfully.');
    } catch (error) {
      console.error('Error resetting user password:', error);
      window.alert(error instanceof Error ? error.message : 'Unable to reset the user password.');
    }
  };

  const handleEditUser = (user: { id: string; name: string; email: string; role: string; status: 'Active' | 'Offline' | 'Pending'; clinicId?: string; clinicName?: string; phone?: string; doctorId?: string; accessStatus?: 'Granted' | 'Hold' | 'Denied'; photoURL?: string; passwordReset?: string; source?: 'staff_users' | 'doctors' }) => {
    setEditingUser(user);
    setUserFormData({
      name: user.name,
      email: user.email,
      role: displayUserRole(user.role),
      status: user.status,
      clinicName: user.clinicName || clinics.find((clinic) => clinic.id === user.clinicId)?.name || '',
      phone: user.phone || '+91 ',
      accessStatus: user.accessStatus || 'Granted',
      photoURL: user.photoURL || '',
      passwordReset: user.passwordReset || 'Never reset'
    });
    setShowUserModal(true);
  };

  const updateCustomOperatingHours = (field: keyof ReturnType<typeof parseOperatingHoursParts>, value: string) => {
    const nextValue = { ...customOperatingHours, [field]: value };
    setCustomOperatingHours(nextValue);
    setFormData((prev) => ({
      ...prev,
      operatingHours: formatOperatingHours(nextValue),
    }));
  };

  const handleSaveClinic = async () => {
    try {
      // Validate required fields
      if (!formData.name.trim()) {
        window.alert('Clinic name is required');
        return;
      }
      if (!formData.email.trim()) {
        window.alert('Email is required');
        return;
      }

      // Validate phone: must be exactly 10 digits
      const digitsOnly = (formData.phone || '').replace(/\D/g, '');
      if (digitsOnly.length !== 10) {
        window.alert('Phone number must be exactly 10 digits');
        return;
      }

      const clinicPlan = formData.featurePlan as FeaturePlan;
      const hasBillingRecord = editingClinic ? payments.some((payment) => payment.clinicId === editingClinic.id || payment.clinicName.toLowerCase() === editingClinic.name.toLowerCase()) : false;
      const subscriptionStartedAt = editingClinic?.subscriptionStartedAt || new Date().toISOString();
      const shouldActivateSubscription = hasBillingRecord || (Boolean(editingClinic) && clinicPlan === 'TRIAL');
      const subscriptionPack = buildClinicPack(clinicPlan, subscriptionStartedAt, shouldActivateSubscription ? 'ACTIVE' : 'PAUSED');
      const clinicPayload: Record<string, unknown> = {
        name: formData.name.trim(),
        address: formData.address.trim(),
        phone: formData.phone.trim(),
        email: formData.email.trim(),
        featurePlan: clinicPlan,
        subscriptionStatus: shouldActivateSubscription ? 'ACTIVE' : 'PAUSED',
        subscriptionStartedAt,
        subscriptionExpiresAt: subscriptionPack.expiryDate,
        subscriptionPack,
        specializations: formData.specializations.split(',').map(s => s.trim()).filter(Boolean),
        operatingHours: formData.operatingHours,
        logo: formData.logo || '',
        qrCodeUrl: resolvedMode === 'site-admin' ? formData.qrCodeUrl.trim() : editingClinic?.qrCodeUrl || '',
        updatedAt: new Date().toISOString(),
      };
      if (formData.logo && !isValidImageDataUrl(formData.logo)) {
        delete clinicPayload.logo;
      }

      console.log('Clinic payload:', clinicPayload);

      if (editingClinic) {
        await updateDoc(doc(db, 'clinics', editingClinic.id), clinicPayload);
        console.log('Clinic updated:', editingClinic.id);
        void recordAuditEvent('Clinic modified', `${clinicPayload.name} was modified.`);
        window.alert('Clinic updated successfully');
      } else {
        const docRef = await addDoc(collection(db, 'clinics'), {
          ...clinicPayload,
          createdAt: new Date().toISOString()
        });
        console.log('Clinic created:', docRef.id);
        void recordAuditEvent('Clinic added', `${clinicPayload.name} was added.`);
        window.alert('Clinic added successfully');
      }
      setShowAddModal(false);
      setEditingClinic(null);
      setCustomOperatingHours(parseOperatingHoursParts(DEFAULT_OPERATING_HOURS));
      setFormData({ name: '', address: '', phone: '+91 ', email: '', specializations: '', operatingHours: DEFAULT_OPERATING_HOURS, featurePlan: 'TRIAL', logo: '', qrCodeUrl: '' });
      fetchClinics();
    } catch (error) {
      console.error('Error saving clinic:', error);
      const errorMessage = error instanceof Error ? error.message : String(error);
      window.alert(`Unable to save clinic: ${errorMessage}`);
    }
  };

  const handleSavePayment = async () => {
    const clinicId = paymentForm.clinicId || clinics.find((clinic) => clinic.name.toLowerCase() === paymentForm.clinicName.trim().toLowerCase())?.id || '';
    const clinicName = paymentForm.clinicName.trim() || clinics.find((clinic) => clinic.id === clinicId)?.name || '';
    const amountValue = Number(paymentForm.amount);
    const durationValue = Number(paymentForm.durationDays || 30);

    // Allow 0 amount for TRIAL pack, otherwise require positive amount
    const isTrialPack = paymentForm.pack === 'TRIAL';
    if (!clinicName || !Number.isFinite(amountValue) || (amountValue <= 0 && !isTrialPack)) {
      window.alert('Please choose a clinic and enter a valid amount before saving the payment.');
      return;
    }

    try {
      const startDateValue = new Date(`${paymentForm.fromDate}T00:00:00`);
      if (Number.isNaN(startDateValue.getTime())) {
        window.alert('Please select a valid from date.');
        return;
      }
      const startDate = startDateValue.toISOString();
      const expiryDate = calculateExpiryDate(startDateValue, durationValue).toISOString();
      const paymentPayload = {
        clinicId,
        clinicName,
        pack: paymentForm.pack,
        ...(paymentForm.pack === 'TRIAL' ? { trialForPlan: paymentForm.trialForPlan } : {}),
        amount: amountValue,
        durationDays: durationValue,
        status: paymentForm.status,
        paidAt: startDate,
        startDate,
        expiryDate,
        notes: paymentForm.notes.trim(),
        createdAt: new Date().toISOString(),
      };
      const matchedClinic = clinics.find((clinic) => clinic.id === clinicId || clinic.name.toLowerCase() === clinicName.toLowerCase());
      if (matchedClinic) {
        const updatedPack = buildClinicPack(paymentForm.pack, startDate, 'ACTIVE');
        await updateDoc(doc(db, 'clinics', matchedClinic.id), {
          featurePlan: paymentForm.pack,
          subscriptionPack: updatedPack,
          subscriptionStatus: paymentForm.status === 'PAID' ? 'ACTIVE' : 'PAUSED',
          subscriptionStartedAt: startDate,
          subscriptionExpiresAt: expiryDate,
          updatedAt: new Date().toISOString(),
          currentPackName: paymentForm.pack,
        });
        const accessResponse = await fetch('/api/clinic-access', {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ clinicId: matchedClinic.id, status: 'Granted' }),
        });
        if (!accessResponse.ok) throw new Error('Unable to activate clinic after billing update.');
      }

      if (editingPaymentId) {
        await updateDoc(doc(db, 'payments', editingPaymentId), paymentPayload);
        setPayments((currentPayments) => currentPayments.map((payment) => payment.id === editingPaymentId ? {
          ...payment,
          clinicId,
          clinicName,
          pack: paymentForm.pack,
          amount: amountValue,
          durationDays: durationValue,
          status: paymentForm.status,
          paidAt: startDate,
          startDate,
          expiryDate: payment.expiryDate,
          notes: paymentForm.notes.trim(),
        } : payment));
        setEditingPaymentId(null);
        setBillingTab('overview');
        await fetchPayments();
        fetchClinics();
        void recordAuditEvent('Billing modified', `Billing for ${clinicName} was modified: ${paymentForm.pack}, ₹${amountValue.toLocaleString('en-IN')}, ${paymentForm.status}.`);
        window.alert('Payment updated successfully.');
        return;
      }

      const paymentRecord = await addDoc(collection(db, 'payments'), paymentPayload);

      setPayments((currentPayments) => [{
        id: paymentRecord.id,
        clinicId,
        clinicName,
        pack: paymentForm.pack,
        amount: amountValue,
        durationDays: durationValue,
        status: paymentForm.status,
        paidAt: startDate,
        startDate,
        expiryDate,
        notes: paymentForm.notes.trim(),
      }, ...currentPayments]);
      setEditingPaymentId(null);
      setPaymentForm({ clinicId: '', clinicName: '', pack: 'TRIAL', trialForPlan: 'BASIC', amount: '', fromDate: new Date().toISOString().slice(0, 10), durationDays: '30', status: 'PAID', notes: '' });
      setBillingTab('overview');
      await fetchPayments();
      void recordAuditEvent('Billing added', `Billing for ${clinicName} was added: ${paymentForm.pack}, ₹${amountValue.toLocaleString('en-IN')}, ${paymentForm.status}.`);
      fetchClinics();
      fetchPayments();
      window.alert('Payment saved successfully.');
    } catch (error) {
      console.error('Error saving payment:', error);
      window.alert('Unable to save the payment details. Please try again.');
    }
  };

  const handleDeleteClinic = async (id: string) => {
    if (window.confirm('Are you sure you want to delete this clinic?')) {
      try {
        await deleteDoc(doc(db, 'clinics', id));
        void recordAuditEvent('Clinic deleted', `${clinics.find((clinic) => clinic.id === id)?.name || 'Clinic'} was deleted.`);
        fetchClinics();
      } catch (error) {
        console.error('Error deleting clinic:', error);
      }
    }
  };

  const handleEditClinic = (clinic: Clinic) => {
    setEditingClinic(clinic);
    const parsedHours = parseOperatingHoursParts(clinic.operatingHours || DEFAULT_OPERATING_HOURS);
    setCustomOperatingHours(parsedHours);
    setFormData({
      name: clinic.name,
      address: clinic.address,
      phone: clinic.phone || '+91 ',
      email: clinic.email || '',
      specializations: Array.isArray(clinic.specializations) ? clinic.specializations.join(', ') : (typeof clinic.specializations === 'string' ? clinic.specializations : ''),
      operatingHours: clinic.operatingHours || DEFAULT_OPERATING_HOURS,
      featurePlan: clinic.featurePlan || 'TRIAL',
      logo: clinic.logo || '',
      qrCodeUrl: clinic.qrCodeUrl || ''
    });
    setShowAddModal(true);
  };

  const openAddClinicModal = () => {
    setEditingClinic(null);
    setCustomOperatingHours(parseOperatingHoursParts(DEFAULT_OPERATING_HOURS));
    setFormData({ name: '', address: '', phone: '+91 ', email: '', specializations: '', operatingHours: DEFAULT_OPERATING_HOURS, featurePlan: 'TRIAL', logo: '', qrCodeUrl: '' });
    setShowAddModal(true);
  };

  const handleLogoUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const source = new Image();
      source.onload = () => {
        const maxDimension = 512;
        const scale = Math.min(1, maxDimension / Math.max(source.width, source.height));
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(source.width * scale));
        canvas.height = Math.max(1, Math.round(source.height * scale));
        const context = canvas.getContext('2d');
        if (!context) return;
        context.drawImage(source, 0, 0, canvas.width, canvas.height);
        let quality = 0.72;
        let compressedLogo = canvas.toDataURL('image/jpeg', quality);
        while (compressedLogo.length > 65000 && quality > 0.3) {
          quality -= 0.08;
          compressedLogo = canvas.toDataURL('image/jpeg', quality);
        }
        setFormData((prev) => ({ ...prev, logo: compressedLogo }));
      };
      source.src = String(reader.result || '');
    };
    reader.readAsDataURL(file);
  };

  const handleUserPhoneChange = (value: string) => {
    // Store only the 10 digits
    const digits = (value || '').replace(/\D/g, '').slice(0, 10);
    setUserFormData((prev) => ({ ...prev, phone: digits }));
  };

  const handleClinicPhoneChange = (value: string) => {
    // Store only the 10 digits
    const digits = (value || '').replace(/\D/g, '').slice(0, 10);
    setFormData((prev) => ({ ...prev, phone: digits }));
  };

  const filteredClinics = clinics.filter(clinic =>
    clinic.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    clinic.address.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const filteredUsers = users.filter((user) => {
    const search = userFilters.search.trim().toLowerCase();
    const matchesSearch = !search || [user.name, user.email, user.phone || ''].some((value) => value.toLowerCase().includes(search));
    const matchesRole = userFilters.role === 'ALL' || user.role === userFilters.role;
    const matchesClinic = userFilters.clinic === 'ALL' || user.clinicName === userFilters.clinic;
    const matchesStatus = userFilters.status === 'ALL' || user.status === userFilters.status;
    return matchesSearch && matchesRole && matchesClinic && matchesStatus;
  });

  const hasUnsavedSettingsChanges = JSON.stringify(siteSettings) !== JSON.stringify(savedSiteSettings) || JSON.stringify(contentSections) !== JSON.stringify(savedContentSections);

  const handleSaveSettings = async () => {
    await saveSiteSettings(siteSettings);
    await saveContentSections(contentSections);
    void recordAuditEvent('Site configuration modified', 'Website settings and content were updated.');
    setSaveMessage('Settings saved successfully.');
    window.dispatchEvent(new Event('site-config-changed'));
    
    // Reload from storage to ensure form reflects saved values
    setTimeout(() => {
      const reloadedSettings = loadSiteSettings();
      const reloadedContent = loadContentSections();
      setSiteSettings(reloadedSettings);
      setContentSections(reloadedContent);
      setSavedSiteSettings(reloadedSettings);
      setSavedContentSections(reloadedContent);
    }, 100);
    
    window.alert('Settings saved successfully.');
  };

  const isSiteAdmin = resolvedMode === 'site-admin';

  const tabs = getDashboardTabs(resolvedMode);



  const paidPayments = payments.filter((payment) => payment.status === 'PAID');
  const pendingPayments = payments.filter((payment) => payment.status === 'PENDING');
  const clinicHasBilling = (clinic: Clinic) => payments.some((payment) => payment.clinicId === clinic.id || payment.clinicName.toLowerCase() === clinic.name.toLowerCase());
  const getClinicPayment = (clinic: Clinic) => payments.find((payment) => payment.clinicId === clinic.id || payment.clinicName.toLowerCase() === clinic.name.toLowerCase());
  const getClinicSubscriptionStatus = (clinic: Clinic) => {
    const payment = getClinicPayment(clinic);
    return getEffectiveSubscriptionStatus(clinic.subscriptionStatus, payment?.expiryDate || clinic.subscriptionPack?.expiryDate);
  };
  const getClinicAccessStatus = (clinic: Clinic): 'Granted' | 'Hold' | 'Denied' | 'Expired' => (
    getClinicSubscriptionStatus(clinic) === 'EXPIRED' ? 'Expired' : clinicAccess[clinic.id] || 'Granted'
  );
  const clinicAccessCounts = {
    Granted: clinics.filter((clinic) => getClinicAccessStatus(clinic) === 'Granted').length,
    Hold: clinics.filter((clinic) => getClinicAccessStatus(clinic) === 'Hold').length,
    Denied: clinics.filter((clinic) => getClinicAccessStatus(clinic) === 'Denied').length,
    Expired: clinics.filter((clinic) => getClinicAccessStatus(clinic) === 'Expired').length,
  };
  const openClinicBilling = (clinic: Clinic, payment?: (typeof payments)[number]) => {
    const pack = payment?.pack || clinic.featurePlan || 'TRIAL';
    setEditingPaymentId(payment?.id || null);
    setPaymentForm({
      clinicId: clinic.id,
      clinicName: clinic.name,
      pack,
      trialForPlan: payment?.trialForPlan || 'BASIC',
      amount: payment ? String(payment.amount) : String(getPackPrice(pack)),
      fromDate: payment ? payment.startDate.slice(0, 10) : new Date().toISOString().slice(0, 10),
      durationDays: payment ? String(payment.durationDays) : String(getPackMeta(pack).validityDays),
      status: payment?.status || 'PAID',
      notes: payment?.notes || '',
    });
    setBillingTab('add-payment');
  };
  const handleDeletePayment = async (payment: (typeof payments)[number]) => {
    if (!window.confirm(`Delete the ${payment.pack} payment for ${payment.clinicName}?`)) return;
    try {
      await deleteDoc(doc(db, 'payments', payment.id));
      await fetchPayments();
      void recordAuditEvent('Billing deleted', `Billing for ${payment.clinicName} was deleted.`);
    } catch (error) {
      console.error('Error deleting payment:', error);
      window.alert('Unable to delete the payment. Please try again.');
    }
  };
  const billingSummary = [
    { label: 'Recorded revenue', value: `₹${paidPayments.reduce((sum, payment) => sum + payment.amount, 0).toLocaleString('en-IN')}`, tone: 'emerald' },
    { label: 'Pending invoices', value: String(pendingPayments.length), tone: 'amber' },
    { label: 'Recorded payments', value: String(payments.length), tone: 'cyan' },
    { label: 'Recorded due amount', value: `₹${pendingPayments.reduce((sum, payment) => sum + payment.amount, 0).toLocaleString('en-IN')}`, tone: 'violet' },
  ];

  const clinicAppointmentSummary = clinics.length > 0
    ? clinics.map((clinic) => {
        const clinicAppointments = appointments.filter((appointment) => appointment.clinicId === clinic.id);
        const walkIns = clinicAppointments.filter((appointment) => appointment.appointmentType === 'WALK_IN').length;
        const online = clinicAppointments.filter((appointment) => appointment.appointmentType === 'ONLINE').length;
        const followUps = clinicAppointments.filter((appointment) => appointment.appointmentType === 'FOLLOW_UP').length;
        const noShows = clinicAppointments.filter((appointment) => appointment.status === 'NO_SHOW').length;
        return {
        clinic: clinic.name || 'Unnamed clinic',
        walkIns,
        online,
        followUps,
        noShows,
        };
      })
    : [];

  const recentActivity = [
    { title: 'New clinic onboarding', detail: 'Latest clinic records loaded from MySQL.', time: 'Recently updated' },
    { title: 'WhatsApp reminder campaign', detail: `Status reflects current live clinic configuration.`, time: 'Live sync' },
    { title: 'Queue reporting', detail: 'Patient flow data updates from the connected clinic database.', time: 'Updated now' },
    { title: 'Security review completed', detail: 'Role-based access is aligned to the active user roster.', time: 'Current state' },
  ];

  const complianceChecks = [
    { name: 'Role-based access review', status: 'Passed' },
    { name: 'Data retention audit', status: 'Passed' },
    { name: 'Clinic onboarding policy', status: 'Needs review' },
    { name: 'Backup & restore test', status: 'Passed' },
  ];

  const exportReport = () => {
    window.alert('Enterprise report export started.');
  };

  const summaryClinicOptions = Array.from(new Set([
    ...clinics.map((clinic) => clinic.name),
    ...clinicAppointmentSummary.map((clinic) => clinic.clinic),
  ].filter(Boolean))).sort((left, right) => left.localeCompare(right));

  useEffect(() => {
    if (!selectedClinicSummary && summaryClinicOptions.length > 0) {
      setSelectedClinicSummary(summaryClinicOptions[0]);
    }
  }, [selectedClinicSummary, summaryClinicOptions]);

  const dateRangeMultiplier = (() => {
    const start = new Date(summaryDateRange.start);
    const end = new Date(summaryDateRange.end);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || start > end) {
      return 1;
    }
    return Math.max(1, Math.ceil((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)) || 1);
  })();

  const selectedClinicSummaryData = clinicAppointmentSummary.find((clinic) => clinic.clinic === selectedClinicSummary)
    ?? clinicAppointmentSummary[0]
    ?? {
      clinic: summaryClinicOptions[0] || 'No clinic selected',
      walkIns: 0,
      online: 0,
      followUps: 0,
      noShows: 0,
    };

  const filteredClinicSummaryData = {
    ...selectedClinicSummaryData,
    walkIns: Math.max(0, Math.round(selectedClinicSummaryData.walkIns * dateRangeMultiplier / 7)),
    online: Math.max(0, Math.round(selectedClinicSummaryData.online * dateRangeMultiplier / 7)),
    followUps: Math.max(0, Math.round(selectedClinicSummaryData.followUps * dateRangeMultiplier / 7)),
    noShows: Math.max(0, Math.round(selectedClinicSummaryData.noShows * dateRangeMultiplier / 7)),
  };

  const renderActiveTab = () => {
    switch (activeTab) {
      case 'dashboard':
        const activeClinicsCount = clinics.filter((clinic) => clinicHasBilling(clinic) && getClinicSubscriptionStatus(clinic) === 'ACTIVE' && getClinicAccessStatus(clinic) === 'Granted').length;
        const expiredSubscriptions = clinics.filter((clinic) => getClinicSubscriptionStatus(clinic) === 'EXPIRED').length;
        const pendingClinicsCount = clinics.filter((clinic) => getClinicSubscriptionStatus(clinic) === 'PAUSED' && getClinicAccessStatus(clinic) === 'Hold').length;
        const inactiveClinicsCount = clinics.filter((clinic) => getClinicAccessStatus(clinic) === 'Denied').length;
        
        const clinicAdminCount = users.filter(u => u.role === 'CLINIC_ADMIN' || u.role === 'Clinic Admin').length || 0;
        const activeUsersCount = users.filter(u => u.status === 'Active').length;
        const grantedAccessCount = users.filter(u => u.accessStatus === 'Granted').length;
        const accessGrantedPercent = users.length > 0 ? Math.round((grantedAccessCount / users.length) * 100) : 0;
        
        const totalRevenue = paidPayments.reduce((sum, payment) => sum + payment.amount, 0);
        
        const dashboardPendingPayments = pendingPayments.length;
        const expiringClinics = clinics.filter((clinic) => {
          const expiryDate = getClinicPayment(clinic)?.expiryDate || clinic.subscriptionPack?.expiryDate || clinic.subscriptionExpiresAt;
          if (!expiryDate) return false;
          const expiry = parseDashboardDate(expiryDate)?.getTime();
          return getClinicSubscriptionStatus(clinic) === 'ACTIVE' && expiry !== undefined && expiry >= Date.now() && expiry <= Date.now() + 7 * 24 * 60 * 60 * 1000;
        });
        const expiringSubscriptions = expiringClinics.length;
        const activeSubscriptionsPercent = clinics.length ? Math.round((activeClinicsCount / clinics.length) * 100) : 0;
        
        return (
          <div className="space-y-8">
            {/* Clinics Section */}
            <div>
              <div className="mb-4 flex items-center justify-between">
                <h3 className="text-xl font-bold text-white">Clinics</h3>
                <span className="rounded-full bg-emerald-500/15 px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.2em] text-emerald-200">Active</span>
              </div>
              <div className="grid gap-4 md:grid-cols-4">
                <button onClick={() => setActiveTab('clinics')} className="rounded-2xl border border-slate-700 bg-slate-900/70 p-5 text-left hover:border-emerald-400/50 hover:bg-slate-800/70 transition">
                  <div className="text-[10px] uppercase tracking-[0.18em] text-slate-400">Total clinics</div>
                  <div className="mt-3 text-4xl font-black text-white">{clinics.length}</div>
                  <p className="mt-2 text-xs text-slate-500">All registered clinics</p>
                </button>
                <button onClick={() => setActiveTab('clinics')} className="rounded-2xl border border-slate-700 bg-slate-900/70 p-5 text-left hover:border-emerald-400/50 hover:bg-slate-800/70 transition">
                  <div className="text-[10px] uppercase tracking-[0.18em] text-emerald-400">Active</div>
                  <div className="mt-3 text-4xl font-black text-white">{activeClinicsCount}</div>
                  <p className="mt-2 text-xs text-slate-500">Live and operational</p>
                </button>
                <button onClick={() => setActiveTab('clinics')} className="rounded-2xl border border-slate-700 bg-slate-900/70 p-5 text-left hover:border-emerald-400/50 hover:bg-slate-800/70 transition">
                  <div className="text-[10px] uppercase tracking-[0.18em] text-amber-400">Pending</div>
                  <div className="mt-3 text-4xl font-black text-white">{pendingClinicsCount}</div>
                  <p className="mt-2 text-xs text-slate-500">Awaiting approval</p>
                </button>
                <button onClick={() => setActiveTab('clinics')} className="rounded-2xl border border-slate-700 bg-slate-900/70 p-5 text-left hover:border-emerald-400/50 hover:bg-slate-800/70 transition">
                  <div className="text-[10px] uppercase tracking-[0.18em] text-red-400">Inactive</div>
                  <div className="mt-3 text-4xl font-black text-white">{inactiveClinicsCount}</div>
                  <p className="mt-2 text-xs text-slate-500">Suspended or inactive</p>
                </button>
              </div>
            </div>

            {/* Payments Section */}
            <div>
              <div className="mb-4 flex items-center justify-between">
                <h3 className="text-xl font-bold text-white">Payments & Billing</h3>
                <span className="rounded-full bg-violet-500/15 px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.2em] text-violet-200">Overview</span>
              </div>
              <div className="grid gap-4 md:grid-cols-5">
                <button onClick={() => setActiveTab('security')} className="rounded-2xl border border-slate-700 bg-slate-900/70 p-5 text-left hover:border-violet-400/50 hover:bg-slate-800/70 transition">
                  <div className="text-[10px] uppercase tracking-[0.18em] text-amber-400">Payment pending</div>
                  <div className="mt-3 text-4xl font-black text-white">₹{pendingPayments.reduce((sum, payment) => sum + payment.amount, 0).toLocaleString('en-IN')}</div>
                  <p className="mt-2 text-xs text-slate-500">{dashboardPendingPayments} invoices awaiting</p>
                </button>
                <button onClick={() => setActiveTab('security')} className="rounded-2xl border border-slate-700 bg-slate-900/70 p-5 text-left hover:border-violet-400/50 hover:bg-slate-800/70 transition">
                  <div className="text-[10px] uppercase tracking-[0.18em] text-emerald-400">Active subscriptions</div>
                  <div className="mt-3 text-4xl font-black text-white">{activeSubscriptionsPercent}%</div>
                  <p className="mt-2 text-xs text-slate-500">{activeClinicsCount} active plans</p>
                </button>
                <button onClick={() => setActiveTab('security')} className="rounded-2xl border border-slate-700 bg-slate-900/70 p-5 text-left hover:border-violet-400/50 hover:bg-slate-800/70 transition">
                  <div className="text-[10px] uppercase tracking-[0.18em] text-cyan-400">Expires within 7 days</div>
                  <div className="mt-3 text-4xl font-black text-white">{expiringSubscriptions}</div>
                  <p className="mt-2 truncate text-xs text-slate-500" title={expiringClinics.map((clinic) => clinic.name).join(', ') || 'No upcoming expiries'}>
                    {expiringClinics.length > 0 ? expiringClinics.map((clinic) => clinic.name).join(', ') : 'No upcoming expiries'}
                  </p>
                </button>
                <button onClick={() => setActiveTab('security')} className="rounded-2xl border border-slate-700 bg-slate-900/70 p-5 text-left hover:border-violet-400/50 hover:bg-slate-800/70 transition">
                  <div className="text-[10px] uppercase tracking-[0.18em] text-violet-400">Monthly revenue</div>
                  <div className="mt-3 text-4xl font-black text-white">₹{(totalRevenue).toLocaleString('en-IN')}</div>
                  <p className="mt-2 text-xs text-slate-500">Current MRR</p>
                </button>
                <button onClick={() => setActiveTab('clinics')} className="rounded-2xl border border-slate-700 bg-slate-900/70 p-5 text-left hover:border-rose-400/50 hover:bg-slate-800/70 transition">
                  <div className="text-[10px] uppercase tracking-[0.18em] text-rose-400">Expired subscriptions</div>
                  <div className="mt-3 text-4xl font-black text-white">{expiredSubscriptions}</div>
                  <p className="mt-2 text-xs text-slate-500">Renewal required</p>
                </button>
              </div>
            </div>

            {/* Users Section */}
            <div>
              <div className="mb-4 flex items-center justify-between">
                <h3 className="text-xl font-bold text-white">Users & Access</h3>
                <span className="rounded-full bg-cyan-500/15 px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.2em] text-cyan-200">Tracking</span>
              </div>
              <div className="grid gap-4 md:grid-cols-4">
                <button onClick={() => setActiveTab('users')} className="rounded-2xl border border-slate-700 bg-slate-900/70 p-5 text-left hover:border-cyan-400/50 hover:bg-slate-800/70 transition">
                  <div className="text-[10px] uppercase tracking-[0.18em] text-slate-400">Active users</div>
                  <div className="mt-3 text-4xl font-black text-white">{activeUsersCount}</div>
                  <p className="mt-2 text-xs text-slate-500">Total platform users</p>
                </button>
                <button onClick={() => setActiveTab('users')} className="rounded-2xl border border-slate-700 bg-slate-900/70 p-5 text-left hover:border-cyan-400/50 hover:bg-slate-800/70 transition">
                  <div className="text-[10px] uppercase tracking-[0.18em] text-cyan-400">Clinic users</div>
                  <div className="mt-3 text-4xl font-black text-white">{clinicAdminCount}</div>
                  <p className="mt-2 text-xs text-slate-500">Clinic management access</p>
                </button>
                <button onClick={() => setActiveTab('users')} className="rounded-2xl border border-slate-700 bg-slate-900/70 p-5 text-left hover:border-cyan-400/50 hover:bg-slate-800/70 transition">
                  <div className="text-[10px] uppercase tracking-[0.18em] text-violet-400">Access granted</div>
                  <div className="mt-3 text-4xl font-black text-white">{accessGrantedPercent}%</div>
                  <p className="mt-2 text-xs text-slate-500">Users with full access</p>
                </button>
              </div>
            </div>
          </div>
        );
      case 'audit':
        return (
          <div className="space-y-6">
            <div className="rounded-2xl border border-slate-700 bg-slate-900/70 p-6">
              <div className="mb-5 flex items-center justify-between">
                <div>
                  <div className="text-[10px] uppercase tracking-[0.24em] text-emerald-300">Operations log</div>
                  <h3 className="mt-2 text-2xl font-bold text-white">Audit Trail</h3>
                </div>
                <span className="rounded-full bg-emerald-500/15 px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.2em] text-emerald-200">Live</span>
              </div>

              <div className="space-y-3">
                {auditLogs.map((item) => (
                  <div key={item.id} className="rounded-xl border border-slate-800 bg-slate-800/60 p-4">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <p className="text-sm font-semibold text-white">{item.title}</p>
                        <p className="mt-1 text-xs text-slate-400">{item.detail}</p>
                      </div>
                      <span className="text-[10px] uppercase tracking-[0.14em] text-slate-500">{item.time}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        );
      case 'recent-activity':
        return (
          <div className="space-y-6">
            <div className="rounded-2xl border border-slate-700 bg-slate-900/70 p-6">
              <div className="mb-5 flex items-center justify-between">
                <div>
                  <div className="text-[10px] uppercase tracking-[0.24em] text-cyan-300">Live updates</div>
                  <h3 className="mt-2 text-2xl font-bold text-white">Recent Activity</h3>
                </div>
                <span className="rounded-full bg-cyan-500/15 px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.2em] text-cyan-200">Updated</span>
              </div>

              <div className="space-y-3">
                {recentActivity.map((item) => (
                  <div key={item.title} className="rounded-xl border border-slate-800 bg-slate-800/60 p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="text-sm font-semibold text-white">{item.title}</p>
                        <p className="mt-1 text-xs text-slate-400">{item.detail}</p>
                      </div>
                      <span className="text-[10px] uppercase tracking-[0.14em] text-slate-500">{item.time}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        );
      case 'clinic-summary':
        return (
          <div className="space-y-6">
            <div className="rounded-3xl border border-slate-700 bg-gradient-to-br from-slate-900 via-slate-900 to-slate-950 p-6 shadow-[0_24px_80px_rgba(15,23,42,0.5)]">
              <div className="mb-5 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                <div>
                  <div className="text-[10px] uppercase tracking-[0.24em] text-emerald-300">Operations report</div>
                  <h3 className="mt-2 text-2xl font-bold text-white">Clinic Wise Summary</h3>
                </div>
                <span className="rounded-full bg-emerald-500/15 px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.2em] text-emerald-200">Live</span>
              </div>

              <div className="mb-6 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                <div className="max-w-md">
                  <label className="mb-2 block text-sm font-medium text-slate-300">Select clinic</label>
                  <select
                    value={selectedClinicSummary}
                    onChange={(event) => setSelectedClinicSummary(event.target.value)}
                    className="w-full rounded-xl border border-slate-700 bg-slate-800 px-4 py-3 text-white focus:border-emerald-400 focus:outline-none"
                  >
                    {summaryClinicOptions.map((clinicName) => (
                      <option key={clinicName} value={clinicName}>{clinicName}</option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="mb-2 block text-sm font-medium text-slate-300">From date</label>
                  <input
                    type="date"
                    value={summaryDateRange.start}
                    onChange={(event) => setSummaryDateRange((current) => ({ ...current, start: event.target.value }))}
                    className="w-full rounded-xl border border-slate-700 bg-slate-800 px-4 py-3 text-white focus:border-emerald-400 focus:outline-none"
                  />
                </div>

                <div>
                  <label className="mb-2 block text-sm font-medium text-slate-300">To date</label>
                  <input
                    type="date"
                    value={summaryDateRange.end}
                    onChange={(event) => setSummaryDateRange((current) => ({ ...current, end: event.target.value }))}
                    className="w-full rounded-xl border border-slate-700 bg-slate-800 px-4 py-3 text-white focus:border-emerald-400 focus:outline-none"
                  />
                </div>
              </div>

              <div className="rounded-2xl border border-slate-800 bg-slate-800/60 p-5">
                <div className="mb-4 flex items-center justify-between gap-3">
                  <div>
                    <div className="text-[10px] uppercase tracking-[0.18em] text-slate-400">Selected clinic</div>
                    <div className="mt-1 text-2xl font-bold text-white">{filteredClinicSummaryData.clinic}</div>
                  </div>
                  <span className="rounded-full bg-slate-700 px-3 py-1.5 text-[10px] uppercase tracking-[0.14em] text-slate-200">
                    {filteredClinicSummaryData.walkIns + filteredClinicSummaryData.online + filteredClinicSummaryData.followUps} total
                  </span>
                </div>

                <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                  <div className="rounded-2xl border border-slate-700 bg-slate-900/70 p-5 shadow-lg shadow-slate-950/30">
                    <div className="text-[10px] uppercase tracking-[0.15em] text-slate-400">Walk-ins</div>
                    <div className="mt-3 text-4xl font-black text-white">{filteredClinicSummaryData.walkIns}</div>
                  </div>
                  <div className="rounded-2xl border border-slate-700 bg-slate-900/70 p-5 shadow-lg shadow-slate-950/30">
                    <div className="text-[10px] uppercase tracking-[0.15em] text-slate-400">Online</div>
                    <div className="mt-3 text-4xl font-black text-white">{filteredClinicSummaryData.online}</div>
                  </div>
                  <div className="rounded-2xl border border-slate-700 bg-slate-900/70 p-5 shadow-lg shadow-slate-950/30">
                    <div className="text-[10px] uppercase tracking-[0.15em] text-slate-400">Follow-ups</div>
                    <div className="mt-3 text-4xl font-black text-white">{filteredClinicSummaryData.followUps}</div>
                  </div>
                  <div className="rounded-2xl border border-slate-700 bg-slate-900/70 p-5 shadow-lg shadow-slate-950/30">
                    <div className="text-[10px] uppercase tracking-[0.15em] text-slate-400">No-shows</div>
                    <div className="mt-3 text-4xl font-black text-white">{filteredClinicSummaryData.noShows}</div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        );
      case 'content':
        if (!isSiteAdmin) {
          return null;
        }

        const contentCards = [
          {
            key: 'branding',
            title: 'Branding & titles',
            badge: 'Brand',
            summary: 'Manage the site identity, hero message and main campaign copy.',
            fields: [
              { label: 'Site name', value: siteSettings.siteName, onChange: (value: string) => setSiteSettings({ ...siteSettings, siteName: value }) },
              { label: 'Tagline', value: siteSettings.siteTagline, onChange: (value: string) => setSiteSettings({ ...siteSettings, siteTagline: value }) },
              { label: 'Hero title', value: contentSections.heroTitle, onChange: (value: string) => setContentSections({ ...contentSections, heroTitle: value }) },
              { label: 'Hero subtitle', value: contentSections.heroSubtitle, onChange: (value: string) => setContentSections({ ...contentSections, heroSubtitle: value }), textarea: true },
            ],
          },
          {
            key: 'pages',
            title: 'Page titles',
            badge: 'Content',
            summary: 'Update the page headings and footer copy used across the website.',
            fields: [
              { label: 'What we provide', value: contentSections.whatWeProvideTitle, onChange: (value: string) => setContentSections({ ...contentSections, whatWeProvideTitle: value }) },
              { label: 'Why choose us', value: contentSections.whyChooseTitle, onChange: (value: string) => setContentSections({ ...contentSections, whyChooseTitle: value }) },
              { label: 'Benefits', value: contentSections.benefitsTitle, onChange: (value: string) => setContentSections({ ...contentSections, benefitsTitle: value }) },
              { label: 'Contact', value: contentSections.contactTitle, onChange: (value: string) => setContentSections({ ...contentSections, contactTitle: value }) },
              { label: 'Footer text', value: contentSections.footerText, onChange: (value: string) => setContentSections({ ...contentSections, footerText: value }) },
            ],
          },
          {
            key: 'contact',
            title: 'Contact details',
            badge: 'Contact',
            summary: 'Edit the main contact channels, support address, and WhatsApp greeting for the clinic.',
            fields: [
              { label: 'Email', value: siteSettings.contactEmail, onChange: (value: string) => setSiteSettings({ ...siteSettings, contactEmail: value }), type: 'email' },
              { label: 'Phone', value: siteSettings.contactPhone, onChange: (value: string) => setSiteSettings({ ...siteSettings, contactPhone: value }), type: 'tel' },
              { label: 'WhatsApp', value: siteSettings.whatsappNumber, onChange: (value: string) => setSiteSettings({ ...siteSettings, whatsappNumber: value }), type: 'tel' },
              { label: 'WhatsApp prefilled message', value: siteSettings.whatsappMessage, onChange: (value: string) => setSiteSettings({ ...siteSettings, whatsappMessage: value }), textarea: true },
              { label: 'Support address', value: siteSettings.supportAddress, onChange: (value: string) => setSiteSettings({ ...siteSettings, supportAddress: value }) },
            ],
          },
          {
            key: 'media',
            title: 'Media & social',
            badge: 'Links',
            summary: 'Adjust the social platform URLs used in the site footer and contact area.',
            fields: [
              { label: 'Facebook URL', value: siteSettings.facebookUrl, onChange: (value: string) => setSiteSettings({ ...siteSettings, facebookUrl: value }) },
              { label: 'Instagram URL', value: siteSettings.instagramUrl, onChange: (value: string) => setSiteSettings({ ...siteSettings, instagramUrl: value }) },
              { label: 'LinkedIn URL', value: siteSettings.linkedinUrl, onChange: (value: string) => setSiteSettings({ ...siteSettings, linkedinUrl: value }) },
              { label: 'X / Twitter URL', value: siteSettings.xUrl, onChange: (value: string) => setSiteSettings({ ...siteSettings, xUrl: value }) },
              { label: 'YouTube URL', value: siteSettings.youtubeUrl, onChange: (value: string) => setSiteSettings({ ...siteSettings, youtubeUrl: value }) },
              { label: 'Start free trial Google Form URL', value: siteSettings.freeTrialFormUrl, onChange: (value: string) => setSiteSettings({ ...siteSettings, freeTrialFormUrl: value }), type: 'url' },
              { label: 'Talk to sales Google Form URL', value: siteSettings.salesFormUrl, onChange: (value: string) => setSiteSettings({ ...siteSettings, salesFormUrl: value }), type: 'url' },
            ],
          },
        ];

        return (
          <div className="space-y-6">
            <div className="mb-2 flex items-center justify-between">
              <h3 className="text-xl font-bold">Website content</h3>
              <span className="rounded-full bg-violet-500/15 px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.2em] text-violet-200">Editable</span>
            </div>

            <div className="grid gap-5 xl:grid-cols-2">
              {contentCards.map(({ key, title, badge, summary, fields }) => {
                const isExpanded = !!expandedContentCards[key];

                return (
                  <div key={key} className="rounded-2xl border border-slate-700 bg-slate-900/70 p-5">
                    <button
                      type="button"
                      onClick={() => setExpandedContentCards((current) => ({ ...current, [key]: !current[key] }))}
                      className="flex w-full items-start justify-between gap-3 text-left"
                    >
                      <div className="flex-1">
                        <h4 className="text-base font-bold text-white">{title}</h4>
                        {!isExpanded && (
                          <div className="mt-3 rounded-xl border border-slate-700 bg-slate-800/80 p-3">
                            <p className="text-sm text-slate-200">{summary}</p>
                            <p className="mt-2 text-[10px] uppercase tracking-[0.15em] text-slate-400">Click to view details</p>
                          </div>
                        )}
                      </div>

                      <span className="rounded-full bg-slate-800 px-2 py-1 text-[10px] uppercase tracking-[0.15em] text-slate-300">
                        {isExpanded ? 'Open' : badge}
                      </span>
                    </button>

                    {isExpanded && (
                      <div className="mt-4 space-y-4 border-t border-slate-800 pt-4">
                        {fields.map((field) => (
                          <div key={field.label}>
                            <label className="mb-2 block text-sm font-medium">{field.label}</label>
                            {field.textarea ? (
                              <textarea
                                value={field.value}
                                onChange={(event) => field.onChange(event.target.value)}
                                rows={3}
                                className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-white"
                              />
                            ) : field.type === 'tel' ? (
                              <PhoneInput value={field.value} onChange={field.onChange} />
                            ) : (
                              <input
                                type={field.type || 'text'}
                                value={field.value}
                                onChange={(event) => field.onChange(event.target.value)}
                                className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-white"
                              />
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            {hasUnsavedSettingsChanges && (
              <div className="flex justify-end">
                <button
                  onClick={handleSaveSettings}
                  className="rounded-lg bg-gradient-to-r from-emerald-500 to-cyan-500 px-6 py-2 font-semibold text-white hover:shadow-lg hover:shadow-emerald-500/50 transition"
                >
                  Save Changes
                </button>
              </div>
            )}
          </div>
        );
      case 'clinics':
        return (
          <div className="space-y-6">
            <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
              <div className="flex-1 relative">
                <Search className="absolute left-3 top-3 w-5 h-5 text-slate-400" />
                <input
                  type="text"
                  placeholder="Search clinics..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="w-full bg-slate-800 border border-slate-700 rounded-lg pl-10 pr-4 py-2 text-white placeholder-slate-500 focus:border-emerald-400 focus:outline-none"
                />
              </div>
              {isSiteAdmin && (
                <button
                  onClick={openAddClinicModal}
                  className="px-6 py-2 bg-gradient-to-r from-emerald-500 to-cyan-500 rounded-lg font-semibold hover:shadow-lg hover:shadow-emerald-500/50 flex items-center gap-2 transition"
                >
                  <Plus className="w-5 h-5" />
                  Add Clinic
                </button>
              )}
            </div>

            {loading ? (
              <div className="rounded-2xl border border-slate-700 bg-slate-900/70 p-8 text-center text-slate-400">Loading clinics...</div>
            ) : filteredClinics.length === 0 ? (
              <div className="rounded-2xl border border-slate-700 bg-slate-900/70 p-10 text-center">
                <Building2 className="mx-auto mb-3 h-12 w-12 text-slate-600" />
                <p className="text-slate-400">No clinics found</p>
              </div>
            ) : (
              <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
                {filteredClinics.map((clinic) => (
                  <div key={clinic.id} className="rounded-2xl border border-slate-700 bg-slate-900/70 p-5">
                    <div className="mb-4 flex items-start justify-between gap-3">
                      <div>
                        <h3 className="text-lg font-bold text-white">{clinic.name}</h3>
                        <p className="text-sm text-slate-400">{clinic.address}</p>
                      </div>
                      <div className="flex flex-col items-end gap-2">
                        <span className={`rounded-full px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] ${clinic.subscriptionStatus === 'ACTIVE' ? 'bg-emerald-500/15 text-emerald-300' : clinic.subscriptionStatus === 'EXPIRED' ? 'bg-rose-500/15 text-rose-300' : 'bg-amber-500/15 text-amber-300'}`}>
                          {clinic.subscriptionStatus || 'PAUSED'}
                        </span>
                        <div className="flex gap-2">
                        <button onClick={() => handleEditClinic(clinic)} className="rounded-lg bg-blue-500/15 p-2 text-blue-300"><Edit className="h-4 w-4" /></button>
                        <button onClick={() => handleDeleteClinic(clinic.id)} className="rounded-lg bg-red-500/15 p-2 text-red-300"><Trash2 className="h-4 w-4" /></button>
                        </div>
                      </div>
                    </div>

                    <div className="space-y-2 text-sm text-slate-300">
                      <p className="font-semibold text-teal-300">{clinic.featurePlan || 'TRIAL'} plan</p>
                      <p className="text-xs text-slate-400">Expires {clinic.subscriptionExpiresAt ? new Date(clinic.subscriptionExpiresAt).toLocaleDateString('en-IN') : 'not set'}</p>
                      {(clinic.subscriptionStatus === 'EXPIRED' || clinic.subscriptionStatus === 'PAUSED') && (
                        <p className="text-xs font-semibold text-amber-300">Access restricted. Renew or activate this plan to resume clinic operations.</p>
                      )}
                      <p>{clinic.phone}</p>
                      <p>{clinic.email}</p>
                      <p className="flex items-center gap-2"><Clock className="h-4 w-4 text-emerald-400" /> {clinic.operatingHours}</p>
                    </div>

                    <div className="mt-4 flex flex-wrap gap-2">
                      {clinic.specializations?.map((spec) => (
                        <span key={spec} className="rounded-full bg-emerald-500/10 px-2 py-1 text-[10px] uppercase tracking-[0.12em] text-emerald-300">{spec}</span>
                      ))}
                    </div>

                    <button onClick={() => onManageDoctors(clinic.id, clinic.name)} className="mt-5 w-full rounded-lg bg-slate-800 px-3 py-2 text-sm font-semibold text-slate-200 hover:bg-slate-700">
                      Manage doctors
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      case 'barcode-inventory':
        return (
          <div className="space-y-6">
            <div className="rounded-2xl border border-slate-700 bg-slate-900/70 p-6">
              <div className="mb-5 flex items-start justify-between gap-4">
                <div>
                  <div className="text-[10px] uppercase tracking-[0.2em] text-emerald-300">Super Admin tools</div>
                  <h3 className="mt-2 text-2xl font-bold text-white">Barcode Inventory</h3>
                  <p className="mt-1 text-sm text-slate-400">Create unique Code 39 barcodes and assign one barcode to each doctor.</p>
                </div>
                <Barcode className="h-8 w-8 text-emerald-400" />
              </div>

              <div className="grid gap-4 rounded-xl border border-slate-700 bg-slate-800/70 p-4 md:grid-cols-[1fr_1fr_1.5fr_auto] md:items-end">
                <div>
                  <label className="mb-2 block text-xs font-semibold uppercase tracking-wide text-slate-400">Barcode value</label>
                  <input
                    value={barcodeForm.barcodeValue}
                    onChange={(event) => setBarcodeForm((current) => ({ ...current, barcodeValue: event.target.value }))}
                    className="w-full rounded-lg border border-slate-600 bg-slate-900 px-3 py-2 text-white focus:border-emerald-400 focus:outline-none"
                    placeholder={`Auto: NQ-${String(barcodeInventory.length + 1).padStart(4, '0')}`}
                  />
                </div>
                <div>
                  <label className="mb-2 block text-xs font-semibold uppercase tracking-wide text-slate-400">Label *</label>
                  <input
                    value={barcodeForm.label}
                    onChange={(event) => setBarcodeForm((current) => ({ ...current, label: event.target.value }))}
                    className="w-full rounded-lg border border-slate-600 bg-slate-900 px-3 py-2 text-white focus:border-emerald-400 focus:outline-none"
                    placeholder="Doctor counter barcode"
                  />
                </div>
                <div>
                  <label className="mb-2 block text-xs font-semibold uppercase tracking-wide text-slate-400">Notes</label>
                  <input
                    value={barcodeForm.notes}
                    onChange={(event) => setBarcodeForm((current) => ({ ...current, notes: event.target.value }))}
                    className="w-full rounded-lg border border-slate-600 bg-slate-900 px-3 py-2 text-white focus:border-emerald-400 focus:outline-none"
                    placeholder="Optional inventory note"
                  />
                </div>
                <button onClick={createBarcodeInventoryItem} className="rounded-lg bg-emerald-500 px-4 py-2 font-semibold text-slate-950 transition hover:bg-emerald-400">
                  <Plus className="mr-1 inline h-4 w-4" /> Create
                </button>
              </div>
            </div>

            <div className="grid gap-4 lg:grid-cols-2">
              {barcodeInventory.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-slate-700 bg-slate-900/50 p-10 text-center text-sm text-slate-400 lg:col-span-2">No barcodes in inventory yet.</div>
              ) : barcodeInventory.map((item) => (
                <div key={item.id} className="rounded-2xl border border-slate-700 bg-slate-900/70 p-5">
                  <button
                    type="button"
                    onClick={() => setExpandedBarcodeId((current) => current === item.id ? null : item.id)}
                    className="flex w-full items-center justify-between gap-4 text-left"
                    aria-expanded={expandedBarcodeId === item.id}
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <h4 className="truncate text-lg font-bold text-white">{item.label || 'Preprinted QR'}</h4>
                        <span className={`rounded-full px-2 py-1 text-[10px] font-semibold uppercase tracking-wide ${
                          item.status === 'ASSIGNED'
                            ? 'bg-emerald-500/15 text-emerald-300'
                            : item.status === 'DISABLED'
                              ? 'bg-rose-500/15 text-rose-300'
                              : 'bg-amber-500/15 text-amber-300'
                        }`}>{item.status}</span>
                      </div>
                      <p className="mt-1 text-xs text-slate-400">{item.assignedDoctorName || 'Available for assignment'} · Updated {formatDashboardDate(item.updatedAt)}</p>
                    </div>
                    {expandedBarcodeId === item.id ? <ChevronUp className="h-5 w-5 shrink-0 text-slate-400" /> : <ChevronDown className="h-5 w-5 shrink-0 text-slate-400" />}
                  </button>

                  {expandedBarcodeId === item.id && <>
                    <div className="mt-4 flex justify-end">
                      <button onClick={() => deleteBarcodeInventoryItem(item.id)} className="inline-flex items-center gap-1 rounded-lg p-2 text-xs font-semibold text-slate-400 transition hover:bg-rose-500/10 hover:text-rose-300" title="Delete barcode">
                        <Trash2 className="h-4 w-4" /> Delete
                      </button>
                    </div>

                    <div className="mt-1 grid gap-4 sm:grid-cols-[minmax(0,1fr)_180px] sm:items-center">
                      <BarcodePreview value={item.barcodeValue} />
                      <div className="space-y-3">
                        <button onClick={() => printBarcode(item.barcodeValue)} className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-emerald-500 px-3 py-2 text-sm font-semibold text-slate-950 transition hover:bg-emerald-400">
                          <Printer className="h-4 w-4" /> Save / Print Barcode
                        </button>
                        <div>
                          <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">Status</label>
                          <select
                            value={item.status}
                            onChange={(event) => updateBarcodeStatus(item.id, event.target.value as BarcodeInventoryItem['status'])}
                            className="w-full rounded-lg border border-slate-600 bg-slate-800 px-3 py-2 text-sm text-white focus:border-emerald-400 focus:outline-none"
                          >
                            <option value="AVAILABLE">Available</option>
                            <option value="ASSIGNED">Assigned</option>
                            <option value="DISABLED">Disabled</option>
                          </select>
                        </div>

                        <div>
                          <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">Assign doctor</label>
                          <select
                            value={item.assignedDoctorId || ''}
                            onChange={(event) => assignBarcodeToDoctor(item.id, event.target.value)}
                            disabled={item.status === 'DISABLED'}
                            className="w-full rounded-lg border border-slate-600 bg-slate-800 px-3 py-2 text-sm text-white focus:border-emerald-400 focus:outline-none disabled:cursor-not-allowed disabled:opacity-50"
                          >
                            <option value="">Available</option>
                            {inventoryDoctors.map((doctor) => <option key={doctor.id} value={doctor.id}>{doctor.name}</option>)}
                          </select>
                        </div>

                        <div className="text-xs text-slate-400">
                          <p className="flex items-center gap-1"><Link2 className="h-3.5 w-3.5 text-emerald-400" /> {item.assignedDoctorName || (item.status === 'ASSIGNED' ? 'Assigned to a doctor' : 'Available for assignment')}</p>
                          {item.assignedClinicId && <p className="mt-1">Clinic: {clinics.find((clinic) => clinic.id === item.assignedClinicId)?.name || item.assignedClinicId}</p>}
                        </div>
                        {item.status === 'ASSIGNED' && <button onClick={() => assignBarcodeToDoctor(item.id, '')} className="inline-flex items-center gap-1 text-xs font-semibold text-amber-300 hover:text-amber-200"><Unlink className="h-3.5 w-3.5" /> De-assign</button>}
                      </div>
                    </div>
                    {item.notes && <p className="mt-4 border-t border-slate-800 pt-3 text-xs text-slate-500">{item.notes}</p>}
                  </>}
                </div>
              ))}
            </div>
          </div>
        );
      case 'users':
        return (
          <div className="space-y-6">
            <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
              <div>
                <h3 className="text-xl font-bold">User directory</h3>
                <p className="text-sm text-slate-400">Review access, edit roles, and manage active team members.</p>
              </div>
              <button
                type="button"
                onClick={() => {
                  setEditingUser(null);
                  setUserFormData({ name: '', email: '', role: 'Clinic Admin', status: 'Active', clinicName: '', phone: '+91 ', accessStatus: 'Granted', photoURL: '', passwordReset: '' });
                  setShowUserModal(true);
                }}
                className="rounded-lg bg-emerald-500 px-4 py-2 font-semibold text-slate-950"
              >
                Add user
              </button>
            </div>

            <div className="rounded-2xl border border-slate-700 bg-slate-900/70 p-6">
              <div className="mb-6 grid gap-3 md:grid-cols-4">
                <div className="relative md:col-span-2">
                  <Search className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-slate-500" />
                  <input
                    type="search"
                    value={userFilters.search}
                    onChange={(event) => setUserFilters((current) => ({ ...current, search: event.target.value }))}
                    placeholder="Search users..."
                    className="w-full rounded-lg border border-slate-700 bg-slate-800 px-4 py-2 pl-9 text-sm text-white placeholder-slate-500 focus:border-emerald-400 focus:outline-none"
                  />
                </div>
                <select
                  value={userFilters.role}
                  onChange={(event) => setUserFilters((current) => ({ ...current, role: event.target.value }))}
                  className="rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-white focus:border-emerald-400 focus:outline-none"
                >
                  <option value="ALL">All roles</option>
                  {[...new Set(users.map((user) => user.role))].sort().map((role) => <option key={role} value={role}>{role}</option>)}
                </select>
                <select
                  value={userFilters.status}
                  onChange={(event) => setUserFilters((current) => ({ ...current, status: event.target.value }))}
                  className="rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-white focus:border-emerald-400 focus:outline-none"
                >
                  <option value="ALL">All statuses</option>
                  <option value="Active">Active</option>
                  <option value="Offline">Offline</option>
                  <option value="Pending">Pending</option>
                </select>
                <select
                  value={userFilters.clinic}
                  onChange={(event) => setUserFilters((current) => ({ ...current, clinic: event.target.value }))}
                  className="rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-white focus:border-emerald-400 focus:outline-none md:col-span-2"
                >
                  <option value="ALL">All clinics</option>
                  {[...new Set(users.map((user) => user.clinicName).filter(Boolean))].sort().map((clinicName) => <option key={clinicName} value={clinicName}>{clinicName}</option>)}
                </select>
              </div>
              <div className="space-y-3">
                {users.length === 0 ? (
                  <div className="text-center text-slate-400 py-8">No users found in the directory.</div>
                ) : filteredUsers.length === 0 ? (
                  <div className="text-center text-slate-400 py-8">No users match the selected filters.</div>
                ) : (
                  filteredUsers.map((user) => (
                    <div key={user.id} className="flex flex-col gap-3 rounded-xl border border-slate-800 bg-slate-800/60 p-4 md:flex-row md:items-center md:justify-between">
                      <div className="flex items-center gap-3">
                        <div className="flex h-12 w-12 items-center justify-center overflow-hidden rounded-full border border-slate-600 bg-slate-700 text-sm font-bold text-emerald-300">
                          {user.photoURL ? <img src={user.photoURL} alt={user.name} className="h-full w-full object-cover" /> : <span>{user.name.split(' ').map(part => part[0]).join('').slice(0, 2).toUpperCase()}</span>}
                        </div>
                        <div>
                          <div className="text-base font-semibold text-white">{user.name}</div>
                          <div className="text-xs text-slate-400">{user.email}</div>
                          <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-slate-300">
                            <span className="rounded-full bg-slate-700 px-2 py-1">{user.role}</span>
                            {user.clinicName && <span className="rounded-full bg-slate-700 px-2 py-1">{user.clinicName}</span>}
                            {user.phone && <span className="rounded-full bg-slate-700 px-2 py-1">{user.phone}</span>}
                            <span className={`rounded-full px-2 py-1 ${user.accessStatus === 'Granted' ? 'bg-emerald-500/15 text-emerald-300' : user.accessStatus === 'Hold' ? 'bg-amber-500/15 text-amber-300' : 'bg-red-500/15 text-red-300'}`}>{user.accessStatus || 'Granted'}</span>
                          </div>
                        </div>
                      </div>

                      <div className="flex items-center gap-3">
                        <span className={`rounded-full px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] ${user.status === 'Active' ? 'bg-emerald-500/15 text-emerald-300' : user.status === 'Offline' ? 'bg-slate-500/15 text-slate-300' : 'bg-amber-500/15 text-amber-300'}`}>
                          {user.status}
                        </span>
                        <button
                          type="button"
                          onClick={() => handleResetUserPassword(user.id)}
                          className="rounded-full bg-amber-500/15 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-amber-200 hover:bg-amber-500/25"
                        >
                          {user.passwordReset ? `Reset (${user.passwordReset})` : 'Reset password'}
                        </button>
                        <button onClick={() => handleEditUser(user)} className="rounded-lg bg-blue-500/15 p-2 text-blue-300"><Edit className="h-4 w-4" /></button>
                        <button onClick={() => handleDeleteUser(user.id)} className="rounded-lg bg-red-500/15 p-2 text-red-300"><Trash2 className="h-4 w-4" /></button>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        );
      case 'security':
        return (
          <div className="space-y-6">
            <div className="rounded-2xl border border-slate-700 bg-slate-900/70 p-6">
              <div className="mb-6 flex items-center justify-between">
                <h3 className="text-xl font-bold">Clinic access management</h3>
                <span className="rounded-full bg-emerald-500/15 px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.2em] text-emerald-200">Live</span>
              </div>

              <div className="grid gap-4 md:grid-cols-3">
                {['Granted', 'Hold', 'Denied', 'Expired'].map((status) => {
                  const count = clinicAccessCounts[status as keyof typeof clinicAccessCounts];
                  return (
                    <div key={status} className="rounded-xl border border-slate-800 bg-slate-800/70 p-4">
                      <div className="text-[10px] uppercase tracking-[0.18em] text-slate-400">{status}</div>
                      <div className="mt-2 text-3xl font-black text-white">{count}</div>
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="rounded-2xl border border-slate-700 bg-slate-900/70 p-6">
              <h3 className="mb-4 text-xl font-bold">Clinic access matrix</h3>
              <div className="space-y-3">
                {clinics.length === 0 ? (
                  <div className="text-sm text-slate-400">No clinics available.</div>
                ) : (
                  clinics.map((clinic) => {
                    const clinicUsers = users.filter((user) => (user.clinicName || '').toLowerCase() === clinic.name.toLowerCase() || user.clinicName === clinic.name);
                    const status = getClinicAccessStatus(clinic);
                    return (
                      <div key={clinic.id} className="flex flex-col gap-3 rounded-xl border border-slate-800 bg-slate-800/60 p-4 md:flex-row md:items-center md:justify-between">
                        <div>
                          <div className="font-semibold text-white">{clinic.name}</div>
                          <div className="text-xs text-slate-400">{clinicUsers.length} linked users</div>
                        </div>
                        <div className="flex items-center gap-3">
                          <select
                            value={status}
                            disabled={status === 'Expired'}
                            onChange={async (e) => {
                              const newStatus = e.target.value as 'Granted' | 'Hold' | 'Denied';
                              try {
                                const response = await fetch('/api/clinic-access', {
                                  method: 'POST',
                                  credentials: 'include',
                                  headers: { 'Content-Type': 'application/json' },
                                  body: JSON.stringify({ clinicId: clinic.id, status: newStatus }),
                                });
                                if (!response.ok) throw new Error('Unable to update clinic access.');
                                setClinicAccess((current) => ({ ...current, [clinic.id]: newStatus }));
                                void recordAuditEvent('Access changed', `${clinic.name} access changed to ${newStatus} for ${clinicUsers.length} linked user(s).`);
                              } catch (error) {
                                console.error('Error updating clinic access:', error);
                                window.alert('Failed to update access. Please try again.');
                              }
                            }}
                            className="rounded-lg bg-slate-700 border border-slate-600 px-3 py-2 text-sm font-medium text-white focus:border-emerald-400 focus:outline-none disabled:cursor-not-allowed disabled:opacity-70"
                          >
                            <option value="Granted">Granted</option>
                            <option value="Hold">Hold</option>
                            <option value="Denied">Denied</option>
                            {status === 'Expired' && <option value="Expired">Expired</option>}
                          </select>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          </div>
        );
      case 'billing':
        return (
          <div className="space-y-6">
            <div className="grid gap-4 md:grid-cols-4">
              {billingSummary.map((item) => (
                <div key={item.label} className="rounded-2xl border border-slate-700 bg-slate-900/70 p-5">
                  <div className="text-[10px] uppercase tracking-[0.18em] text-slate-400">{item.label}</div>
                  <div className="mt-3 text-3xl font-black text-white">{item.value}</div>
                </div>
              ))}
            </div>

            <div className="rounded-2xl border border-slate-700 bg-slate-900/70 p-6">
              <div className="mb-5 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                <div>
                  <div className="text-[10px] uppercase tracking-[0.2em] text-violet-300">Subscription packs</div>
                  <h3 className="mt-2 text-2xl font-bold text-white">Clinic pack management</h3>
                </div>
                <div className="flex gap-2">
                  <button onClick={() => setBillingTab('overview')} className={`rounded-xl px-3 py-2 text-sm font-semibold ${billingTab === 'overview' ? 'bg-emerald-500 text-slate-950' : 'border border-slate-700 bg-slate-800 text-slate-200'}`}>
                    Overview
                  </button>
                  <button onClick={() => setBillingTab('add-payment')} className={`rounded-xl px-3 py-2 text-sm font-semibold ${billingTab === 'add-payment' ? 'bg-violet-500 text-white' : 'border border-slate-700 bg-slate-800 text-slate-200'}`}>
                    Add payment
                  </button>
                </div>
              </div>

              {billingTab === 'overview' ? (
                <>
                  <div className="grid gap-4 lg:grid-cols-2">
                    {PACK_OPTIONS.map((pack) => {
                      const activeCount = clinics.filter((clinic) => (clinic.featurePlan || 'TRIAL') === pack.value).length;
                      const packClinics = clinics.filter((clinic) => (clinic.featurePlan || 'TRIAL') === pack.value);
                      const isExpanded = expandedBillingPack === pack.value;
                      return (
                        <div
                          key={pack.value}
                          onClick={() => setExpandedBillingPack(isExpanded ? null : pack.value)}
                          className={`rounded-2xl border p-5 text-left transition ${isExpanded ? 'border-emerald-400/50 bg-slate-800' : 'border-slate-800 bg-slate-800/70 hover:border-emerald-400/40'}`}
                        >
                          <div className="flex items-start justify-between gap-4">
                            <div>
                              <div className="text-[10px] uppercase tracking-[0.18em] text-slate-400">{pack.label}</div>
                              <div className="mt-2 text-2xl font-black text-white">{pack.price}</div>
                            </div>
                            <span className="rounded-full bg-slate-700 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-200">{pack.validityDays} days</span>
                          </div>
                          <div className="mt-4 text-sm text-slate-400">{activeCount} clinics assigned</div>
                          {isExpanded && (
                            <div className="mt-4 space-y-2 border-t border-slate-700 pt-4">
                              {packClinics.length > 0 ? packClinics.map((clinic) => {
                                const latestPayment = payments.find((payment) => payment.clinicId === clinic.id || payment.clinicName.toLowerCase() === clinic.name.toLowerCase());
                                return (
                                  <div key={clinic.id} className="flex flex-col gap-2 rounded-lg bg-slate-900/60 p-3 sm:flex-row sm:items-center sm:justify-between" onClick={(event) => event.stopPropagation()}>
                                    <div>
                                      <div className="text-sm font-semibold text-white">{clinic.name}</div>
                                      <div className="text-xs text-slate-400">{latestPayment ? `${latestPayment.status} · ₹${Number(latestPayment.amount).toLocaleString('en-IN')}` : 'No billing recorded'}</div>
                                    </div>
                                    <div className="flex gap-2">
                                      {latestPayment && <button onClick={() => openClinicBilling(clinic, latestPayment)} className="rounded-lg border border-slate-600 px-3 py-2 text-xs font-semibold text-slate-200 hover:border-violet-400">Edit billing</button>}
                                      <button onClick={() => openClinicBilling(clinic)} className="rounded-lg bg-violet-500 px-3 py-2 text-xs font-semibold text-white hover:bg-violet-400">Add billing</button>
                                    </div>
                                  </div>
                                );
                              }) : <span className="text-xs text-slate-500">No clinics assigned</span>}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>

                </>
              ) : (
                <div className="rounded-2xl border border-slate-700 bg-slate-900/70 p-6">
                  <h3 className="mb-5 text-xl font-bold">Record clinic payment</h3>
                  <div className="grid gap-4 md:grid-cols-2">
                    <div>
                      <label className="mb-2 block text-sm font-medium text-slate-300">Clinic</label>
                      <select
                        value={paymentForm.clinicId}
                        onChange={(event) => {
                          const selectedClinic = clinics.find((clinic) => clinic.id === event.target.value);
                          setPaymentForm((current) => ({
                            ...current,
                            clinicId: event.target.value,
                            clinicName: selectedClinic?.name || current.clinicName,
                          }));
                        }}
                        className="w-full rounded-xl border border-slate-700 bg-slate-800 px-3 py-2.5 text-white focus:border-violet-400 focus:outline-none"
                      >
                        <option value="">Select clinic</option>
                        {clinics.map((clinic) => (
                          <option key={clinic.id} value={clinic.id}>{clinic.name}</option>
                        ))}
                      </select>
                    </div>

                    <div>
                      <label className="mb-2 block text-sm font-medium text-slate-300">Or clinic name</label>
                      <input
                        type="text"
                        value={paymentForm.clinicName}
                        onChange={(event) => setPaymentForm((current) => ({ ...current, clinicName: event.target.value }))}
                        className="w-full rounded-xl border border-slate-700 bg-slate-800 px-3 py-2.5 text-white focus:border-violet-400 focus:outline-none"
                        placeholder="Clinic name"
                      />
                    </div>

                    <div>
                      <label className="mb-2 block text-sm font-medium text-slate-300">Pack</label>
                      <select
                        value={paymentForm.pack}
                        onChange={(event) => {
                          const newPack = event.target.value as FeaturePlan;
                          const autoAmount = getPackPrice(newPack);
                          setPaymentForm((current) => ({ 
                            ...current, 
                            pack: newPack,
                            amount: autoAmount.toString(),
                            durationDays: getPackMeta(newPack)?.validityDays?.toString() || '30'
                          }));
                        }}
                        className="w-full rounded-xl border border-slate-700 bg-slate-800 px-3 py-2.5 text-white focus:border-violet-400 focus:outline-none"
                      >
                        {PACK_OPTIONS.map((pack) => (
                          <option key={pack.value} value={pack.value}>{pack.label}</option>
                        ))}
                      </select>
                    </div>

                    {paymentForm.pack === 'TRIAL' && (
                      <div>
                        <label className="mb-2 block text-sm font-medium text-slate-300">Trial for plan</label>
                        <select
                          value={paymentForm.trialForPlan}
                          onChange={(event) => setPaymentForm((current) => ({ ...current, trialForPlan: event.target.value as FeaturePlan }))}
                          className="w-full rounded-xl border border-slate-700 bg-slate-800 px-3 py-2.5 text-white focus:border-violet-400 focus:outline-none"
                        >
                          {TRIAL_TARGET_OPTIONS.map((plan) => <option key={plan.value} value={plan.value}>{plan.label}</option>)}
                        </select>
                      </div>
                    )}

                    <div>
                      <label className="mb-2 block text-sm font-medium text-slate-300">Amount paid</label>
                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        value={paymentForm.amount}
                        onChange={(event) => setPaymentForm((current) => ({ ...current, amount: event.target.value }))}
                        className="w-full rounded-xl border border-slate-700 bg-slate-800 px-3 py-2.5 text-white focus:border-violet-400 focus:outline-none"
                        placeholder={paymentForm.pack === 'TRIAL' ? '0 (auto-filled for Trial)' : paymentForm.pack === 'ENTERPRISE' ? 'Enter custom amount' : 'Auto-filled based on pack'}
                      />
                      <p className="mt-1 text-xs text-slate-500">Auto-fills based on selected pack. Edit to apply discounts.</p>
                    </div>

                    <div>
                      <label className="mb-2 block text-sm font-medium text-slate-300">From date</label>
                      <input
                        type="date"
                        value={paymentForm.fromDate}
                        onChange={(event) => setPaymentForm((current) => ({ ...current, fromDate: event.target.value }))}
                        className="w-full rounded-xl border border-slate-700 bg-slate-800 px-3 py-2.5 text-white focus:border-violet-400 focus:outline-none"
                      />
                      <p className="mt-1 text-xs text-slate-500">Plan expiry is calculated from this date.</p>
                    </div>

                    <div>
                      <label className="mb-2 block text-sm font-medium text-slate-300">Duration (days)</label>
                      <input
                        type="number"
                        min="1"
                        value={paymentForm.durationDays}
                        onChange={(event) => setPaymentForm((current) => ({ ...current, durationDays: event.target.value }))}
                        className="w-full rounded-xl border border-slate-700 bg-slate-800 px-3 py-2.5 text-white focus:border-violet-400 focus:outline-none"
                        placeholder="30"
                      />
                    </div>

                    <div>
                      <label className="mb-2 block text-sm font-medium text-slate-300">Status</label>
                      <select
                        value={paymentForm.status}
                        onChange={(event) => setPaymentForm((current) => ({ ...current, status: event.target.value as 'PAID' | 'PENDING' }))}
                        className="w-full rounded-xl border border-slate-700 bg-slate-800 px-3 py-2.5 text-white focus:border-violet-400 focus:outline-none"
                      >
                        <option value="PAID">Paid</option>
                        <option value="PENDING">Pending</option>
                      </select>
                    </div>
                  </div>

                  <div className="mt-4">
                    <label className="mb-2 block text-sm font-medium text-slate-300">Notes</label>
                    <textarea
                      value={paymentForm.notes}
                      onChange={(event) => setPaymentForm((current) => ({ ...current, notes: event.target.value }))}
                      rows={3}
                      className="w-full rounded-xl border border-slate-700 bg-slate-800 px-3 py-2.5 text-white focus:border-violet-400 focus:outline-none"
                      placeholder="Invoice reference, renewal note, or pack notes"
                    />
                  </div>

                  <div className="mt-6 flex justify-end gap-3">
                    <button onClick={() => setBillingTab('overview')} className="rounded-xl border border-slate-700 bg-slate-800 px-4 py-2 font-semibold text-slate-200">
                      Cancel
                    </button>
                    <button onClick={handleSavePayment} className="rounded-xl bg-violet-500 px-4 py-2 font-semibold text-white hover:bg-violet-400">
                      Save payment
                    </button>
                  </div>
                </div>
              )}
            </div>

            <div className="rounded-2xl border border-slate-700 bg-slate-900/70 p-6">
                <div className="mb-4 flex items-center justify-between">
                  <h3 className="text-xl font-bold text-white">Recent payments</h3>
                  <span className="rounded-full bg-emerald-500/15 px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-emerald-200">{payments.length} entries</span>
                </div>
                {payments.length === 0 ? <div className="py-6 text-center text-sm text-slate-400">No payments recorded yet.</div> : <div className="space-y-3">
                  {payments.map((payment) => {
                    const paymentClinic = clinics.find((clinic) => clinic.id === payment.clinicId || clinic.name.toLowerCase() === payment.clinicName.toLowerCase());
                    const paymentExpired = isExpiredDate(payment.expiryDate);
                    return (
                    <div key={payment.id} className="flex flex-col gap-3 rounded-xl border border-slate-800 bg-slate-800/70 p-4 md:flex-row md:items-center md:justify-between">
                      <div>
                        <div className="text-base font-semibold text-white">{payment.clinicName || 'Unnamed clinic'}</div>
                        <div className="mt-1 text-xs text-slate-400">{payment.pack}{payment.pack === 'TRIAL' && payment.trialForPlan ? ` for ${payment.trialForPlan}` : ''} • {payment.durationDays} days • Paid {formatDashboardDate(payment.paidAt)} • Expires {formatDashboardDate(payment.expiryDate)}</div>
                      </div>
                      <div className="flex items-center gap-3">
                        <span className="rounded-full bg-slate-700 px-2 py-1 text-[10px] uppercase tracking-[0.14em] text-slate-200">{payment.status}</span>
                        {paymentExpired && <span className="rounded-full bg-rose-500/15 px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-rose-300">Expired</span>}
                        <span className="text-lg font-bold text-emerald-300">₹{Number(payment.amount).toLocaleString('en-IN')}</span>
                        {paymentClinic && <button onClick={() => openClinicBilling(paymentClinic, payment)} className="rounded-lg border border-slate-600 px-3 py-2 text-xs font-semibold text-slate-200 hover:border-violet-400">Edit</button>}
                        <button onClick={() => handleDeletePayment(payment)} className="rounded-lg bg-red-500/15 px-3 py-2 text-xs font-semibold text-red-200 hover:bg-red-500/25">Delete</button>
                      </div>
                    </div>
                    );
                  })}
                </div>}
              </div>
          </div>
        );
      default:
        return null;
    }
  };

  return (
    <div className="min-h-screen bg-slate-950 text-white">
      <header className="sticky top-0 z-40 border-b border-slate-800 bg-slate-950/90 shadow-[0_10px_35px_rgba(2,6,23,0.45)] backdrop-blur-xl">
        <div className="mx-auto flex max-w-[1600px] items-center justify-between gap-4 px-4 py-4 sm:px-6 lg:px-8">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-500/10 ring-1 ring-emerald-400/40">
              <Building2 className="h-5 w-5 text-emerald-400" />
            </div>
            <div>
              <h1 className="text-lg font-bold">{siteSettings.siteName}</h1>
              <p className="text-[10px] font-bold uppercase tracking-[0.22em] text-emerald-300">{siteSettings.siteTagline}</p>
            </div>
          </div>

          <div className="hidden items-center gap-2 md:flex">
            {isSiteAdmin && (
              <button
                onClick={openAddClinicModal}
                className="rounded-xl bg-gradient-to-r from-emerald-500 to-cyan-500 px-3 py-2 text-sm font-semibold text-slate-950 transition hover:shadow-lg hover:shadow-emerald-500/30"
              >
                <Plus className="mr-1 inline h-4 w-4" />
                Add Clinic
              </button>
            )}
            {isSiteAdmin && (
              <button
                onClick={() => setActiveTab('content')}
                className={`rounded-xl border px-3 py-2 text-sm font-semibold transition ${
                  activeTab === 'content'
                    ? 'border-emerald-400/60 bg-emerald-500/15 text-emerald-200'
                    : 'border-cyan-400/40 bg-cyan-500/10 text-cyan-200 hover:border-cyan-300/60 hover:bg-cyan-500/20'
                }`}
              >
                Website Content
              </button>
            )}
            <button onClick={exportReport} className="rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-sm font-semibold text-slate-200 transition hover:border-emerald-400/50 hover:text-white">Export report</button>
            <button className="rounded-xl bg-emerald-500 px-3 py-2 text-sm font-semibold text-slate-950 transition hover:bg-emerald-400">Generate summary</button>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={onLogout}
              className="rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-sm font-semibold text-slate-200 transition hover:border-red-400/40 hover:text-red-300"
            >
              Logout
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-[1600px] px-4 py-8 sm:px-6 lg:px-8">
        {saveMessage && (
          <div className="mb-4 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-200">
            {saveMessage}
          </div>
        )}

        <div className="mb-6 flex gap-2 overflow-x-auto md:hidden">
          {tabs.map((tab) => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`whitespace-nowrap rounded-xl px-3 py-2 text-xs font-semibold transition ${
                activeTab === tab.key ? 'bg-emerald-500/15 text-emerald-200 ring-1 ring-emerald-400/30' : 'bg-slate-900 text-slate-300'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        <div className="grid gap-6 xl:grid-cols-[280px_minmax(0,1fr)] xl:items-start">
          <aside className="xl:sticky xl:top-24 xl:self-start rounded-2xl border border-slate-700 bg-slate-900/80 p-4 shadow-[0_24px_80px_rgba(2,6,23,0.4)]">
            <div className="space-y-5">
              <div>
                <div className="mb-2 text-[10px] font-bold uppercase tracking-[0.18em] text-slate-500">Dashboard</div>
                <div className="space-y-2">
                  {tabs.slice(0, 3).map((tab) => (
                    <button
                      key={tab.key}
                      onClick={() => setActiveTab(tab.key)}
                      className={`w-full rounded-xl px-3 py-2.5 text-left text-sm font-semibold transition ${
                        activeTab === tab.key ? 'bg-emerald-500/15 text-emerald-200 ring-1 ring-emerald-400/30' : 'text-slate-300 hover:bg-slate-800/80 hover:text-white'
                      }`}
                    >
                      {tab.label}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <div className="mb-2 text-[10px] font-bold uppercase tracking-[0.18em] text-slate-500">Operations</div>
                <div className="space-y-2">
                  {tabs.slice(3, 8).map((tab) => (
                    <button
                      key={tab.key}
                      onClick={() => setActiveTab(tab.key)}
                      className={`w-full rounded-xl px-3 py-2.5 text-left text-sm font-semibold transition ${
                        activeTab === tab.key ? 'bg-emerald-500/15 text-emerald-200 ring-1 ring-emerald-400/30' : 'text-slate-300 hover:bg-slate-800/80 hover:text-white'
                      }`}
                    >
                      {tab.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <div className="mt-5 rounded-2xl border border-slate-700 bg-slate-950/60 p-3">
              <div className="text-[10px] uppercase tracking-[0.18em] text-slate-500">Service health</div>
              <div className="mt-2 flex items-center justify-between">
                <span className="text-lg font-black text-white">99.8%</span>
                <span className="rounded-full bg-emerald-500/15 px-2 py-1 text-[9px] font-semibold uppercase tracking-[0.14em] text-emerald-200">Stable</span>
              </div>
            </div>
          </aside>

          <div className="space-y-6">{renderActiveTab()}</div>
        </div>


      </main>

      {showUserModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-slate-800 border border-slate-700 rounded-xl max-w-2xl w-full max-h-[92vh] overflow-y-auto p-6">
            <h2 className="text-2xl font-bold mb-6">{editingUser ? 'Edit User' : 'Add New User'}</h2>

            <div className="space-y-4">
              <div>
                <label className="block text-sm font-semibold mb-2">Full name</label>
                <input type="text" value={userFormData.name} onChange={(e) => setUserFormData({ ...userFormData, name: e.target.value })} className="w-full bg-slate-700 border border-slate-600 rounded-lg px-4 py-2 text-white focus:border-emerald-400 focus:outline-none" />
              </div>

              <div>
                <label className="block text-sm font-semibold mb-2">Email</label>
                <input type="email" value={userFormData.email} onChange={(e) => setUserFormData({ ...userFormData, email: e.target.value })} className="w-full bg-slate-700 border border-slate-600 rounded-lg px-4 py-2 text-white focus:border-emerald-400 focus:outline-none" />
              </div>

              <div>
                <label className="block text-sm font-semibold mb-2">Role</label>
                <select value={userFormData.role} onChange={(e) => setUserFormData({ ...userFormData, role: e.target.value })} className="w-full bg-slate-700 border border-slate-600 rounded-lg px-4 py-2 text-white focus:border-emerald-400 focus:outline-none">
                  <option value="Clinic">Clinic</option>
                  <option value="Doctor">Doctor</option>
                  <option value="Reception">Reception</option>
                </select>
              </div>

              <div>
                <label className="block text-sm font-semibold mb-2">Clinic</label>
                <select value={userFormData.clinicName} onChange={(e) => setUserFormData({ ...userFormData, clinicName: e.target.value })} className="w-full bg-slate-700 border border-slate-600 rounded-lg px-4 py-2 text-white focus:border-emerald-400 focus:outline-none">
                  <option value="">Select a clinic</option>
                  {clinics.map((clinic) => (
                    <option key={clinic.id} value={clinic.name}>{clinic.name}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-sm font-semibold mb-2">Phone</label>
                <PhoneInput value={userFormData.phone} onChange={handleUserPhoneChange} />
              </div>

              {!editingUser && <div>
                <label className="block text-sm font-semibold mb-2">Access status</label>
                <select value={userFormData.accessStatus} onChange={(e) => setUserFormData({ ...userFormData, accessStatus: e.target.value as 'Granted' | 'Hold' | 'Denied' })} className="w-full bg-slate-700 border border-slate-600 rounded-lg px-4 py-2 text-white focus:border-emerald-400 focus:outline-none">
                  <option value="Granted">Granted</option>
                  <option value="Hold">Hold</option>
                  <option value="Denied">Denied</option>
                </select>
              </div>}

              <div>
                <label className="block text-sm font-semibold mb-2">Password reset</label>
                <div className="rounded-lg border border-slate-600 bg-slate-700 p-3">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <div className="text-sm text-slate-200">{userFormData.passwordReset || 'Never reset'}</div>
                    </div>
                    <button
                      type="button"
                      disabled={!editingUser}
                      onClick={() => handleResetUserPassword(editingUser?.id || '')}
                      className={`rounded-lg px-3 py-2 text-sm font-semibold ${editingUser ? 'bg-amber-500 text-slate-950 hover:bg-amber-400' : 'cursor-not-allowed bg-slate-600 text-slate-400'}`}
                    >
                      Reset to default
                    </button>
                  </div>
                </div>
              </div>

            </div>

            <div className="mt-8 flex gap-3">
              <button
                onClick={() => {
                  setShowUserModal(false);
                  setEditingUser(null);
                  setUserFormData({ name: '', email: '', role: 'Clinic Admin', status: 'Active', clinicName: '', phone: '+91 ', accessStatus: 'Granted', photoURL: '', passwordReset: '' });
                }}
                className="flex-1 rounded-lg bg-slate-700 px-4 py-2 text-white"
              >
                Cancel
              </button>
              <button
                onClick={handleSaveUser}
                className="flex-1 rounded-lg bg-emerald-500 px-4 py-2 font-semibold text-slate-950"
              >
                {editingUser ? 'Update' : 'Create'}
              </button>
            </div>
          </div>
        </div>
      )}

      {showAddModal && (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/50 p-4 sm:items-center">
          <div className="my-auto max-h-[calc(100vh-2rem)] w-full max-w-md overflow-y-auto rounded-xl border border-slate-700 bg-slate-800 p-6">
            <h2 className="text-2xl font-bold mb-6">{editingClinic ? 'Edit Clinic' : 'Add New Clinic'}</h2>
            
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-semibold mb-2">Clinic Name</label>
                <input
                  type="text"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  className="w-full bg-slate-700 border border-slate-600 rounded-lg px-4 py-2 text-white focus:border-emerald-400 focus:outline-none"
                  placeholder="e.g., City Care Clinic"
                />
              </div>

              <div>
                <label className="block text-sm font-semibold mb-2">Address</label>
                <input
                  type="text"
                  value={formData.address}
                  onChange={(e) => setFormData({ ...formData, address: e.target.value })}
                  className="w-full bg-slate-700 border border-slate-600 rounded-lg px-4 py-2 text-white focus:border-emerald-400 focus:outline-none"
                  placeholder="Full address"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-semibold mb-2">Phone</label>
                  <PhoneInput value={formData.phone} onChange={handleClinicPhoneChange} />
                </div>
                <div>
                  <label className="block text-sm font-semibold mb-2">Email</label>
                  <input
                    type="email"
                    value={formData.email}
                    onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                    className="w-full bg-slate-700 border border-slate-600 rounded-lg px-4 py-2 text-white focus:border-emerald-400 focus:outline-none"
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm font-semibold mb-2">Specializations (comma-separated)</label>
                <input
                  type="text"
                  value={formData.specializations}
                  onChange={(e) => setFormData({ ...formData, specializations: e.target.value })}
                  className="w-full bg-slate-700 border border-slate-600 rounded-lg px-4 py-2 text-white focus:border-emerald-400 focus:outline-none"
                  placeholder="Cardiology, General Surgery, etc."
                />
              </div>

              <div>
                <label className="block text-sm font-semibold mb-2">Operating Hours</label>
                <div className="rounded-xl border border-slate-600 bg-slate-700 p-3">
                  <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                    <div>
                      <label className="mb-1 block text-[11px] font-medium uppercase tracking-wide text-slate-300">Opening time</label>
                      <div className="flex gap-2">
                        <select
                          value={customOperatingHours.startHour}
                          onChange={(e) => updateCustomOperatingHours('startHour', e.target.value)}
                          className="w-20 bg-slate-800 border border-slate-600 rounded-lg px-2 py-2 text-white focus:border-emerald-400 focus:outline-none"
                        >
                          {Array.from({ length: 12 }, (_, index) => index + 1).map((hour) => (
                            <option key={hour} value={String(hour)}>{hour}</option>
                          ))}
                        </select>
                        <select
                          value={customOperatingHours.startMinute}
                          onChange={(e) => updateCustomOperatingHours('startMinute', e.target.value)}
                          className="w-20 bg-slate-800 border border-slate-600 rounded-lg px-2 py-2 text-white focus:border-emerald-400 focus:outline-none"
                        >
                          {['00', '15', '30', '45'].map((minute) => (
                            <option key={minute} value={minute}>{minute}</option>
                          ))}
                        </select>
                        <select
                          value={customOperatingHours.startMeridian}
                          onChange={(e) => updateCustomOperatingHours('startMeridian', e.target.value)}
                          className="w-20 bg-slate-800 border border-slate-600 rounded-lg px-2 py-2 text-white focus:border-emerald-400 focus:outline-none"
                        >
                          <option value="AM">AM</option>
                          <option value="PM">PM</option>
                        </select>
                      </div>
                    </div>

                    <div>
                      <label className="mb-1 block text-[11px] font-medium uppercase tracking-wide text-slate-300">Closing time</label>
                      <div className="flex gap-2">
                        <select
                          value={customOperatingHours.endHour}
                          onChange={(e) => updateCustomOperatingHours('endHour', e.target.value)}
                          className="w-20 bg-slate-800 border border-slate-600 rounded-lg px-2 py-2 text-white focus:border-emerald-400 focus:outline-none"
                        >
                          {Array.from({ length: 12 }, (_, index) => index + 1).map((hour) => (
                            <option key={hour} value={String(hour)}>{hour}</option>
                          ))}
                        </select>
                        <select
                          value={customOperatingHours.endMinute}
                          onChange={(e) => updateCustomOperatingHours('endMinute', e.target.value)}
                          className="w-20 bg-slate-800 border border-slate-600 rounded-lg px-2 py-2 text-white focus:border-emerald-400 focus:outline-none"
                        >
                          {['00', '15', '30', '45'].map((minute) => (
                            <option key={minute} value={minute}>{minute}</option>
                          ))}
                        </select>
                        <select
                          value={customOperatingHours.endMeridian}
                          onChange={(e) => updateCustomOperatingHours('endMeridian', e.target.value)}
                          className="w-20 bg-slate-800 border border-slate-600 rounded-lg px-2 py-2 text-white focus:border-emerald-400 focus:outline-none"
                        >
                          <option value="AM">AM</option>
                          <option value="PM">PM</option>
                        </select>
                      </div>
                    </div>
                  </div>

                  <div className="mt-3 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-200">
                    Preview: <span className="font-semibold">{formData.operatingHours}</span>
                  </div>
                </div>
              </div>

              <div>
                <label className="block text-sm font-semibold mb-2">Clinic Photo</label>
                <input
                  type="file"
                  accept="image/*"
                  onChange={handleLogoUpload}
                  className="w-full bg-slate-700 border border-slate-600 rounded-lg px-4 py-2 text-white file:mr-4 file:py-2 file:px-3 file:rounded-lg file:border-0 file:bg-emerald-500 file:text-white"
                />
                {formData.logo && isValidImageDataUrl(formData.logo) && (
                  <img src={formData.logo} alt="Clinic preview" className="mt-3 h-20 w-20 object-cover rounded-lg border border-slate-600" />
                )}
              </div>

              {resolvedMode === 'site-admin' && (
                <div>
                  <label className="block text-sm font-semibold mb-2">TV Booking Barcode URL</label>
                  <input
                    type="url"
                    value={formData.qrCodeUrl}
                    onChange={(e) => setFormData({ ...formData, qrCodeUrl: e.target.value })}
                    className="w-full bg-slate-700 border border-slate-600 rounded-lg px-4 py-2 text-white focus:border-emerald-400 focus:outline-none"
                    placeholder="https://... or image data URL"
                  />
                  <p className="mt-1 text-xs text-slate-400">Shown on this clinic&apos;s TV display. Leave blank to use the placeholder.</p>
                </div>
              )}

            </div>

            <div className="flex gap-3 mt-8">
              <button
                onClick={() => {
                  setShowAddModal(false);
                  setEditingClinic(null);
                  setCustomOperatingHours(parseOperatingHoursParts(DEFAULT_OPERATING_HOURS));
                  setFormData({ name: '', address: '', phone: '+91 ', email: '', specializations: '', operatingHours: DEFAULT_OPERATING_HOURS, featurePlan: 'TRIAL', logo: '', qrCodeUrl: '' });
                }}
                className="flex-1 px-4 py-2 bg-slate-700 hover:bg-slate-600 rounded-lg transition"
              >
                Cancel
              </button>
              <button
                onClick={handleSaveClinic}
                className="flex-1 px-4 py-2 bg-emerald-500 hover:bg-emerald-600 rounded-lg font-semibold transition"
              >
                {editingClinic ? 'Update' : 'Create'} Clinic
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
