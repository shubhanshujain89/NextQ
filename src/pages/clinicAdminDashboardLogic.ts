export type DashboardMode = 'site-admin' | 'clinic-admin';
export type DashboardTabKey = 'dashboard' | 'clinic-summary' | 'content' | 'clinics' | 'barcode-inventory' | 'users' | 'security' | 'billing' | 'audit' | 'recent-activity';
export type DashboardTab = { key: DashboardTabKey; label: string };

export const getDashboardTabs = (mode: DashboardMode): DashboardTab[] => {
  const commonTabs: DashboardTab[] = [
    { key: 'dashboard', label: 'Dashboard' },
    { key: 'clinic-summary', label: 'Clinic Wise Summary' },
    { key: 'clinics', label: 'Clinics' },
    { key: 'users', label: 'Users' },
    { key: 'security', label: 'Access & Security' },
    { key: 'billing', label: 'Billing & Packs' },
    { key: 'audit', label: 'Audit Trail' },
    { key: 'recent-activity', label: 'Recent Activity' },
  ];

  if (mode === 'site-admin') {
    return [
      ...commonTabs.slice(0, 2),
      { key: 'content', label: 'Website Content' },
      ...commonTabs.slice(2, 3),
      { key: 'barcode-inventory', label: 'QR Code Inventory' },
      ...commonTabs.slice(3),
    ];
  }

  return commonTabs;
};
