/**
 * Validates required environment variables at boot.
 * Throws a single error listing every problem so misconfiguration is obvious.
 */
export function validateEnv(config: Record<string, unknown>): Record<string, unknown> {
  const errors: string[] = [];
  const str = (key: string) => String(config[key] ?? '').trim();

  if (!str('DATABASE_URL')) errors.push('DATABASE_URL is required');
  if (!str('GROQ_API_KEY')) errors.push('GROQ_API_KEY is required');
  if (!str('TELEGRAM_BOT_TOKEN')) errors.push('TELEGRAM_BOT_TOKEN is required');

  if (process.env.NODE_ENV === 'production' && !str('JWT_SECRET')) {
    errors.push('JWT_SECRET is required in production');
  }

  const usePolling = str('TELEGRAM_USE_POLLING').toLowerCase() === 'true';
  const webhookUrl = str('TELEGRAM_WEBHOOK_URL');

  if (!usePolling && !webhookUrl) {
    errors.push('TELEGRAM_WEBHOOK_URL is required unless TELEGRAM_USE_POLLING=true');
  }
  if (webhookUrl && !/^https:\/\//i.test(webhookUrl)) {
    errors.push('TELEGRAM_WEBHOOK_URL must be an https:// URL');
  }

  if (errors.length > 0) {
    throw new Error(`Invalid environment configuration:\n - ${errors.join('\n - ')}`);
  }

  return config;
}
