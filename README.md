# HomeMesh MVP — Smart Lighting qua BLE Mesh

Demo và thiết kế MVP cho hệ thống chiếu sáng thông minh (web + app):

- Đèn LED **12 W / 18 W**, nhiệt độ màu **2700 K – 6500 K**, thanh trượt hiển thị dải màu thật
- **Driver + Gateway** vào mạng nhà, toàn hệ thống chạy **BLE Mesh**
- Mục tiêu độ trễ **< 50 ms** (điều khiển local-first)

## Chức năng demo

| Màn hình      | Nội dung                                                                                                                                                   |
| --------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Trang chủ      | Bật/tắt, độ sáng, màu cho từng đèn và cả phòng (1 gói group)                                                                                   |
| Chi tiết đèn | Slider gradient 2700–6500 K, preset, PWM kênh ấm/lạnh, công suất, gói tin hex                                                                        |
| Cảnh           | 6 cảnh, gọi cho toàn nhà hoặc từng phòng (Scene Recall)                                                                                              |
| Mạng Mesh      | Sơ đồ topology có hiệu ứng lan gói, thống kê độ trễ (TB/P95/Max/% < 50 ms), stress test, ping, mô phỏng mất gateway, provisioning đèn mới |
| Nhật ký       | Access message thật (opcode, payload little-endian, segment, TTL), xuất JSON                                                                              |

Có 3 đường truyền để so sánh: **LAN** (gateway), **BLE** (GATT Proxy), **Cloud**.

> Tầng BLE Mesh được **mô phỏng** (chưa cần phần cứng). Gói tin được mã hoá đúng đặc tả SIG Mesh Model; độ trễ lấy từ mô hình giả định trong `js/mesh.js` → `LATENCY_PROFILE`, cần đo lại trên phần cứng thật.

## Cấu trúc

```text
smart-home-ble/
├── index.html
├── css/style.css
├── js/
│   ├── app.js        # UI + state + luồng
│   ├── cct.js        # màu & driver (Kelvin → RGB, trộn PWM, công suất)
│   ├── mesh.js       # gói tin BLE Mesh, mô hình độ trễ, thống kê
│   └── data.js       # phòng, đèn, cảnh mẫu
├── docs/
│   ├── ARCHITECTURE.md   # kiến trúc, stack, ngân sách độ trễ
│   ├── FLOWS.md          # luồng hoạt động (sequence diagram)
│   ├── BLE_MESH_SPEC.md  # địa chỉ, model, opcode, driver PWM
│   ├── UI_UX.md          # màn hình, nguyên tắc, design tokens
│   └── TEST_CASES.md
└── tests/model_test.mjs
```

## Chạy local

Không cần cài package, không cần build. Chỉ cần một web server tĩnh, vì trình duyệt không tải được ES module khi mở `index.html` trực tiếp bằng `file://`.

### 1. Lấy code

```bash
git clone https://github.com/do010303/smart-home-ble.git
cd smart-home-ble
```

### 2. Chạy web server (chọn 1 cách)

**Python 3** (có sẵn trên Linux/macOS):

```bash
python3 -m http.server 8080
```

Trên Windows dùng `python -m http.server 8080`.

**Node.js:**

```bash
npx serve -l 8080
```

**VS Code:** cài extension *Live Server* → chuột phải `index.html` → **Open with Live Server**.

### 3. Mở trình duyệt

Vào `http://localhost:8080` (Chrome, Edge hoặc Firefox bản mới).

- Xem giao diện app mobile: mở DevTools (`F12`) → bật chế độ thiết bị (`Ctrl+Shift+M`) → chọn chiều rộng dưới 760 px.
- Xem trên điện thoại thật cùng Wi-Fi: mở `http://<IP máy tính>:8080`.
- Dừng server: `Ctrl+C` trong terminal.

### Lỗi thường gặp

| Hiện tượng | Nguyên nhân và cách xử lý |
| --- | --- |
| Trang trắng, Console báo lỗi CORS / module | Đang mở bằng `file://`. Chạy qua web server như bước 2. |
| `Address already in use` | Cổng 8080 đang bị chiếm. Đổi cổng khác, ví dụ `python3 -m http.server 5500`. |
| Trạng thái đèn cũ còn lưu lại | Demo lưu vào `localStorage`. Xoá bằng DevTools → Application → Local Storage → Clear. |

## Test

Cần Node.js 18 trở lên.

```bash
node tests/model_test.mjs
```

Test thủ công: `docs/TEST_CASES.md`.

## Deploy GitHub Pages

Giống bài Hello Calculator: push lên repo → Settings → Pages → Branch `main` / root. File `.nojekyll` đã có sẵn.

## Lộ trình sau MVP

1. **Phần cứng mẫu:** 1 gateway (ESP32-S3 + nRF52840) + 3–5 driver nRF52832, đo độ trễ thật.
2. Thay `transmit()` trong `js/app.js` bằng WebSocket tới gateway.
3. App Flutter + Nordic nRF Mesh Library (provisioning, GATT proxy).
4. Backend NestJS + MQTT cho điều khiển từ xa, lịch hẹn giờ.
5. Mesh DFU cập nhật firmware đèn.
