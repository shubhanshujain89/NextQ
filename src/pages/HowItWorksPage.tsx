import React from 'react';
import { CommonCta } from '../components/CommonCta';

interface Props {
  onNavigate: (page: string) => void;
}

const receptionRows = [
  { token: 'A-204', patient: 'Maya Patel', contact: '98765 43210', type: 'Walk-in', status: 'Waiting', payment: 'Paid', vitals: 'Normal', action: 'View' },
  { token: 'A-205', patient: 'Alex Singh', contact: '98765 12345', type: 'Repeat', status: 'Serving', payment: 'Pending', vitals: 'Stable', action: 'Update' },
  { token: 'A-206', patient: 'Noah Kim', contact: '98765 67890', type: 'Priority', status: 'On Hold', payment: 'Paid', vitals: 'Review', action: 'Resume' },
  { token: 'A-207', patient: 'Riya Shah', contact: '98765 90909', type: 'Booked', status: 'Waiting', payment: 'Paid', vitals: 'Normal', action: 'View' },
];

const workflows = [
  {
    role: 'PATIENT',
    subtitle: 'Simple booking and live queue tracking.',
    steps: ['Scan QR / Open Link', 'Book', 'Get Token', 'Track Turn'],
    preview: {
      label: 'PATIENT TOKEN',
      title: 'Your visit is on track',
      metrics: [['Token', 'A-104'], ['Ahead', '3'], ['Est. wait', '12m']],
      focus: 'Now serving A-101',
      action: 'Track live turn',
    },
  },
  {
    role: 'RECEPTION',
    subtitle: 'Manage appointments and walk-ins, call the next patient, and keep the queue moving.',
    steps: ['See Queue', 'Add Patient', 'Call Next', 'Manage Flow'],
    preview: {
      label: 'RECEPTION DESK',
      title: 'Queue control center',
      metrics: [['Waiting', '12'], ['Served', '38'], ['Priority', '2']],
      focus: 'Next in line: A-104',
      action: 'Call next patient',
    },
  },
  {
    role: 'DOCTOR',
    subtitle: 'Stay focused on the active consultation.',
    steps: ['IN', 'Call / Serve', 'Complete', 'OUT'],
    preview: {
      label: 'DOCTOR VIEW',
      title: 'Consultation in focus',
      metrics: [['Current', 'A-104'], ['Room', '02'], ['Status', 'IN']],
      focus: 'Patient A-104 is in consultation',
      action: 'Complete visit',
    },
  },
  {
    role: 'TV DISPLAY',
    subtitle: 'Keep the waiting room informed.',
    steps: ['Now Serving', 'Next Tokens', 'Queue Status'],
    preview: {
      label: 'TV DISPLAY',
      title: 'Now serving',
      metrics: [['Token', 'A-101'], ['Next', 'A-104'], ['Desk', '02']],
      focus: 'Please wait for your token',
      action: 'Queue is live',
    },
  },
];

export const HowItWorksPage: React.FC<Props> = ({ onNavigate }) => (
  <div className="public-light-page">
    <main className="w-full px-4 pb-8 pt-0 sm:px-6 sm:pt-0 lg:px-8">
      <section className="pb-3">
        <div className="flex flex-col items-center gap-2 text-center">
          <h1 className="how-it-works-headline public-page-title w-full text-center">One clear flow for every part of the clinic.</h1>
          <p className="public-page-lede w-full text-center">From booking to consultation, NEXTQ keeps every step connected and visible.</p>
        </div>
      </section>

      <section className="workflow-list" aria-label="How NEXTQ works">
        {workflows.map((workflow) => (
          <article key={workflow.role} className="workflow-row">
            <div className="workflow-row-content">
              <section className="workflow-copy">
                <div className="workflow-role">{workflow.role}</div>
                <div className="workflow-subtitle">{workflow.subtitle}</div>
                <div className="workflow-steps">
                  {workflow.steps.map((step) => (
                    <div className="workflow-step-item" key={step}>
                      <span className="workflow-step-card">{step}</span>
                    </div>
                  ))}
                </div>
              </section>
            </div>
          </article>
        ))}
      </section>

      <div className="premium-benefits-cta-wrap">
        <CommonCta />
      </div>
    </main>
  </div>
);
