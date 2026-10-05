import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './browser-tests',
  timeout: 60000,
  expect: { timeout: 15000 },
  workers: 1,
  retries: 0,
  reporter: [['list'], ['json', { outputFile: 'test-results/browser-results.json' }]],
  projects: [
    { name: 'chromium', testIgnore: /p1-native-visibility\.spec\.ts/, use: { browserName: 'chromium', launchOptions: { args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] } } },
    // Linux WebKit has no WebGL in this runner: this project tests the DOM editors.
    { name: 'webkit-ui', testMatch: /(p1-(settings|independent-ui)|throttle-lever)\.spec\.ts/, use: { browserName: 'webkit' } },
    { name: 'chromium-headed', testMatch: /p1-native-visibility\.spec\.ts/, use: { browserName: 'chromium', headless: false,
      launchOptions: { args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] } } },
  ],
  use: {
    baseURL: 'http://127.0.0.1:4177',
    viewport: { width: 393, height: 852 },
    hasTouch: true,
    deviceScaleFactor: 1,
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
  webServer: { command: 'npm run dev', url: 'http://127.0.0.1:4177', reuseExistingServer: !process.env.CI, timeout: 30000 },
});
