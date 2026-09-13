export const MIN_SUPER_ADMIN_PASSWORD_LENGTH = 12;
export const MIN_SESSION_SECRET_LENGTH = 32;
const DEVELOPMENT_SESSION_SECRET = 'nextq-development-session-secret';

export const validateSuperAdminBootstrapPassword = (password: string, nodeEnv: string | undefined): string | null => {
  if (nodeEnv === 'production' && password.length < MIN_SUPER_ADMIN_PASSWORD_LENGTH) {
    return `SUPER_ADMIN_PASSWORD must be at least ${MIN_SUPER_ADMIN_PASSWORD_LENGTH} characters in production.`;
  }
  return null;
};

export const validateSessionSecret = (secret: string | undefined, nodeEnv: string | undefined): string | null => {
  if (nodeEnv !== 'production') return null;

  const normalizedSecret = secret?.trim() || '';
  if (!normalizedSecret) return 'SESSION_SECRET must be configured in production.';
  if (normalizedSecret === DEVELOPMENT_SESSION_SECRET) {
    return 'SESSION_SECRET must not use the development default in production.';
  }
  if (normalizedSecret.length < MIN_SESSION_SECRET_LENGTH) {
    return `SESSION_SECRET must be at least ${MIN_SESSION_SECRET_LENGTH} characters in production.`;
  }

  return null;
};