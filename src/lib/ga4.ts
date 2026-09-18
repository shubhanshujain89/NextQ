declare global {
  interface Window {
    dataLayer?: unknown[];
    gtag?: (...args: unknown[]) => void;
  }
}

const env = ((import.meta as unknown) as { env?: Record<string, string | undefined> }).env ?? {};

export const GA4_REDACTION_SETTINGS: {
  enabled: boolean;
  noUserId: boolean;
  sendPageViews: boolean;
  allowGoogleSignals: boolean;
  allowAdPersonalizationSignals: boolean;
  anonymizeIp: boolean;
  debug: boolean;
  measurementId: string;
  allowedPublicRoutes: string[];
  forbiddenKeys: string[];
  allowedEventNames: string[];
} = {
  enabled: true,
  noUserId: true,
  sendPageViews: false,
  allowGoogleSignals: false,
  allowAdPersonalizationSignals: false,
  anonymizeIp: true,
  debug: env.VITE_GA4_DEBUG === 'true',
  measurementId: env.VITE_GA_MEASUREMENT_ID || 'G-GNP5Y7DSCM',
  allowedPublicRoutes: ['/', '/what-we-provide', '/how-it-works', '/why-choose-us', '/benefits', '/contact'],
  forbiddenKeys: ['phone', 'email', 'name', 'token', 'tracking', 'appointment', 'queue', 'clinic', 'patient', 'login', 'form', 'value', 'doctor', 'staff', 'user', 'id'],
  allowedEventNames: ['whatsapp_click', 'demo_click', 'contact_click', 'cta_click'],
};

const ensureDataLayer = () => {
  if (typeof window === 'undefined') return;
  if (!window.dataLayer) {
    window.dataLayer = [];
  }

  if (!window.gtag) {
    window.gtag = function gtag() {
      window.dataLayer?.push(arguments);
    };
  }
};

export const isApprovedPublicRoute = (pathname: string) => {
  if (!pathname) return false;
  return GA4_REDACTION_SETTINGS.allowedPublicRoutes.includes(pathname);
};

export const sanitizeGa4EventData = <T extends Record<string, unknown>>(payload: T = {} as T): T => {
  const result: Record<string, unknown> = {};

  Object.entries(payload).forEach(([key, value]) => {
    const normalizedKey = key.toLowerCase();
    const isBlocked = GA4_REDACTION_SETTINGS.forbiddenKeys.some((blockedKey) => normalizedKey.includes(blockedKey));

    if (isBlocked) {
      return;
    }

    if (typeof value === 'string' && value.trim() === '') {
      return;
    }

    result[key] = value;
  });

  return result as T;
};

const loadGa4Script = () => {
  if (typeof window === 'undefined') return false;
  if (!GA4_REDACTION_SETTINGS.measurementId) return false;
  if (!isApprovedPublicRoute(window.location.pathname)) return false;

  ensureDataLayer();

  if (document.getElementById('ga4-script')) return true;

  const script = document.createElement('script');
  script.id = 'ga4-script';
  script.async = true;
  script.src = `https://www.googletagmanager.com/gtag/js?id=${GA4_REDACTION_SETTINGS.measurementId}`;
  script.setAttribute('data-ga4-redacted', 'true');
  document.head.appendChild(script);

  window.gtag?.('js', new Date());
  window.gtag?.('config', GA4_REDACTION_SETTINGS.measurementId, {
    send_page_view: false,
    anonymize_ip: true,
    allow_google_signals: false,
    allow_ad_personalization_signals: false,
  });

  return true;
};

export const disableGa4 = () => {
  if (typeof window === 'undefined') return;

  const script = document.getElementById('ga4-script');
  if (script) script.remove();

  window.dataLayer = [];
  window.gtag = undefined;
};

export const syncGa4ForRoute = (pathname: string) => {
  if (typeof window === 'undefined') return false;

  if (!isApprovedPublicRoute(pathname) || !GA4_REDACTION_SETTINGS.measurementId) {
    disableGa4();
    return false;
  }

  return loadGa4Script();
};

export const trackGa4PageView = (pathname: string) => {
  if (typeof window === 'undefined') return;
  if (!GA4_REDACTION_SETTINGS.enabled || !GA4_REDACTION_SETTINGS.sendPageViews) return;
  if (!GA4_REDACTION_SETTINGS.measurementId || !isApprovedPublicRoute(pathname)) return;

  ensureDataLayer();
  loadGa4Script();

  const sanitized = sanitizeGa4EventData({
    page_location: window.location.href,
    page_path: pathname,
    page_title: document.title || 'NEXTQ',
  });

  window.gtag?.('event', 'page_view', sanitized);
};

export const trackGa4Event = (eventName: string, payload: Record<string, unknown> = {}) => {
  if (typeof window === 'undefined') return;
  if (!GA4_REDACTION_SETTINGS.enabled || !GA4_REDACTION_SETTINGS.measurementId) return;
  if (!isApprovedPublicRoute(window.location.pathname)) return;
  if (!GA4_REDACTION_SETTINGS.allowedEventNames.includes(eventName)) return;

  ensureDataLayer();
  loadGa4Script();

  const sanitized = sanitizeGa4EventData({
    page_location: window.location.href,
    page_path: window.location.pathname,
    ...payload,
  });

  window.gtag?.('event', eventName, sanitized);
};
