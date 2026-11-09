import { defineConfig } from 'vitest/config';
export default defineConfig({ test: { name: 'backend', include: ['src/**/*.test.ts'] } });
