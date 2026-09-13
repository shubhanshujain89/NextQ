export type RateLimitStatus = 'ok' | 'rate_limited' | 'unavailable';

export const classifyRateLimitCount = (requestCount: unknown, max: number): RateLimitStatus => {
  if (requestCount === null || requestCount === undefined) return 'unavailable';

  const count = Number(requestCount);
  if (!Number.isFinite(count) || count < 0) return 'unavailable';
  return count > max ? 'rate_limited' : 'ok';
};