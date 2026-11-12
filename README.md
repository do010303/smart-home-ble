# HomeMesh — Smart Lighting qua BLE Mesh

**Dùng thử online:** https://do010303.github.io/smart-home-ble/ — mở trên máy tính hoặc điện thoại, không cần cài đặt.

Web app (cài được như ứng dụng điện thoại) cho hệ thống chiếu sáng thông minh:

- Đèn LED **12 W / 18 W**, nhiệt độ màu **2700 K – 6500 K**, thanh trượt hiển thị dải màu thật
- **Driver + Gateway** vào mạng nhà, toàn hệ thống chạy **BLE Mesh**
- Mục tiêu độ trễ **< 50 ms** (điều khiển local-first)

## Chức năng demo

| Màn hình | Nội dung |
| --- | --- |
| Trang chủ | Bật/tắt, độ sáng, màu cho từng đèn và cả phòng (1 gói group) |
| Sơ đồ nhà | Mặt bằng 4 phòng có **nội thất** (giường, bếp, sofa, bàn làm việc…), phòng tối dần khi tắt đèn; **mô hình 3D** xoay được, mỗi đèn chiếu sáng thật theo màu và độ sáng; bật/tắt ngay trên bản vẽ, công suất theo phòng |
| Thiết bị | **Quét** đèn mới (radar, cường độ tín hiệu), **thêm** vào phòng qua provisioning 7 bước, **nháy nhận diện**, **đổi tên / chuyển phòng / xoá** khỏi mạng; thử **Bluetooth thật** của máy qua Web Bluetooth |
| Chi tiết đèn | Slider gradient 2700–6500 K, preset, PWM kênh ấm/lạnh, công suất, gói tin hex, nháy nhận diện |
| Cảnh | 6 cảnh, gọi cho toàn nhà hoặc từng phòng (Scene Recall) |
| Điều khiển thử | Soạn lệnh (8 loại: OnOff, Lightness, CTL, quét màu, Scene, Get, Identify…), chọn đích đèn / phòng / toàn nhà, **xem trước gói tin**, chạy lặp tới 200 lần, đo độ trễ một chiều và khứ hồi, kết luận Đạt / Chưa đạt; 4 bài thử nhanh |
| Mạng Mesh | Sơ đồ topology có hiệu ứng lan gói, độ trễ **một chiều** (so với mục tiêu) tách riêng với **khứ hồi** (lệnh có Ack), jitter, stress test, ping, mô phỏng mất gateway |
| API Gateway | Console REST v1 (GET, PUT, POST, DELETE), lệnh cURL theo địa chỉ gateway trong Cài đặt, gọi được từ DevTools qua `window.HomeMeshAPI` |
| Nhật ký | Access message thật (opcode, payload little-endian, segment, TTL), xuất JSON |
| Cài đặt | Chủ đề Sáng / Tối / theo hệ thống; tên và IP gateway; TTL, mục tiêu độ trễ, nhịp gửi slider, môi trường mô phỏng; sao lưu / khôi phục ra file; khôi phục mặc định; cài làm ứng dụng; sao chép link chia sẻ |

Có 3 đường truyền để so sánh: **LAN** (gateway), **BLE** (GATT Proxy), **Cloud**.

## Hướng dẫn nhanh

1. Mở link dùng thử. Lần đầu sẽ có hộp hướng dẫn ngắn.
2. **Trang chủ** → bấm một đèn → kéo thanh **Nhiệt độ màu** để thấy đèn đổi từ vàng ấm sang trắng.
3. **Sơ đồ nhà** → bấm **3D** → kéo để xoay căn hộ, click một đèn trên trần để bật/tắt.
4. **Thiết bị** → **Bắt đầu quét** → bấm **Thêm** ở một đèn tìm thấy → đặt tên, chọn phòng → **Bắt đầu provisioning**.
5. **Điều khiển thử** → chọn đích và lệnh → **Chạy thử** → xem độ trễ có đạt dưới 50 ms không.
6. **Cài đặt** → đổi TTL xuống 2 để thấy các đèn ở xa 3 hop bị cảnh báo vượt tầm.

Dữ liệu (đèn đã thêm, cài đặt) lưu trong trình duyệt của từng người — mỗi người mở link có một "ngôi nhà" riêng, không ảnh hưởng nhau.

### Cài như ứng dụng điện thoại

- **Android (Chrome):** mở link → menu ⋮ → **Cài đặt ứng dụng** / **Thêm vào màn hình chính**. Hoặc vào **Cài đặt → Cài làm ứng dụng**.
- **iPhone (Safari):** mở link → nút Chia sẻ → **Thêm vào MH chính**.

Sau khi cài, app mở toàn màn hình và vẫn chạy khi mất mạng.

> Tầng BLE Mesh được **mô phỏng** (chưa cần phần cứng). Gói tin được mã hoá đúng đặc tả SIG Mesh Model; độ trễ và Jitter lấy từ mô hình trong `js/mesh.js`, cần đo lại trên phần cứng thật.

## Cấu trúc

```text
smart-home-ble/
├── index.html
├── css/style.css
├── js/
│   ├── app.js        # state, điều hướng, điều khiển đèn, các màn hình gốc
│   ├── api.js        # REST API Gateway mô phỏng + window.HomeMeshAPI
│   ├── cct.js        # màu & driver (Kelvin → RGB, trộn PWM, công suất)
│   ├── mesh.js       # gói tin BLE Mesh, mô hình độ trễ một chiều / khứ hồi, jitter
│   ├── data.js       # phòng, đèn, toạ độ mặt bằng, cảnh, thiết bị quét được
│   ├── scanner.js    # lịch quét mô phỏng, cường độ tín hiệu, Web Bluetooth
│   ├── testbench.js  # mã hoá lệnh cho màn hình Điều khiển thử
│   ├── settings.js   # cài đặt mặc định, kiểm tra hợp lệ, sao lưu / khôi phục
│   ├── vendor/three.module.min.js  # Three.js r160 (MIT) cho mô hình 3D
│   └── ui/
│       ├── furniture2d.js # nội thất & sàn trên sơ đồ 2D
│       ├── floorplan3d.js # mô hình 3D căn hộ, đèn chiếu sáng thật
│       ├── devices.js    # màn hình Thiết bị
│       ├── testbench.js  # màn hình Điều khiển thử
│       └── settings.js   # màn hình Cài đặt
├── assets/           # biểu tượng ứng dụng
├── manifest.webmanifest  # khai báo PWA (cài như app)
├── sw.js             # service worker: dùng offline
├── .github/workflows/deploy.yml  # chạy test rồi đưa lên GitHub Pages
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

29 test: màu & PWM, mã hoá gói tin (gồm Health Attention, Node Reset, Subscription Overwrite), độ trễ một chiều / khứ hồi, quét thiết bị, cài đặt và sao lưu, lệnh điều khiển thử, API, vị trí nội thất.

Test thủ công: `docs/TEST_CASES.md`.

## Deploy (GitHub Pages)

Mỗi lần push lên `main`, GitHub Actions ([deploy.yml](.github/workflows/deploy.yml)) chạy unit test; test đạt thì đẩy bản mới sang nhánh `gh-pages` và trang online tự cập nhật sau khoảng 1 phút.

Thiết lập một lần (nếu link còn báo 404): repo → **Settings → Pages** → Source **Deploy from a branch** → Branch **`gh-pages`** / **`/ (root)`** → **Save**.

Khi phát hành bản mới có đổi file, tăng `CACHE` trong `sw.js` để máy đã cài app nhận bản mới ngay.

## Lộ trình sau MVP

1. **Phần cứng mẫu:** 1 gateway (ESP32-S3 + nRF52840) + 3–5 driver nRF52832, đo độ trễ thật.
2. Thay `transmit()` trong `js/app.js` bằng WebSocket tới gateway.
3. App Flutter + Nordic nRF Mesh Library (provisioning, GATT proxy).
4. Backend NestJS + MQTT cho điều khiển từ xa, lịch hẹn giờ.
5. Mesh DFU cập nhật firmware đèn.
