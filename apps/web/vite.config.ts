import { defineConfig } from 'vite';
import { createRequire } from 'node:module';

// The real Void Cloud SDK (`void` on the Void registry) exports `voidPlugin()`.
// Plain npm `void@^0.1.0` resolves to an unrelated CloudFront CJS package, so
// load it defensively: dev/build work without the plugin until the SDK is installed.
const require = createRequire(import.meta.url);
let voidPlugin: () => { name: string } = () => ({ name: 'void-missing' });
try {
  const mod = require('void') as { voidPlugin?: () => { name: string } };
  if (typeof mod.voidPlugin === 'function') voidPlugin = mod.voidPlugin;
} catch {
  // no Void SDK installed — plain Vite serves pages/routes for local dev
}

export default defineConfig({
  plugins: [
    voidPlugin(),
  ],
  resolve: {
    alias: {
      '@': '/src',
    },
  },
});
