import { defineConfig, devices } from '@playwright/test';

// Test E2E theo kịch bản khách hàng. Trang được phục vụ thẳng từ thư mục dự án qua page.route
// (xem tests/e2e/fixtures.mjs), không cần chạy web server.
// Dùng Google Chrome đã cài sẵn (trên máy và trên GitHub Actions ubuntu-24.04), không cần tải Chromium.
const channel = 'chrome';

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
