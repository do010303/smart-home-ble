import { test as base, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

// Phục vụ file của dự án cho http://localhost:4173 ngay trong trình duyệt test (không cần server).
const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const TYPES = {
  '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json',
  '.png': 'image/png', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json'
};

export const test = base.extend({
  page: async ({ page }, use) => {
    await page.route('http://localhost:4173/**', async (route) => {
      const url = new URL(route.request().url());
      const rel = normalize(decodeURIComponent(url.pathname)).replace(/^[/\\]+/, '') || 'index.html';
      try {
        const body = await readFile(join(ROOT, rel));
        await route.fulfill({ status: 200, contentType: TYPES[extname(rel)] ?? 'application/octet-stream', body });
      } catch {
        await route.fulfill({ status: 404, body: 'not found' });
      }
    });
    await page.route(/fonts\.(googleapis|gstatic)\.com/, (route) => route.abort());  // không phụ thuộc mạng ngoài
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await use(page);
    expect(errors, 'không có lỗi JavaScript').toEqual([]);
  }
});
export { expect };

export const DEMO = { email: 'demo@homemesh.vn', password: 'homemesh123' };

// Đăng nhập tài khoản demo, bỏ qua hộp hướng dẫn.
export async function loginDemo(page, path = 'index.html?nowelcome') {
  await page.goto(path);
  await expect(page).toHaveURL(/login\.html/);
  await page.getByRole('button', { name: 'Điền sẵn' }).click();
  await page.locator('#pane-login').getByRole('button', { name: 'Đăng nhập' }).click();
  await expect(page).toHaveURL(/index\.html/);
  await expect(page.locator('#account-btn')).toBeVisible();
}

// Toạ độ trên sơ đồ (0–100) → toạ độ màn hình.
export async function mapPoint(page, x, y) {
  return page.locator('#floorplan-svg').evaluate((svg, [px, py]) => {
    const m = svg.getScreenCTM();
    return { x: m.a * px + m.e, y: m.d * py + m.f };
  }, [x, y]);
}

export async function dragOnMap(page, from, to) {  // Kéo chuột từ điểm sơ đồ này sang điểm khác
  const a = await mapPoint(page, from.x, from.y);
  const b = await mapPoint(page, to.x, to.y);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(b.x, b.y, { steps: 12 });
  await page.mouse.up();
}

export const roomNames = (page) => page.locator('#rooms .room-card h3').allTextContents();
