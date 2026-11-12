import { loadEnvFile } from 'node:process';
import { defineConfig } from 'astro/config';
import node from '@astrojs/node';
import vercel from '@astrojs/vercel';
import cloudflare from '@astrojs/cloudflare';
// Astro evaluates this configuration before loading the project's .env file.
try {
  loadEnvFile();
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
}
const target = process.env.DEPLOY_TARGET ?? 'node';
export default defineConfig({
  site: process.env.SITE_URL || 'https://kira-store.example',
  output: 'server',
  session: false,
  adapter:
    target === 'cloudflare'
      ? cloudflare({ imageService: 'passthrough' })
      : target === 'vercel'
        ? vercel()
        : node({ mode: 'standalone' }),
  vite: { build: { sourcemap: false } },
});
