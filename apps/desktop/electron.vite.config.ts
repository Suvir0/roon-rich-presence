import { resolve } from 'node:path';
import { defineConfig, externalizeDepsPlugin } from 'electron-vite';
import react from '@vitejs/plugin-react';

const publicBuildValues = Object.fromEntries(
  [
    'DISCORD_APPLICATION_ID',
    'ROON_EXTENSION_ID',
    'PROJECT_CONTACT_URL',
    'PROJECT_PUBLISHER',
    'PROJECT_SUPPORT_EMAIL'
  ].flatMap((key) =>
    process.env[key] ? [[`process.env.${key}`, JSON.stringify(process.env[key])]] : []
  )
);

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    resolve: { alias: { '@rrp/core': resolve('../../packages/core/src/index.ts') } },
    define: publicBuildValues
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    resolve: { alias: { '@rrp/core': resolve('../../packages/core/src/index.ts') } },
    build: {
      rollupOptions: {
        output: { format: 'cjs', entryFileNames: 'index.cjs' }
      }
    }
  },
  renderer: {
    root: resolve('src/renderer'),
    resolve: { alias: { '@rrp/core': resolve('../../packages/core/src/index.ts') } },
    plugins: [react()]
  }
});
