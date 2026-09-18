import React from 'react';
import { CommonCta } from '../components/CommonCta';

interface Props {
  onNavigate: (page: string) => void;
}

export const BenefitsPage: React.FC<Props> = ({ onNavigate }) => {
  const benefitCards = [
    {
      label: 'PATIENTS',
      title: 'Book without an app.',
      detail: 'Get a token and track your turn live.',
    },
    {
      label: 'RECEPTION',
      title: 'Keep the queue moving.',
      detail: 'Manage appointments, tokens and priority from one place.',
    },
    {
      label: 'DOCTORS',
      title: 'Stay focused on consultations.',
      detail: "See what's next and complete visits easily.",
    },
    {
      label: 'WAITING ROOM',
      title: 'Keep everyone informed.',
      detail: 'Show now-serving and upcoming tokens on the TV.',
    },
  ];

  return (
    <div className="public-light-page">
      <section className="premium-benefits-section">
        <div className="premium-benefits-header">
          <div className="premium-benefits-heading">
            <h1 className="premium-benefits-title">Benefits for your whole clinic</h1>
            <p className="premium-benefits-summary">
              Help patients spend less time waiting while your team keeps the clinic moving.
            </p>
          </div>
        </div>

        <div className="premium-benefits-compact-grid">
          {benefitCards.map(({ label, title, detail }) => (
            <article className="premium-benefit-simple-card" key={label}>
              <div className="premium-benefit-simple-label">{label}</div>
              <h2>{title}</h2>
              <p>{detail}</p>
            </article>
          ))}
        </div>

        <div className="premium-benefits-standout">
          <span>Less waiting.</span>
          <span>Clearer queues.</span>
          <span>A smoother clinic day.</span>
        </div>

        <div className="premium-benefits-cta-wrap">
          <CommonCta />
        </div>
      </section>
    </div>
  );
};
