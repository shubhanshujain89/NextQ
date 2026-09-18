import React from 'react';
import { ArrowRight } from 'lucide-react';
import { CommonCta } from '../components/CommonCta';

interface LandingPageProps {
  onNavigate: (page: string, role?: string) => void;
}

const workflows = [
  {
    role: 'PATIENT',
    title: 'From scan to turn',
    description: 'A patient can join the right queue in a few clear steps.',
    steps: ['Scan QR / Open Link', 'Book', 'Get Token', 'Track Turn'],
    preview: { label: 'PATIENT TOKEN', title: 'Your visit is on track', metrics: [['Token', 'A-104'], ['Ahead', '3'], ['Est. wait', '12m']], focus: 'Now serving A-101', action: 'Track live turn' },
  },
  {
    role: 'RECEPTION',
    title: 'Manage appointments and walk-ins, call the next patient, and keep the queue moving.',
    description: 'The front desk sees the whole room and always knows what happens next.',
    steps: ['See Queue', 'Call Next', 'Manage Priority', 'Keep Queue Moving'],
    preview: { label: 'RECEPTION DESK', title: 'Queue control center', metrics: [['Waiting', '12'], ['Served', '38'], ['Priority', '2']], focus: 'Next in line: A-104', action: 'Call next patient' },
  },
  {
    role: 'DOCTOR',
    title: 'A focused consultation flow',
    description: 'The doctor controls the active queue without extra steps around care.',
    steps: ['IN', 'Call / Serve', 'Complete', 'OUT'],
    preview: { label: 'DOCTOR VIEW', title: 'Consultation in focus', metrics: [['Current', 'A-104'], ['Room', '02'], ['Status', 'IN']], focus: 'Patient A-104 is in consultation', action: 'Complete visit' },
  },
  {
    role: 'TV',
    title: 'One calm view for everyone',
    description: 'A simple display keeps patients informed without exposing private details.',
    steps: ['Now Serving', 'Next Tokens', 'Queue Status'],
    preview: { label: 'TV DISPLAY', title: 'Now serving', metrics: [['Token', 'A-101'], ['Next', 'A-104'], ['Desk', '02']], focus: 'Please wait for your token', action: 'Queue is live' },
  },
];

export const LandingPage: React.FC<LandingPageProps> = ({ onNavigate }) => {
  return (
    <div className="landing-page-shell min-h-screen text-slate-900">
    <main className="landing-main px-4 pb-16 sm:px-6 sm:pb-20 lg:px-8 lg:pb-24">
      <section className="landing-hero">
        <div className="landing-hero-grid">
          <div className="landing-hero-copy">
            <h1 className="landing-title">Smart Queue. Less Waiting.</h1>
            <p className="landing-subtitle">Clinic appointment management and live patient queue tracking for modern clinics.</p>
            <p className="landing-note">No app. No signup. Scan, book, get your token and track your turn live.</p>
            <CommonCta />
          </div>

          <aside className="landing-dashboard-preview landing-hero-preview" aria-label="clinic queue dashboard preview">
            <div className="dashboard-preview-topbar">
              <span className="dashboard-preview-brand">
                <span className="site-brand-mark">N</span>
                <span>NEXTQ</span>
              </span>
              <span className="dashboard-preview-live"><span /> Live</span>
            </div>
            <div className="dashboard-preview-heading">
              <div>
                <span className="dashboard-preview-label">Queue dashboard</span>
                <h3>Today’s flow</h3>
              </div>
              <ArrowRight aria-hidden="true" />
            </div>
            <div className="dashboard-preview-metrics">
              <div>
                <span>Now serving</span>
                <strong>A-104</strong>
              </div>
              <div>
                <span>Waiting</span>
                <strong>08</strong>
              </div>
              <div>
                <span>Avg. wait</span>
                <strong>12m</strong>
              </div>
            </div>
            <div className="dashboard-preview-queue">
              <div className="dashboard-preview-queue-heading">
                <span>Queue live</span>
                <span>Room 02</span>
              </div>
              <div className="dashboard-preview-queue-row">
                <strong>Token A-101</strong>
                <b>Doctor in consultation</b>
              </div>
              <div className="dashboard-preview-queue-row">
                <strong>Token A-102</strong>
                <b>Next patient ready</b>
              </div>
              <div className="dashboard-preview-queue-row">
                <strong>Token A-103</strong>
                <b>Reception review</b>
              </div>
            </div>
          </aside>
        </div>
      </section>

      <section className="landing-experiences" aria-labelledby="experiences-heading">
        <div className="landing-experiences-header">
          <p className="landing-kicker">Built around the clinic</p>
          <h2 id="experiences-heading">One Clinic. Four simple experiences.</h2>
        </div>

        <div className="landing-experience-cards" aria-label="Four NEXTQ experiences">
          <div className="landing-experience-card">
            <span>PATIENTS</span>
          </div>
          <div className="landing-experience-card">
            <span>RECEPTION</span>
          </div>
          <div className="landing-experience-card">
            <span>DOCTORS</span>
          </div>
          <div className="landing-experience-card">
            <span>TV Display</span>
          </div>
        </div>
      </section>

      <section className="landing-cta" aria-labelledby="cta-heading">
        <div>
          <p className="landing-kicker">Ready when your clinic is</p>
          <h2 id="cta-heading">Simplify Clinic appointment and queue management.</h2>
        </div>
      </section>
    </main>
    </div>
  );
};
