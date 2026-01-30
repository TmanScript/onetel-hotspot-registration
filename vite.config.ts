
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  // This ensures paths are relative so it works on GitHub Pages subpaths
  base: './',
  build: {
    outDir: 'dist',
  }
});
