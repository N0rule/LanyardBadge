const { defineConfig } = require('@playwright/test');
module.exports = defineConfig({
  testDir: '.',
  testMatch: ['editor.spec.cjs', 'gif.spec.cjs', 'cache.spec.cjs'],
  fullyParallel: true,
  timeout: 30000,
  use: { headless: true },
  reporter: 'list',
  outputDir: '../test-results/browser',
});
