import { defineConfig } from 'void/config';

export default defineConfig({
  target: 'cloudflare',
  routing: {
    headers: {
      '/api/*': [
        'X-Content-Type-Options: nosniff',
        'Referrer-Policy: no-referrer',
        'Cache-Control: no-store',
      ],
    },
  },
  head: {
    titleTemplate: '%s | Crew Coffee API',
    htmlAttrs: { lang: 'en' },
  },
  worker: {
    compatibility_date: '2026-01-01',
    compatibility_flags: ['nodejs_compat'],
  },
});
