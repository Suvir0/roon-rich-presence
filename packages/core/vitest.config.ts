import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      reporter: ['text', 'lcov'],
      // A ratchet set just under the measured numbers, not a target. Raise it
      // when coverage rises; never lower it to make a change fit.
      thresholds: { statements: 95, branches: 88, functions: 92, lines: 95 }
    }
  }
});
