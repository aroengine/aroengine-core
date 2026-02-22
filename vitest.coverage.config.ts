import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['**/__tests__/**/*.test.ts'],
    exclude: ['public-export/**', 'node_modules/**'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json-summary'],
      include: ['apps/core-engine/src/**/*.ts', 'packages/**/src/**/*.ts'],
      exclude: [
        '**/__tests__/**',
        'public-export/**',
        'apps/core-engine/src/index.ts',
        '**/*.d.ts',
        '**/types.ts',
      ],
      thresholds: {
        lines: 90,
        statements: 90,
      },
    },
  },
});