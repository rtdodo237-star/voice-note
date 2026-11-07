import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// GitHub Pages 주소가 https://<계정>.github.io/voice-note/ 이므로 기준 경로를 맞춘다
export default defineConfig({
  base: process.env.BASE_PATH ?? '/voice-note/',
  plugins: [react()],
});
