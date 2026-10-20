import { defineConfig } from 'void/config';

export default defineConfig({
  target: 'cloudflare',
  routing: {
    revalidate: {
      '/': 60,
      '/dashboard': 0,
    },
    headers: {
      '/assets/*': ['Cache-Control: public, max-age=31536000, immutable'],
      '/*': [
        'X-Frame-Options: DENY',
        'X-Content-Type-Options: nosniff',
        'Referrer-Policy: strict-origin-when-cross-origin',
      ],
    },
  },
  head: {
    titleTemplate: '%s | Crew Coffee',
    htmlAttrs: { lang: 'en' },
    meta: [
      { charset: 'utf-8' },
      { name: 'viewport', content: 'width=device-width, initial-scale=1' },
      { name: 'description', content: 'Crew Coffee — Void Quickstart demo storefront' },
    ],
  },
  worker: {
    compatibility_date: '2026-01-01',
    compatibility_flags: ['nodejs_compat'],
  },
});
