import { defineConfig, type Plugin } from 'vitest/config';
import { WxtVitest } from 'wxt/testing/vitest-plugin';

export default defineConfig({
  // WXT 0.21 ships rolldown-vite typings; vitest bundles rollup-vite typings.
  // The plugin objects are runtime-compatible — only the types disagree.
  plugins: [WxtVitest() as unknown as Plugin[]],
  test: {
    environment: 'happy-dom',
    include: ['tests/unit/**/*.test.ts', 'tests/unit/**/*.test.tsx'],
  },
});
