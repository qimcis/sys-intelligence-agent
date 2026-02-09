// @ts-check
import { defineConfig } from 'astro/config';
import node from '@astrojs/node';

// https://astro.build/config
const isVercel = process.env.VERCEL === '1';

export default defineConfig({
  output: isVercel ? 'static' : 'server',
  ...(isVercel ? {} : { adapter: node({ mode: 'standalone' }) }),
});
