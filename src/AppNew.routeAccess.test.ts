import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolveAppPageForRoute } from './AppNew';
import { buildTrackingHref } from './lib/trackingLink';
import { buildJsonLd, getRouteMetadata, isNoIndexRoute } from './lib/seo';
import { auth, onAuthStateChanged } from './lib/firebase';
import { canAccessRecord, canMutateGenericRecord, prepareDatabaseMutation } from '../server/auth/authorization';

test('site admin route is blocked for clinic admins', () => {
  assert.equal(resolveAppPageForRoute('/site/admin', 'CLINIC_ADMIN'), 'clinic-admin');
});

test('site admin route is allowed for super admins', () => {
  assert.equal(resolveAppPageForRoute('/site/admin', 'SUPER_ADMIN'), 'site-admin');
});

test('site admin route opens the dedicated admin login when unauthenticated', () => {
  assert.equal(resolveAppPageForRoute('/site/admin', null), 'site-admin');
});

test('staff queue route stays outside the admin route', () => {
  assert.equal(resolveAppPageForRoute('/site/queue', 'STAFF'), 'clinic-queue');
  assert.equal(resolveAppPageForRoute('/site/queue', 'DOCTOR'), 'clinic-queue');
});

test('site login route opens the login page', () => {
  assert.equal(resolveAppPageForRoute('/site/login', null), 'login');
});

test('login route stays on the login page when no authenticated user is present', () => {
  assert.equal(resolveAppPageForRoute('/login', null), 'login');
});

test('login route redirects a logged-in clinic admin to the dashboard', () => {
  assert.equal(resolveAppPageForRoute('/login', 'CLINIC_ADMIN'), 'clinic-admin');
  assert.equal(resolveAppPageForRoute('/login', 'SUPER_ADMIN'), 'site-admin');
});

test('landing page and contact copy remove the defunct app-download stat and unsupported 24/7 wording', () => {
  const landingPageSource = readFileSync(new URL('./pages/LandingPage.tsx', import.meta.url), 'utf8');
  const contactPageSource = readFileSync(new URL('./pages/ContactPage.tsx', import.meta.url), 'utf8');

  assert.ok(!landingPageSource.includes('0</strong><small>App downloads</small>'));
  assert.ok(!contactPageSource.includes('24/7'));
});

test('how it works route opens a dedicated public page', () => {
  assert.equal(resolveAppPageForRoute('/how-it-works', null), 'how-it-works');
});

test('booking and tracking pages have public SEO metadata coverage', () => {
  const routeMetadata = new URL('./lib/seo.ts', import.meta.url);
  const seoSource = readFileSync(routeMetadata, 'utf8');

  assert.ok(seoSource.includes("'/booking':"));
  assert.ok(seoSource.includes("'/track':"));
  assert.ok(seoSource.includes("'/login':"));
  assert.ok(seoSource.includes("robots: 'noindex,follow'"));
  assert.ok(!seoSource.includes("SearchAction"));
  assert.equal(getRouteMetadata('/booking').robots, 'noindex,follow');
  assert.equal(getRouteMetadata('/track').robots, 'noindex,follow');
  assert.equal(getRouteMetadata('/login').robots, 'noindex,follow');
  assert.equal(getRouteMetadata('/track/123').robots, 'noindex,follow');
  assert.equal(getRouteMetadata('/site/admin').robots, 'noindex,follow');
  assert.equal(isNoIndexRoute('/site/admin'), true);
});

test('software application schema uses a supported category without an unverified free price', () => {
  const schema = buildJsonLd('/') as { '@graph': Array<Record<string, unknown>> };
  const softwareApplication = schema['@graph'].find((entry) => entry['@type'] === 'SoftwareApplication');

  assert.equal(softwareApplication?.applicationCategory, 'HealthApplication');
  assert.equal('offers' in (softwareApplication || {}), false);
});

test('organization schema does not advertise unverified social profiles', () => {
  const schema = buildJsonLd('/') as { '@graph': Array<Record<string, unknown>> };
  const organization = schema['@graph'].find((entry) => entry['@type'] === 'Organization');

  assert.equal('sameAs' in (organization || {}), false);
});

test('auth transitions keep clinic-admin users on the protected dashboard route', () => {
  assert.equal(resolveAppPageForRoute('/login', 'CLINIC_ADMIN'), 'clinic-admin');
  assert.equal(resolveAppPageForRoute('/site/login', 'CLINIC_ADMIN'), 'clinic-admin');
  assert.equal(resolveAppPageForRoute('/site/admin', 'CLINIC_ADMIN'), 'clinic-admin');
});

test('contact page WhatsApp link carries a configurable prefilled message that mirrors the settings model', () => {
  const siteConfigSource = readFileSync(new URL('./lib/siteConfig.ts', import.meta.url), 'utf8');
  const contactPageSource = readFileSync(new URL('./pages/ContactPage.tsx', import.meta.url), 'utf8');

  assert.ok(siteConfigSource.includes('whatsappMessage:'));
  assert.ok(contactPageSource.includes('encodeURIComponent(settings.whatsappMessage'));
});

test('how it works page explains the patient queue workflow instead of duplicating service capabilities', () => {
  const howItWorksPageSource = readFileSync(new URL('./pages/HowItWorksPage.tsx', import.meta.url), 'utf8');
  const whatWeProvidePageSource = readFileSync(new URL('./pages/WhatWeProvidePage.tsx', import.meta.url), 'utf8');

  assert.ok(howItWorksPageSource.includes('PATIENT'));
  assert.ok(howItWorksPageSource.includes('RECEPTION'));
  assert.ok(howItWorksPageSource.includes('DOCTOR'));
  assert.ok(howItWorksPageSource.includes('TV'));
  assert.ok(howItWorksPageSource.includes('Scan QR / Open Link'));
  assert.ok(howItWorksPageSource.includes('See Queue'));
  assert.ok(!howItWorksPageSource.includes('Digital booking'));
  assert.ok(!whatWeProvidePageSource.includes('From scan to turn'));
});

test('booking confirmation can point users to a prefilled live tracking URL', () => {
  assert.equal(buildTrackingHref('+91 98765 43210'), '/track?mobile=9876543210');
  assert.equal(buildTrackingHref('9876543210'), '/track?mobile=9876543210');
});

test('booking confirmation uses the app tracking route instead of a hardcoded localhost URL', () => {
  const bookingPageSource = readFileSync(new URL('./pages/PatientBooking.tsx', import.meta.url), 'utf8');
  assert.ok(!bookingPageSource.includes('http://localhost:3000/track'));
  assert.ok(!bookingPageSource.includes('http://localhost:5173/track'));
});

test('stale login response after logout resolves the user back to login-safe routes', () => {
  const staleStateSequence = [
    { route: '/site/admin', role: 'CLINIC_ADMIN', expected: 'clinic-admin' },
    { route: '/site/admin', role: null, expected: 'site-admin' },
    { route: '/site/login', role: null, expected: 'login' },
    { route: '/login', role: null, expected: 'login' },
  ];

  for (const step of staleStateSequence) {
    assert.equal(resolveAppPageForRoute(step.route, step.role), step.expected);
  }
});

test('authenticated refresh keeps protected admin routes on the correct dashboard', () => {
  const refreshSequence = [
    { route: '/site/admin', role: 'CLINIC_ADMIN', expected: 'clinic-admin' },
    { route: '/site/admin', role: 'SUPER_ADMIN', expected: 'site-admin' },
    { route: '/site/queue', role: 'DOCTOR', expected: 'clinic-queue' },
    { route: '/site/queue', role: 'STAFF', expected: 'clinic-queue' },
  ];

  for (const step of refreshSequence) {
    assert.equal(resolveAppPageForRoute(step.route, step.role), step.expected);
  }
});

test('unauthenticated refresh stays on public or login routes without leaking protected views', () => {
  const unauthenticatedSequence = [
    { route: '/site/admin', role: null, expected: 'site-admin' },
    { route: '/site/login', role: null, expected: 'login' },
    { route: '/login', role: null, expected: 'login' },
    { route: '/how-it-works', role: null, expected: 'how-it-works' },
  ];

  for (const step of unauthenticatedSequence) {
    assert.equal(resolveAppPageForRoute(step.route, step.role), step.expected);
  }
});

test('auth-state race and role transition resolve to the latest role without stale page leakage', () => {
  const raceSequence = [
    { route: '/site/login', role: null, expected: 'login' },
    { route: '/site/login', role: 'CLINIC_ADMIN', expected: 'clinic-admin' },
    { route: '/site/login', role: null, expected: 'login' },
    { route: '/site/admin', role: 'SUPER_ADMIN', expected: 'site-admin' },
    { route: '/site/queue', role: 'DOCTOR', expected: 'clinic-queue' },
    { route: '/site/queue', role: 'CLINIC_ADMIN', expected: 'clinic-admin' },
  ];

  for (const step of raceSequence) {
    assert.equal(resolveAppPageForRoute(step.route, step.role), step.expected);
  }
});

test('browser back/forward after auth change resolves the correct page for the stored route and role', () => {
  const browserHistorySequence = [
    { route: '/site/admin', role: 'CLINIC_ADMIN', expected: 'clinic-admin' },
    { route: '/site/login', role: null, expected: 'login' },
    { route: '/site/admin', role: null, expected: 'site-admin' },
    { route: '/site/admin', role: 'SUPER_ADMIN', expected: 'site-admin' },
    { route: '/site/login', role: 'CLINIC_ADMIN', expected: 'clinic-admin' },
  ];

  for (const step of browserHistorySequence) {
    assert.equal(resolveAppPageForRoute(step.route, step.role), step.expected);
  }
});

test('stale cached auth user is cleared if the auth check fails', async () => {
  const originalFetch = globalThis.fetch;
  const callbackValues: Array<any | null> = [];
  auth.currentUser = { uid: 'cached-user', email: 'user@example.com', role: 'CLINIC_ADMIN' };

  globalThis.fetch = (async () => {
    throw new Error('Auth check failed');
  }) as typeof fetch;

  await new Promise<void>((resolve) => {
    onAuthStateChanged({}, (user) => {
      callbackValues.push(user);
      resolve();
    });
  });

  globalThis.fetch = originalFetch;
  assert.deepEqual(callbackValues, [null]);
  assert.equal(auth.currentUser, null);
});

test('db authorization prevents cross-clinic access and restricts doctors to scoped records', () => {
  const superAdminContext = { userId: 'sa', role: 'SUPER_ADMIN', clinicId: null, doctorId: null, email: 'sa@nextq.in' } as any;
  const clinicAdminContext = { userId: 'ca', role: 'CLINIC_ADMIN', clinicId: 'clinic-1', doctorId: null, email: 'admin@clinic1' } as any;
  const doctorContext = { userId: 'doc', role: 'DOCTOR', clinicId: 'clinic-1', doctorId: 'doctor-42', email: 'doc@clinic1' } as any;

  assert.equal(canAccessRecord(superAdminContext, { clinicId: 'clinic-2' }, 'patients'), true);
  assert.equal(canAccessRecord(clinicAdminContext, { clinicId: 'clinic-2' }, 'patients'), false);
  assert.equal(canAccessRecord(doctorContext, { clinicId: 'clinic-1', doctorId: 'doctor-42', id: 'doctor-42' }, 'doctors'), true);
  assert.equal(canAccessRecord(doctorContext, { clinicId: 'clinic-1', doctorId: 'doctor-99', id: 'doctor-99' }, 'doctors'), false);
  assert.equal(canMutateGenericRecord(doctorContext, 'patients'), false);
  assert.equal(canMutateGenericRecord(clinicAdminContext, 'patients'), false);
  assert.throws(() => prepareDatabaseMutation(clinicAdminContext, 'staff_users', { clinicId: 'clinic-2', role: 'STAFF' }), /A clinic admin cannot assign another clinic\./);
  assert.deepEqual(prepareDatabaseMutation(clinicAdminContext, 'staff_users', { clinicId: 'clinic-1', role: 'STAFF' }), { clinicId: 'clinic-1', role: 'STAFF' });
});
