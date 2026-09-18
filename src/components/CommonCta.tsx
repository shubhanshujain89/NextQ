import React from 'react';
import { ArrowRight } from 'lucide-react';
import { useSiteConfig } from '../lib/siteConfig';

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
    >
      {!compact && <p>Ready to simplify your clinic flow?</p>}
      <span>{label} <ArrowRight className="h-4 w-4" /></span>
    </a>
  );
};
