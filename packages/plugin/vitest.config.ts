import { defineConfig } from 'vitest/config';
export default defineConfig({ test: { name: 'plugin', include: ['src/**/*.test.ts'] } });
