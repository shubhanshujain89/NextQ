import React from 'react';
import { CommonCta } from '../components/CommonCta';

interface Props {
  onNavigate: (page: string) => void;
}

const whyItWorks = [
  {
    title: 'Less waiting',
    detail: 'Keep patients informed and reduce unnecessary time in the waiting room.',
  },
  {
    title: 'Live queue visibility',
    detail: 'Patients, reception and doctors stay aligned with the same queue.',
  },
  {
    title: 'Simple for staff',
    detail: 'Manage appointments, tokens and patient flow from one place.',
  },
  {
    title: 'No app for patients',
    detail: 'Scan, book, get a token and track the turn from the browser.',
  },
];

const clinicRoles = ['Patients', 'Reception', 'Doctors', 'TV Display'];

export const WhyChooseUsPage: React.FC<Props> = ({ onNavigate }) => {
  return (
    <div className="public-light-page">
      <section className="premium-why-section mx-auto max-w-full px-4 py-8 sm:px-6 lg:px-8">
        <div className="premium-why-hero">
          <h1 className="premium-why-headline-text">A simpler way to manage<br />appointments, queues and patient flow.</h1>
          <p className="premium-why-supporting-text">One simple system that keeps patients, staff and doctors aligned throughout the clinic day.</p>
        </div>

        <div className="premium-why-block">
          <div className="premium-why-grid">
            {whyItWorks.map((item) => (
              <article key={item.title} className="premium-why-step-card">
                <h3>{item.title}</h3>
                <p>{item.detail}</p>
              </article>
            ))}
          </div>
        </div>

        <div className="premium-why-block premium-why-clinic-block">
          <div className="premium-why-block-title">BUILT FOR THE WHOLE CLINIC</div>
          <div className="premium-why-clinic-grid">
            {clinicRoles.map((role) => (
              <div key={role} className="premium-why-role-pill">{role}</div>
            ))}
          </div>
        </div>

        <div className="premium-benefits-cta-wrap">
          <CommonCta />
        </div>
      </section>
    </div>
  );
};
