import {defineConfig} from 'vitest/config';
import {playwright} from '@vitest/browser-playwright';

export default defineConfig({
  test: {
    coverage: {
      enabled: true,
      include: ['src/*.ts'],
      reporter: ['text', 'lcov'],
      provider: 'istanbul',
    },
    projects: [
      {
        test: {
          include: ['test/*.test.ts'],
          name: 'node',
          globals: true,
          environment: 'node',
        },
      },
      {
        test: {
          name: 'browser',
          include: ['test/*.test.ts', '!test/node.test.ts'],
          browser: {
            provider: playwright(),
            enabled: true,
            headless: true,
            instances: [
              {browser: 'chromium'},
              {browser: 'firefox'},
              {browser: 'webkit'},
            ],
          },
        },
      },
    ],
  },
});
