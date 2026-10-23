import { defineHandler } from 'void';
import { env } from 'void/env';

export const GET = defineHandler(async () => {
  let api = 'down';
  try {
    const response = await fetch(`${env.COFFEE_API_URL.replace(/\/+$/, '')}/api/health`);
    api = response.ok ? 'up' : 'down';
  } catch {
    api = 'down';
  }
  return {
    status: 'ok',
    app: '@void-monorepo/coffee',
    api,
    timestamp: new Date().toISOString(),
  };
});
