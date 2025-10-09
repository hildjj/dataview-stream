import {defineConfig} from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    coverage: {
      enabled: true,
      include: ['src/*.ts'],
      reporter: ['text', 'lcov'],
    },
  },
});
