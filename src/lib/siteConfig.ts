import { useEffect, useState } from 'react';

export interface SiteSettings {
  siteName: string;
  siteTagline: string;
  contactEmail: string;
  contactPhone: string;
  whatsappNumber: string;
  whatsappMessage: string;
  supportAddress: string;
  facebookUrl: string;
  instagramUrl: string;
  linkedinUrl: string;
  xUrl: string;
  youtubeUrl: string;
  freeTrialFormUrl: string;
  salesFormUrl: string;
  heroTitle: string;
  heroSubtitle: string;
  whatsappEnabled: boolean;
  verificationKey: string;
  accessMode: string;
  clinicAccessLabel: string;
}

export interface ContentSections {
  heroTitle: string;
  heroSubtitle: string;
  whatWeProvideTitle: string;
  whyChooseTitle: string;
  benefitsTitle: string;
  contactTitle: string;
  footerText: string;
}

export const defaultSiteSettings: SiteSettings = {
  siteName: 'NEXTQ',
  siteTagline: 'Smart Queue. Less Waiting.',
  contactEmail: 'www.nextq.in@gmail.com',
  contactPhone: '9953-270-270',
  whatsappNumber: '9953-270-270',
  whatsappMessage: 'Hi NEXTQ, I would like to know more about your clinic queue and appointment management solution.',
  supportAddress: 'Sec 168, Noida',
  facebookUrl: 'https://www.facebook.com/nextq',
  instagramUrl: 'https://www.instagram.com/nextq',
  linkedinUrl: 'https://www.linkedin.com/company/nextq',
  xUrl: 'https://x.com/nextq',
  youtubeUrl: 'https://www.youtube.com/@nextq',
  freeTrialFormUrl: '',
  salesFormUrl: 'https://forms.gle/SYsvjdE7sjzyiwd99',
  heroTitle: 'Smart Queue. Less Waiting.',
  heroSubtitle: 'Book your consultation without an app, track your live token, and arrive closer to your turn.',
  whatsappEnabled: true,
  verificationKey: 'NEXTQ-2026',
  accessMode: 'restricted',
  clinicAccessLabel: 'Approved clinic access only',
};

export const defaultContentSections: ContentSections = {
  heroTitle: 'Smart Queue. Less Waiting.',
  heroSubtitle: 'Book your consultation without an app, track your live token, and arrive closer to your turn.',
  whatWeProvideTitle: 'Digital Appointment & Live Queue Management',
  whyChooseTitle: 'Built for smarter clinic operations.',
  benefitsTitle: 'What you gain with NEXTQ.',
  contactTitle: 'Let’s make clinic queues feel effortless.',
  footerText: 'NEXTQ — Smart, App-Free Queue Management for Modern Clinics.',
};

const SETTINGS_KEY = 'nextq-site-settings';
const CONTENT_KEY = 'nextq-site-content';
let siteConfigSyncPromise: Promise<{ settings: SiteSettings; content: ContentSections }> | null = null;

function parseStoredValue(value: unknown): unknown {
  if (typeof value !== 'string') return value;

  const trimmed = value.trim();
  if (trimmed === 'true') return true;
  if (trimmed === 'false') return false;

  if (trimmed === '' || trimmed === 'null') return null;

  try {
    const parsed = JSON.parse(trimmed);
    return parsed;
  } catch {
    return value;
  }
}

function normalizeDbKey(key: string): string {
  const cleaned = key.trim();
  if (!cleaned) return cleaned;

  const camel = cleaned
    .replace(/_([a-z])/g, (_, letter: string) => letter.toUpperCase())
    .replace(/-([a-z])/g, (_, letter: string) => letter.toUpperCase());

  return camel;
}

function normalizeRecord(data: Record<string, any>): Record<string, any> {
  return Object.fromEntries(
    Object.entries(data).map(([key, value]) => [normalizeDbKey(key), parseStoredValue(value)])
  );
}

function normaliseSiteSettings(data: Partial<SiteSettings> = {}): SiteSettings {
  const parsed = normalizeRecord(data as Record<string, any>);
  return {
    ...defaultSiteSettings,
    ...parsed,
    whatsappEnabled: parsed.whatsappEnabled === undefined ? defaultSiteSettings.whatsappEnabled : Boolean(parsed.whatsappEnabled),
  };
}

function normaliseContentSections(data: Partial<ContentSections> = {}): ContentSections {
  return {
    ...defaultContentSections,
    ...normalizeRecord(data as Record<string, any>),
  };
}

// Load from localStorage (immediate)
export function loadSiteSettings(): SiteSettings {
  if (typeof window === 'undefined') return defaultSiteSettings;
  const raw = window.localStorage.getItem(SETTINGS_KEY);
  if (!raw) return defaultSiteSettings;
  try {
    return normaliseSiteSettings(JSON.parse(raw));
  } catch {
    return defaultSiteSettings;
  }
}

export function loadContentSections(): ContentSections {
  if (typeof window === 'undefined') return defaultContentSections;
  const raw = window.localStorage.getItem(CONTENT_KEY);
  if (!raw) return defaultContentSections;
  try {
    return normaliseContentSections(JSON.parse(raw));
  } catch {
    return defaultContentSections;
  }
}

export async function saveSiteSettings(settings: SiteSettings) {
  siteConfigSyncPromise = null;
  saveToLocalStorage(SETTINGS_KEY, settings);
  await saveToDatabase('site/settings', settings);
}

export async function saveContentSections(sections: ContentSections) {
  siteConfigSyncPromise = null;
  saveToLocalStorage(CONTENT_KEY, sections);
  await saveToDatabase('site/content', sections);
}

// Save to localStorage (immediate UI update)
function saveToLocalStorage(key: string, data: any) {
  if (typeof window !== 'undefined') {
    window.localStorage.setItem(key, JSON.stringify(data));
    window.dispatchEvent(new Event('site-config-changed'));
  }
}

// Save to database (persistent across devices)
async function saveToDatabase(path: string, data: any) {
  try {
    const endpoint = path === 'site/settings' ? '/api/site/settings' : '/api/site/content';
    const response = await fetch(endpoint, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    if (!response.ok) {
      throw new Error(`Failed to save to database: ${response.status}`);
    }
  } catch (error) {
    console.error('Failed to save to database:', error);
  }
}

// Load from database (for cross-device sync)
export async function loadSiteSettingsFromDatabase(): Promise<SiteSettings> {
  try {
    const response = await fetch('/api/site/settings', {
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
    });
    if (response.ok) {
      const data = await response.json();
      return normaliseSiteSettings(data);
    }
  } catch (error) {
    console.error('Failed to load site settings from database:', error);
  }
  return defaultSiteSettings;
}

export async function loadContentSectionsFromDatabase(): Promise<ContentSections> {
  try {
    const response = await fetch('/api/site/content', {
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
    });
    if (response.ok) {
      const data = await response.json();
      return normaliseContentSections(data);
    }
  } catch (error) {
    console.error('Failed to load content sections from database:', error);
  }
  return defaultContentSections;
}

// Initialize site config from database on app startup
export async function initializeSiteConfig(): Promise<{ settings: SiteSettings; content: ContentSections }> {
  if (!siteConfigSyncPromise) {
    siteConfigSyncPromise = Promise.all([
      loadSiteSettingsFromDatabase(),
      loadContentSectionsFromDatabase(),
    ]).then(([settings, content]) => {
      // Also save to localStorage for immediate access
      saveToLocalStorage(SETTINGS_KEY, settings);
      saveToLocalStorage(CONTENT_KEY, content);

      return { settings, content };
    });
  }

  return siteConfigSyncPromise;
}

export function useSiteConfig() {
  const [settings, setSettings] = useState<SiteSettings>(loadSiteSettings);
  const [content, setContent] = useState<ContentSections>(loadContentSections);

  useEffect(() => {
    let isMounted = true;

    const syncConfig = () => {
      const nextSettings = loadSiteSettings();
      const nextContent = loadContentSections();
      setSettings(nextSettings);
      setContent(nextContent);
    };

    const syncFromDatabase = async () => {
      try {
        const { settings: nextSettings, content: nextContent } = await initializeSiteConfig();
        if (isMounted) {
          setSettings(nextSettings);
          setContent(nextContent);
        }
      } catch (error) {
        console.error('Failed to sync site config from database:', error);
      }
    };

    syncConfig();
    void syncFromDatabase();
    window.addEventListener('site-config-changed', syncConfig);

    return () => {
      isMounted = false;
      window.removeEventListener('site-config-changed', syncConfig);
    };
  }, []);

  return { settings, content };
}
