import { DEMO, dragOnMap, expect, loginDemo, mapPoint, roomNames, test } from './fixtures.mjs';

// Kịch bản E2E theo góc nhìn khách hàng (mã E01–E14 khớp docs/TEST_CASES.md).

test('E01 Chưa đăng nhập → chuyển sang trang đăng nhập, xong quay lại đúng trang', async ({ page }) => {
  await page.goto('index.html?view=devices&nowelcome');
  await expect(page).toHaveURL(/login\.html\?next=/);
  await page.getByRole('button', { name: 'Điền sẵn' }).click();
  await page.locator('#pane-login').getByRole('button', { name: 'Đăng nhập' }).click();
  await expect(page).toHaveURL(/view=devices/);
  await expect(page.locator('#view-title')).toHaveText('Thiết bị');
});

test('E02 Khách mới: đăng ký → hướng dẫn → chọn mẫu Studio → đèn tự xếp vào phòng', async ({ page }) => {
  await page.goto('login.html#register');
  const f = page.locator('#pane-register');
  await f.locator('[name=name]').fill('Khách Hàng Mới');
  await f.locator('[name=email]').fill('khach@vidu.vn');
  await f.locator('[name=password]').fill('KhachHang2026');
  await f.locator('[name=confirm]').fill('KhachHang2026');
  await f.getByRole('button', { name: 'Tạo tài khoản' }).click();
  await expect(page.locator('#welcome-dialog')).toBeVisible();
  await page.getByRole('button', { name: 'Bắt đầu: chọn sơ đồ nhà' }).click();
  await expect(page.locator('#template-dialog')).toBeVisible();
  await page.locator('[data-template="studio"]').click();
  await expect.poll(() => roomNames(page)).toEqual(['Không gian chính', 'Phòng tắm', 'Bếp']);
  await expect(page.locator('#rooms .light-row')).toHaveCount(8);  // không mất đèn nào
  await expect(page.locator('#account-avatar')).toHaveText('KM');
});

test('E03 Tự vẽ từ đầu: thêm phòng, đổi tên, xoá rồi hoàn tác', async ({ page }) => {
  await loginDemo(page);
  await page.locator('#fp-templates').evaluate((b) => b.click());  // mở hộp mẫu từ thanh công cụ
  await page.locator('[data-template="blank"]').click();
  await expect(page.locator('#fp-editor')).toBeVisible();  // mẫu trống tự mở chế độ sửa
  await expect.poll(() => roomNames(page)).toEqual(['Phòng khách']);

  await page.locator('#fp-add-type').selectOption('bedroom');
  await page.getByRole('button', { name: '+ Thêm phòng' }).click();
  await expect.poll(() => roomNames(page)).toEqual(['Phòng khách', 'Phòng ngủ']);
  await expect(page.locator('#fp-room-form')).toBeVisible();

  await page.locator('#fp-room-name').fill('Phòng bé Na');
  await page.locator('#fp-room-name').press('Enter');
  await page.locator('#fp-room-name').blur();
  await expect.poll(() => roomNames(page)).toContain('Phòng bé Na');

  await page.getByRole('button', { name: 'Xoá phòng' }).click();
  await page.locator('#confirm-ok').click();
  await expect.poll(() => roomNames(page)).toEqual(['Phòng khách']);
  await page.getByRole('button', { name: 'Hoàn tác' }).click();
  await expect.poll(() => roomNames(page)).toContain('Phòng bé Na');
});

test('E04 Kéo phòng đè lên phòng khác bị chặn (viền đỏ), thả ra phòng không đổi', async ({ page, isMobile }) => {
  test.skip(isMobile, 'kéo chuột: kiểm trên máy tính');
  await loginDemo(page);
  await page.getByRole('button', { name: '✏️ Sửa sơ đồ' }).click();
  const before = await page.locator('[data-ed-room="bedroom"] .ed-room-rect').getAttribute('y');
  const a = await mapPoint(page, 30, 30);
  const b = await mapPoint(page, 30, 75);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(b.x, b.y, { steps: 10 });
  await expect(page.locator('#floorplan-svg')).toHaveClass(/ed-blocked/);
  await page.mouse.up();
  await expect(page.locator('[data-ed-room="bedroom"] .ed-room-rect')).toHaveAttribute('y', before);
});

test('E05 Đổi cỡ phòng bằng ô ở góc, kích thước hiện theo mét', async ({ page, isMobile }) => {
  test.skip(isMobile, 'kéo chuột: kiểm trên máy tính');
  await loginDemo(page);
  await page.getByRole('button', { name: '✏️ Sửa sơ đồ' }).click();
  await dragOnMap(page, { x: 46, y: 48 }, { x: 36, y: 38 });  // ô đổi cỡ của phòng ngủ (4..48, 4..50)
  await expect(page.locator('#fp-room-size')).toContainText('3,4 × 3,6 m');
});

test('E06 Kéo đèn sang phòng khác → đèn đổi phòng, có thông báo', async ({ page, isMobile }) => {
  test.skip(isMobile, 'kéo chuột: kiểm trên máy tính');
  await loginDemo(page);
  await page.getByRole('button', { name: '✏️ Sửa sơ đồ' }).click();
  await dragOnMap(page, { x: 26, y: 70 }, { x: 30, y: 30 });  // L1 phòng khách → phòng ngủ
  await expect(page.locator('#toast')).toContainText('sang Phòng ngủ');
  await expect(page.locator('#rooms .room-card[data-room="bedroom"] .room-lights summary')).toHaveText('3 đèn trong phòng');
});

test('E07 Bật/tắt, kiểu sáng; tải lại trang vẫn giữ trạng thái và sơ đồ', async ({ page }) => {
  await loginDemo(page);
  const living = page.locator('#rooms .room-card[data-room="living"]');
  await living.getByRole('button', { name: /Xem TV/ }).click();
  await expect(page.locator('#toast')).toContainText('Xem TV');
  await page.getByRole('button', { name: 'Tắt toàn nhà' }).click();
  await expect(page.locator('#summary')).toContainText('0/8');
  await page.reload();
  await expect(page.locator('#summary')).toContainText('0/8');
  await expect.poll(() => roomNames(page)).toEqual(['Phòng khách', 'Phòng ngủ', 'Bếp & Bàn ăn', 'Phòng làm việc']);
});

test('E08 Xem 3D: dựng mô hình hoặc báo quay về 2D nếu máy không có WebGL', async ({ page }) => {
  await loginDemo(page);
  await page.locator('#fp-mode [data-mode="3d"]').click();
  await expect(async () => {
    const ok = await page.locator('.fp3d-room').count() > 0;
    const fallback = await page.locator('#fp-mode [data-mode="2d"]').getAttribute('aria-checked') === 'true';
    expect(ok || fallback).toBeTruthy();
  }).toPass({ timeout: 15_000 });
});

test('E09 Giao diện không tràn ngang: đăng nhập, nhà, sửa sơ đồ, cài đặt', async ({ page }) => {
  const noOverflow = async () => expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBeTruthy();
  await page.goto('login.html');
  await noOverflow();
  await loginDemo(page);
  await noOverflow();
  await page.getByRole('button', { name: '✏️ Sửa sơ đồ' }).click();
  await noOverflow();
  await page.goto('index.html?view=settings&nowelcome');
  await noOverflow();
});

test('E10 Sao lưu ra file có cả sơ đồ nhà', async ({ page }) => {
  await loginDemo(page, 'index.html?view=settings&nowelcome');
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Sao lưu ra file' }).click();
  const file = await download;
  const data = JSON.parse(await (await file.createReadStream()).toArray().then((c) => Buffer.concat(c).toString()));
  expect(data.format).toBe('homemesh-backup');
  expect(data.layout.rooms).toHaveLength(4);
  expect(data.lights).toHaveLength(8);
});

test('E11 Tên phòng chứa mã HTML chỉ hiện như chữ, không chạy', async ({ page }) => {
  await loginDemo(page);
  await page.getByRole('button', { name: '✏️ Sửa sơ đồ' }).click();
  await page.locator('[data-ed-room="office"] .ed-room-rect').click({ position: { x: 20, y: 60 } });
  await page.locator('#fp-room-name').fill('<img src=x onerror=alert(1)>');
  await page.locator('#fp-room-name').blur();
  await expect(page.locator('#rooms .room-card[data-room="office"] h3')).toHaveText('img src=x onerror=alert(1)');
  await expect(page.locator('#rooms img')).toHaveCount(0);
});

test('E12 Quên mật khẩu: nhận mã, đặt mật khẩu mới, vào được app', async ({ page }) => {
  await page.goto('login.html#forgot');
  await page.locator('#pane-forgot [name=email]').fill(DEMO.email);
  await page.getByRole('button', { name: 'Gửi mã' }).click();
  const code = await page.locator('#mail-code').textContent();
  expect(code).toMatch(/^\d{6}$/);
  const f = page.locator('#pane-reset');
  await f.locator('[name=code]').fill(code);
  await f.locator('[name=password]').fill('MatKhauMoi2026');
  await f.locator('[name=confirm]').fill('MatKhauMoi2026');
  await f.getByRole('button', { name: 'Đặt lại và đăng nhập' }).click();
  await expect(page).toHaveURL(/index\.html/);
});

test('E13 Đăng xuất → về trang đăng nhập, mở lại app vẫn bị chặn', async ({ page }) => {
  await loginDemo(page, 'index.html?view=settings&nowelcome');
  await page.getByRole('button', { name: 'Đăng xuất' }).click();
  await page.locator('#confirm-ok').click();
  await expect(page).toHaveURL(/login\.html\?loggedout/);
  await expect(page.locator('#pane-login .form-alert')).toHaveText('Bạn đã đăng xuất.');
  await page.goto('index.html');
  await expect(page).toHaveURL(/login\.html/);
});

test('E14 Dữ liệu sơ đồ hỏng trong trình duyệt → app vẫn mở với căn hộ mẫu', async ({ page }) => {
  await loginDemo(page);
  await page.evaluate(() => localStorage.setItem('homemesh-layout-v1', '{"rooms":"hỏng'));
  await page.reload();
  await expect.poll(() => roomNames(page)).toEqual(['Phòng khách', 'Phòng ngủ', 'Bếp & Bàn ăn', 'Phòng làm việc']);
});
