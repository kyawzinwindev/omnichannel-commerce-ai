export default () => ({
  port: parseInt(process.env.PORT || '3001', 10),
  databaseUrl: process.env.DATABASE_URL,
  redisUrl: process.env.REDIS_URL || 'redis://localhost:6379',
  groq: {
    apiKey: process.env.GROQ_API_KEY || '',
  },
  telegram: {
    botToken: process.env.TELEGRAM_BOT_TOKEN || '',
    webhookUrl: process.env.TELEGRAM_WEBHOOK_URL || '',
    webhookSecret: process.env.TELEGRAM_WEBHOOK_SECRET || '',
    usePolling: (process.env.TELEGRAM_USE_POLLING || 'false').toLowerCase() === 'true',
    tenantId: process.env.TELEGRAM_TENANT_ID || 'demo-store-01',
  },
});
