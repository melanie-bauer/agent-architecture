import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Built into ui-planner/dist and served by the Mastra server under /planner.
export default defineConfig({
  root: __dirname,
  base: '/planner/',
  plugins: [react()],
  build: { outDir: 'dist', emptyOutDir: true, chunkSizeWarningLimit: 4000 },
  server: { proxy: { '/copilotkit': 'http://localhost:4111', '/planner/events': 'http://localhost:4111', '/planner/reset': 'http://localhost:4111', '/planner/info': 'http://localhost:4111', '/planner/plan': 'http://localhost:4111', '/planner/data': 'http://localhost:4111', '/desk/info': 'http://localhost:4111' } },
});
