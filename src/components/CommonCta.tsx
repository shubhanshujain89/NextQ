import React from 'react';
import { ArrowRight } from 'lucide-react';
import { useSiteConfig } from '../lib/siteConfig';

export const CommonCta: React.FC = () => {
  const { settings } = useSiteConfig();

  return (
    <a className="premium-contact-demo-cta" href={settings.salesFormUrl} target="_blank" rel="noreferrer">
      <p>Ready to simplify your clinic flow?</p>
      <span>Start with NEXTQ <ArrowRight className="h-4 w-4" /></span>
    </a>
  );
};
