import { defineHandler } from 'void';

export const GET = defineHandler(() => ({
  status: 'ok',
  app: '@void-monorepo/coffee-api',
  timestamp: new Date().toISOString(),
}));
