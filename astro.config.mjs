// @ts-check
import { defineConfig } from 'astro/config';
import node from '@astrojs/node';

// https://astro.build/config
const isVercel = Boolean(process.env.VERCEL || process.env.VERCEL_ENV);
const forcedOutput = process.env.ASTRO_OUTPUT;
const output =
  forcedOutput === "server" || forcedOutput === "static"
    ? forcedOutput
    : isVercel
      ? "static"
      : "server";

export default defineConfig({
  output,
  ...(output === "server" ? { adapter: node({ mode: "standalone" }) } : {}),
});
