import { defineConfig, Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import fs from 'fs';

const pkg = JSON.parse(
  fs.readFileSync(path.resolve(__dirname, './package.json'), 'utf-8')
);
const BUILD_ID = `v${pkg.version || '1.0.0'}-${Date.now()}`;

function pwaCacheBustingPlugin(): Plugin {
  return {
    name: 'pwa-cache-busting',
    writeBundle(options) {
      const outDir = options.dir || path.resolve(__dirname, 'dist');
      const swPath = path.join(outDir, 'sw.js');

      if (fs.existsSync(swPath)) {
        const swContent = fs.readFileSync(swPath, 'utf-8');
        const updatedSw = swContent.replace(/__SW_BUILD_ID__/g, BUILD_ID);
        fs.writeFileSync(swPath, updatedSw, 'utf-8');
      }

      const versionFilePath = path.join(outDir, 'version.json');
      fs.writeFileSync(
        versionFilePath,
        JSON.stringify(
          {
            buildId: BUILD_ID,
            version: pkg.version || '1.0.0',
            builtAt: new Date().toISOString(),
          },
          null,
          2
        ),
        'utf-8'
      );
    },
  };
}

// https://vitejs.dev/config/
export default defineConfig({
  base: '/leitor-editor-md/',
  define: {
    __APP_BUILD_ID__: JSON.stringify(BUILD_ID),
  },
  plugins: [react(), pwaCacheBustingPlugin()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    port: 3000,
    host: true,
  },
});
