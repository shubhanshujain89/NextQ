import React from 'react';
import { Mail, MapPin, Phone, ArrowRight } from 'lucide-react';
import { useSiteConfig } from '../lib/siteConfig';
import { CommonCta } from '../components/CommonCta';
import { trackGa4Event } from '../lib/ga4';

interface Props {
  onNavigate: (page: string) => void;
}

const WhatsAppLogoIcon: React.FC<{ className?: string }> = ({ className }) => (
  <svg viewBox="0 0 24 24" className={className} aria-hidden="true" focusable="false">
    <path
      fill="currentColor"
      d="M20.52 3.48A11.7 11.7 0 0 0 12.04 0C5.47 0 .1 5.37.1 11.95c0 2.1.55 4.15 1.6 5.96L0 24l6.3-1.65A11.95 11.95 0 0 0 12.04 24c6.56 0 11.94-5.37 11.94-11.95 0-3.2-1.25-6.22-3.46-8.57ZM12.04 21.8c-1.93 0-3.8-.52-5.44-1.5l-.39-.23-3.73.98 1-3.63-.26-.38A9.85 9.85 0 0 1 2.13 12C2.13 6.85 6.9 2.08 12.04 2.08c2.38 0 4.63.93 6.31 2.62a8.85 8.85 0 0 1 2.61 6.26c0 5.15-4.77 9.84-10.92 9.84Zm6.08-7.34c-.33-.17-1.98-.98-2.3-1.08-.31-.1-.54-.17-.77.17-.22.34-.86 1.08-1.06 1.3-.2.22-.39.24-.73.08-.33-.17-1.42-.52-2.7-1.67-.99-.88-1.66-1.97-1.86-2.3-.2-.33-.02-.52.15-.7.16-.15.33-.39.5-.58.17-.19.22-.34.33-.57.11-.22.06-.42-.03-.58-.09-.17-.77-1.86-1.06-2.55-.28-.67-.56-.58-.77-.59l-.66-.01c-.22 0-.58.08-.88.42-.3.34-1.15 1.13-1.15 2.75s1.18 3.19 1.35 3.41c.17.22 2.31 3.52 5.6 4.94.78.34 1.39.54 1.87.69.79.25 1.51.22 2.08.13.64-.1 1.98-.81 2.26-1.59.28-.78.28-1.45.2-1.59-.08-.14-.3-.22-.63-.39Z"
    />
  </svg>
);

export const ContactPage: React.FC<Props> = ({ onNavigate }) => {
  const { settings } = useSiteConfig();

  const cards = [
    {
      icon: Phone,
      title: 'Call Us',
      value: settings.contactPhone,
      note: 'Sales & Clinic Desk',
      action: 'Call Now',
      actionHref: `tel:${settings.contactPhone.replace(/\s/g, '')}`,
    },
    {
      icon: Mail,
      title: 'Get in Touch',
      value: settings.contactEmail,
      note: 'Questions, support or enquiries',
      action: 'Get in Touch',
      actionHref: settings.salesFormUrl || 'https://forms.gle/your-clinic-sales-request',
    },
    {
      icon: WhatsAppLogoIcon,
      title: 'WhatsApp',
      value: 'Quick support and enquiries',
      note: 'Chat with our team for quick help.',
      action: 'Chat on WhatsApp',
      actionHref: `https://wa.me/${settings.whatsappNumber.replace(/[^0-9]/g, '')}?text=${encodeURIComponent(settings.whatsappMessage || 'Hi NEXTQ, I would like to know more about your clinic queue and appointment management solution.')}`,
    },
    {
      icon: MapPin,
      title: 'Based in Noida',
      value: 'Sector 168, Noida',
      note: 'Uttar Pradesh 201305, India',
      action: '',
      actionHref: '',
    },
  ];

  return (
    <div className="public-light-page">
      <section className="premium-contact-page">
        <div className="premium-contact-wrapper">
          <section className="premium-contact-left-panel">
            <div className="premium-contact-left-inner">
              <h1 className="premium-contact-title">We’re here to help</h1>
              <p className="premium-contact-summary">
                Have a question or want to get started? Our team is just a call, message or email away.
              </p>

              <div className="premium-contact-card-grid">
                {cards.map(({ icon: Icon, title, value, note, action, actionHref }) => (
                  <article className="premium-contact-card" key={title}>
                    <div className="premium-contact-icon-wrap">
                      <span className="premium-contact-icon">
                        <Icon className="h-5 w-5" />
                      </span>
                    </div>
                    <div className="premium-contact-card-content">
                      <h3>{title}</h3>
                      <div className="premium-contact-card-value">{value}</div>
                      <div className="premium-contact-card-note">{note}</div>
                      {action ? (
                        <a
                          className="premium-contact-card-action"
                          href={actionHref}
                          target={actionHref.startsWith('http') ? '_blank' : undefined}
                          rel={actionHref.startsWith('http') ? 'noreferrer' : undefined}
                          onClick={() => {
                            if (title === 'WhatsApp') {
                              trackGa4Event('whatsapp_click', { channel: 'contact_page' });
                            } else if (title === 'Get in Touch') {
                              trackGa4Event('contact_click', { channel: 'contact_page' });
                            } else if (title === 'Call Us') {
                              trackGa4Event('contact_click', { channel: 'call_link' });
                            }
                          }}
                        >
                          <ArrowRight className="h-4 w-4" /> {action}
                        </a>
                      ) : null}
                    </div>
                  </article>
                ))}
              </div>

              <div className="premium-benefits-cta-wrap">
                <CommonCta />
              </div>
            </div>
          </section>
        </div>
      </section>
    </div>
  );
};
