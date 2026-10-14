import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    port: 5173,
    open: false,
  },
  preview: {
    port: 4173,
  },
  worker: {
    format: 'es',
  },
  build: {
    target: 'es2022',
    sourcemap: false,
    chunkSizeWarningLimit: 1500,
    rollupOptions: {
      output: {
        // Separate vendor chunks so the app code can be cached independently.
        codeSplitting: {
          groups: [
            { name: 'three', test: /node_modules[\/]three[\/]/, priority: 2 },
            { name: 'postprocessing', test: /node_modules[\/]postprocessing[\/]/, priority: 1 },
          ],
        },
      },
    },
  },
});
