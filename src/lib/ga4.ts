type Ga4EventParams = Record<string, string | number | boolean | undefined>;

export const trackGa4Event = (eventName: string, params: Ga4EventParams = {}) => {
  if (typeof window === 'undefined') {
    return;
  }

  const gtag = (window as Window & {
    gtag?: (command: 'event', eventName: string, params?: Ga4EventParams) => void;
  }).gtag;

  if (typeof gtag === 'function') {
    gtag('event', eventName, params);
  }
};
