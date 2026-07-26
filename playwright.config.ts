import { existsSync } from 'node:fs';
import { defineConfig, devices } from '@playwright/test';

const PORT = 5174;

/**
 * This environment ships a pre-provisioned Chromium that will not necessarily
 * match the build @playwright/test expects, and browsers must not be
 * downloaded here. Point at the provided binary when it exists, and fall back
 * to Playwright's own resolution everywhere else (local machines, CI).
 */
const PROVIDED_CHROMIUM = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: true,
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: 'retain-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        launchOptions: {
          // Headless Chromium has no GPU here, so WebGL2 runs on SwiftShader.
          // Newer Chromium requires this flag to allow software WebGL.
          args: ['--enable-unsafe-swiftshader'],
          ...(existsSync(PROVIDED_CHROMIUM) ? { executablePath: PROVIDED_CHROMIUM } : {}),
        },
      },
    },
  ],
  webServer: {
    command: `npm run dev -- --port ${PORT} --strictPort`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: false,
    timeout: 60_000,
  },
});
