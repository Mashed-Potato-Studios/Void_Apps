import { defineConfig } from 'void/config';

export default defineConfig({
  target: 'cloudflare',
  routing: {
    headers: {
      '/assets/*': ['Cache-Control: public, max-age=31536000, immutable'],
      '/*': [
        'X-Frame-Options: DENY',
        'X-Content-Type-Options: nosniff',
        'Referrer-Policy: no-referrer',
        'Cache-Control: no-store',
      ],
    },
  },
  head: {
    titleTemplate: '%s | Crew Coffee Admin',
    htmlAttrs: { lang: 'en' },
    meta: [
      { charset: 'utf-8' },
      { name: 'viewport', content: 'width=device-width, initial-scale=1' },
      { name: 'robots', content: 'noindex, nofollow' },
    ],
  },
  worker: {
    compatibility_date: '2026-01-01',
    compatibility_flags: ['nodejs_compat'],
  },
});
