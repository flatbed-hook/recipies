import { cloudflareTest } from '@cloudflare/vitest-plugin';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [cloudflareTest({ miniflare: { compatibilityDate: '2026-10-19', d1Databases: ['DB'] } })],
});
