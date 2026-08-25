import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    coverage: {
      provider: 'v8',
      include: ['src/**/*.{ts,tsx}'],
      // Electron and browser entry points cannot be instantiated by the test
      // runner. They are covered by docs/manual-test-matrix.md instead.
      exclude: ['src/main/index.ts', 'src/preload/index.ts', 'src/renderer/main.tsx'],
      reporter: ['text', 'lcov'],
      // A ratchet set just under the measured numbers, not a target. Raise it
      // when coverage rises; never lower it to make a change fit.
      thresholds: { statements: 72, branches: 70, functions: 72, lines: 72 }
    }
  }
});
