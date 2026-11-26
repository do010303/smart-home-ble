import { defineConfig, devices } from '@playwright/test';

// Test E2E theo kịch bản khách hàng. Trang được phục vụ thẳng từ thư mục dự án qua page.route
// (xem tests/e2e/fixtures.mjs), không cần chạy web server.
// Trên máy: dùng Chrome đã cài (channel 'chrome'). Trên CI: Chromium do Playwright tải về.
const channel = process.env.CI ? undefined : 'chrome';

export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 30_000,
  fullyParallel: true,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: { baseURL: 'http://localhost:4173', trace: 'retain-on-failure', serviceWorkers: 'block' },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'], channel } },
    { name: 'mobile', use: { ...devices['Pixel 5'], channel } }
  ]
});
