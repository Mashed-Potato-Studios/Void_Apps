import { defineHandler } from 'void';

export const GET = defineHandler(async () => {
  return {
    status: 'healthy',
    app: '@void-monorepo/web',
    timestamp: new Date().toISOString(),
    uptime: process.uptime ? process.uptime() : 0,
    environment: process.env.NODE_ENV || 'development',
  };
});
