import React from 'react';
import { CommonCta } from '../components/CommonCta';

interface Props {
  onNavigate: (page: string) => void;
}

const experiences = [
  { label: 'PATIENTS', text: 'Book → Get Token → Track Turn' },
  { label: 'RECEPTION', text: 'See Queue → Add Patient → Call Next → Manage Flow' },
  { label: 'DOCTORS', text: 'IN → Call / Serve → Complete → OUT' },
  { label: 'TV DISPLAY', text: 'Now Serving → Next Tokens → Queue Status' },
];

const benefits = [
  'Appointment Management',
  'Token & Queue Management',
  'Patient Tracking',
  'Waiting Room Display',
];

export const WhatWeProvidePage: React.FC<Props> = ({ onNavigate }) => (
  <div className="public-light-page">
    <main className="what-we-provide-page">
      <section className="what-we-provide-hero">
        <h1 className="public-page-title mx-auto mt-0 max-w-4xl">Digital Appointment & Live Queue Management</h1>
        <p className="public-page-lede mx-auto mt-0 max-w-full">
          Everything your clinic needs to manage appointments, tokens and patient flow in one simple system.
        </p>
      </section>

      <section className="what-we-provide-section">
        <p className="public-kicker what-we-provide-kicker">FOUR SIMPLE EXPERIENCES</p>

        <div className="what-we-provide-grid experience-grid">
          {experiences.map((experience) => (
            <article key={experience.label} className="what-we-provide-experience-card">
              <div className="what-we-provide-experience-label">{experience.label}</div>
              <div className="what-we-provide-experience-text">{experience.text}</div>
            </article>
          ))}
        </div>
      </section>

      <section className="what-we-provide-section what-we-provide-benefits-wrap">
        <p className="public-kicker what-we-provide-kicker">WHAT YOU GET</p>

        <div className="what-we-provide-grid benefit-grid">
          {benefits.map((benefit) => (
            <article key={benefit} className="what-we-provide-benefit-card">
              <h3>{benefit}</h3>
            </article>
          ))}
        </div>
      </section>

      <section className="premium-benefits-cta-wrap">
        <CommonCta />
      </section>
    </main>
  </div>
);
