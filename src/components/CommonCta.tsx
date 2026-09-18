import React from 'react';
import { ArrowRight } from 'lucide-react';
import { useSiteConfig } from '../lib/siteConfig';
import { trackGa4Event } from '../lib/ga4';

interface CommonCtaProps {
  label?: string;
  compact?: boolean;
}

export const CommonCta: React.FC<CommonCtaProps> = ({ label = 'Start with NEXTQ', compact = false }) => {
  const { settings } = useSiteConfig();

  return (
    <a
      className={`premium-contact-demo-cta${compact ? ' premium-contact-demo-cta--compact' : ''}`}
      href={settings.salesFormUrl}
      target="_blank"
      rel="noreferrer"
      onClick={() => {
        const eventName = compact ? 'demo_click' : 'cta_click';
        trackGa4Event(eventName, {
          cta_type: compact ? 'demo' : 'primary',
          location: 'header_or_hero',
        });
      }}
    >
      {!compact && <p>Ready to simplify your clinic flow?</p>}
      <span>{label} <ArrowRight className="h-4 w-4" /></span>
    </a>
  );
};
