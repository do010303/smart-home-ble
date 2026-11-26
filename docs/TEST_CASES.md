# Test cases — HomeMesh 2.0

Ba lớp kiểm thử, tất cả chạy tự động trong GitHub Actions trước mỗi lần deploy:

| Lớp | Lệnh | Số test | Kiểm gì |
|---|---|---|---|
| Unit — lõi điều khiển | `node tests/model_test.mjs` | 30 | màu & PWM, gói tin BLE Mesh, độ trễ, API, cài đặt, sao lưu |
| Unit — tài khoản | `node tests/auth_test.mjs` | 10 | đăng ký, đăng nhập, khoá 5 lần sai, quên / đổi mật khẩu |
| Unit — thiết kế nhà | `node tests/layout_test.mjs` | 18 | mẫu nhà, chồng phòng, kéo / đổi cỡ, thêm / xoá, đèn đổi phòng, dữ liệu hỏng, hoàn tác |
| E2E — kịch bản khách hàng | `npx playwright test` | 14 kịch bản × 2 thiết bị (máy tính, điện thoại Pixel 5) | xem bảng E01–E14 |

```bash
npm test               # 58 unit test
npx playwright test    # E2E
```

## Unit — thiết kế nhà (`tests/layout_test.mjs`)

| ID | Nội dung | Kết quả |
|---|---|---|
| L01 | 5 mẫu nhà hợp lệ: không chồng phòng, trong khung, đủ lớn, group riêng | Đạt |
| L02 | Mẫu 4 phòng giữ mã phòng & group của bản 1.x → đèn cũ không lạc phòng | Đạt |
| L03 | Phát hiện 2 phòng chồng nhau; chạm cạnh không tính | Đạt |
| L04 | Báo lỗi: 0 phòng, tên trống, < 1,2 m, ngoài khung, loại sai, trùng mã, thiếu kích thước | Đạt |
| L05 | Bắt lưới 0,2 m; diện tích, kích thước theo mét | Đạt |
| L06 | Dời phòng: nội thất đi theo; đè phòng khác / ra khung → từ chối; bản gốc không đổi | Đạt |
| L07 | Đổi cỡ: tối thiểu 1,2 m, không lấn phòng bên, nội thất không vừa bị bỏ | Đạt |
| L08 | Thêm phòng: tìm chỗ trống, tên tự đánh số, group mới; hết chỗ → báo | Đạt |
| L09 | Tối đa 12 phòng | Đạt |
| L10 | Xoá phòng: giữ ≥ 1 phòng, nội thất xoá theo | Đạt |
| L11 | Đổi tên / loại: lọc ký tự HTML, tên trống bị từ chối, giữ dấu & | Đạt |
| L12 | Sau khi sửa sơ đồ, đèn ngoài phòng chuyển vào phòng chứa nó / gần nhất | Đạt |
| L13 | Tìm phòng theo điểm, phòng gần nhất, kéo điểm vào trong phòng | Đạt |
| L14 | Tường chung chỉ vẽ 1 lần; khung bao đúng | Đạt |
| L15 | localStorage hỏng → nhà mẫu; dữ liệu đúng được giữ | Đạt |
| L16 | Mỗi loại phòng ≥ 3 kiểu sáng gợi ý trong 2700–6500 K | Đạt |
| L17 | Hoàn tác / Làm lại, giới hạn bước | Đạt |
| L18 | Sao lưu / khôi phục kèm sơ đồ; file 1.x vẫn đọc được; sơ đồ lỗi bị từ chối | Đạt |

## E2E — kịch bản khách hàng (`tests/e2e/customer.spec.mjs`)

| ID | Kịch bản | Kết quả mong đợi | Máy tính | Điện thoại |
|---|---|---|---|---|
| E01 | Mở `?view=devices` khi chưa đăng nhập | Sang trang đăng nhập; đăng nhập xong mở đúng Thiết bị | Đạt | Đạt |
| E02 | Khách mới đăng ký → hướng dẫn → chọn mẫu Studio | 3 phòng đúng tên, đủ 8 đèn, avatar "KM" | Đạt | Đạt |
| E03 | Mẫu "Tự vẽ từ đầu" → thêm phòng ngủ → đổi tên → xoá → hoàn tác | Phòng xuất hiện, đổi tên, mất, rồi quay lại | Đạt | Đạt |
| E04 | Kéo phòng ngủ đè lên phòng khách | Viền đỏ khi kéo, thả ra phòng không đổi | Đạt | — (kéo chuột) |
| E05 | Kéo ô góc phòng ngủ để thu nhỏ | Hiện "3,4 × 3,6 m" | Đạt | — |
| E06 | Kéo đèn L1 từ phòng khách sang phòng ngủ | Thông báo "sang Phòng ngủ", phòng ngủ có 3 đèn | Đạt | — |
| E07 | Chọn "Xem TV", tắt toàn nhà, tải lại trang | Vẫn 0/8 đèn bật, sơ đồ giữ nguyên | Đạt | Đạt |
| E08 | Bấm 3D | Có mô hình 3D, hoặc tự về 2D nếu máy không có WebGL | Đạt | Đạt |
| E09 | Đăng nhập, Nhà, Sửa sơ đồ, Cài đặt | Không trang nào tràn ngang | Đạt | Đạt |
| E10 | Sao lưu ra file | File JSON có `layout` 4 phòng và 8 đèn | Đạt | Đạt |
| E11 | Đặt tên phòng `<img src=x onerror=alert(1)>` | Hiện như chữ, không có thẻ `<img>` nào | Đạt | Đạt |
| E12 | Quên mật khẩu → mã 6 số → mật khẩu mới | Vào được app | Đạt | Đạt |
| E13 | Đăng xuất, mở lại app | Về đăng nhập, báo "Bạn đã đăng xuất.", app vẫn bị chặn | Đạt | Đạt |
| E14 | Ghi dữ liệu sơ đồ hỏng vào localStorage, tải lại | App vẫn mở với căn hộ mẫu | Đạt | Đạt |

Mọi kịch bản còn kiểm: **không có lỗi JavaScript** nào trong lúc chạy.

## Thủ công

| # | Bước | Kết quả mong đợi |
|---|---|---|
| 1 | Mở trang | 4 phòng, 8 đèn, gateway Online |
| 2 | Nhà của tôi → mở "2 đèn trong phòng" → tắt 1 đèn | Thẻ mờ, bóng tắt, pill hiện ms, Nhật ký có `Generic OnOff Set` |
| 3 | Mở đèn, kéo Nhiệt độ màu 6500 → 2700 | Bóng đổi dần trắng → vàng; PWM lạnh về 0 %, PWM ấm tăng |
| 4 | Kéo Độ sáng xuống 50 % | Công suất ước tính ≈ 25 % định mức (thang perceptual) |
| 5 | Bấm preset "Trung tính 4000K" | Slider nhảy về 4000 K, chip được chọn |
| 6 | Kéo thanh "Màu ánh sáng" của một phòng | Nhật ký: gói tới địa chỉ group `0xC00x (n)`, không phải n gói |
| 7 | Tab Cảnh → "Thư giãn" | Mọi đèn 2700 K 35 %, gói `Scene Recall Unack` |
| 8 | Cài đặt → Mạng & gateway → Mạng Mesh → Thử tải 100 lệnh | ≥ 95 % lệnh < 50 ms, P95 < 50 ms ở chế độ LAN |
| 9 | Chuyển sang Cloud, gửi lệnh | Pill đỏ (> 50 ms) — minh hoạ vì sao phải local-first |
| 10 | Tắt "Gateway online", gửi lệnh | Toast chuyển BLE Proxy, cột Đường = BLE |
| 11 | + Thêm đèn → chọn thiết bị → Phòng ngủ → Bắt đầu | 7 bước chạy lần lượt, đèn mới xuất hiện trên sơ đồ và Trang chủ |
| 12 | Tải lại trang | Trạng thái đèn, đường truyền, đèn mới vẫn còn (localStorage) |
| 13 | Thu nhỏ còn 390 px | Thanh dưới 4 mục, sơ đồ trên, thẻ phòng dưới, chi tiết đèn thành bottom sheet |
| 14 | Thiết bị → Bắt đầu quét | Radar quay 6 giây, các đèn mới hiện dần, đèn tín hiệu mạnh hiện trước |
| 15 | Bấm Thêm ở một đèn → đặt tên, chọn phòng → Bắt đầu provisioning | 7 bước chạy lần lượt; đèn có trong bảng Thiết bị, Trang chủ, Sơ đồ nhà; biến mất khỏi danh sách quét |
| 16 | Bảng Thiết bị → Nháy | Đèn nhấp nháy 5 giây ở mọi màn hình, Nhật ký có `Health Attention Set` |
| 17 | Sửa → đổi tên + chuyển phòng | Đèn đổi tên, sang phòng mới; Nhật ký có `Config Model Subscription Overwrite` |
| 18 | Xoá một đèn relay (ví dụ L5) → Xác nhận | Đèn biến mất; đèn con (L6) nối lên node cha, số hop cập nhật |
| 19 | Thiết bị → Tìm thiết bị gần đây (Chrome/Edge, HTTPS) | Hộp chọn Bluetooth của trình duyệt mở ra; Firefox/Safari hiện thông báo không hỗ trợ |
| 23 | Cài đặt → TTL = 2 | Gợi ý đỏ "2 đèn ở xa hơn 2 hop"; bảng Thiết bị gắn nhãn "vượt TTL" |
| 24 | Cài đặt → đổi IP gateway | Ô gateway ở thanh bên và dòng "Địa chỉ API" khi Kiểm tra dùng IP mới |
| 25 | Sao lưu ra file → Khôi phục mặc định → Khôi phục từ file | Về 8 đèn mẫu, rồi trở lại đúng danh sách đèn đã sao lưu |
| 26 | Điện thoại 390 px → mở lần lượt 8 màn hình | Không màn hình nào bị tràn ngang |
| 27 | Mở link lần đầu | Hiện hộp hướng dẫn; bấm Bắt đầu thì lần sau không hiện lại |
| 28 | Cài như app (Android Chrome), tắt mạng, mở lại | App mở toàn màn hình, vẫn chạy khi offline |
| 29 | Sơ đồ nhà → tắt Phòng ngủ | Phòng ngủ tối hẳn trên bản 2D, các phòng khác vẫn sáng |
| 30 | Bấm **3D** | Hiện mô hình 3D có nội thất; phòng có đèn bật được chiếu sáng theo màu của đèn |
| 31 | Kéo chuột / cuộn chuột trên mô hình 3D | Căn hộ xoay, phóng to / thu nhỏ; **Góc nhìn** đưa về như cũ |
| 32 | Click một đèn trên trần (3D) | Đèn bật/tắt, phòng sáng/tối theo; click đúp mở bảng chỉnh màu |
| 33 | Kéo Nhiệt độ màu 2700 → 6500 K khi đang xem 3D | Ánh sáng trong phòng đổi từ vàng ấm sang trắng |
| 34 | Tải lại trang | Sơ đồ nhà mở lại đúng kiểu xem 2D / 3D đã chọn |
| 35 | Nhà của tôi → Phòng khách → **Đón khách** | Cả phòng 5000 K 100 %, nút Đón khách được tô; sơ đồ sáng theo |
| 36 | Bấm tên phòng "Phòng làm việc" trên sơ đồ 2D | Thẻ Phòng làm việc được viền cam và cuộn tới |
| 37 | Kéo thanh độ sáng của 1 đèn trong danh sách đèn | Chỉ đèn đó đổi, thẻ phòng cập nhật công suất |
| 38 | Cài đặt → Mạng & gateway → **Kiểm tra MAC & API** | 5 dòng ✓: địa chỉ API, MAC, REST API 200 OK, 8/8 node, độ trễ < 50 ms |
| 39 | Nhập MAC sai (ví dụ `12:34`) | Báo "Giá trị không hợp lệ — giữ nguyên" |
| 40 | Mạng & gateway → Mạng Mesh → **← Cài đặt** | Quay lại Cài đặt; thanh điều hướng luôn tô mục Cài đặt |
| 41 | Mở `?view=test` hoặc `?view=api` | Tự mở Nhà của tôi (2 màn hình này đã gỡ) |
| 42 | Mở web khi chưa đăng nhập (`?view=devices`) | Chuyển sang trang đăng nhập; đăng nhập xong mở đúng Thiết bị |
| 43 | Đăng nhập sai mật khẩu 5 lần | Báo số lần còn lại; lần 5 khoá 5 phút |
| 44 | Quên mật khẩu → nhập email demo → nhập mã trong hộp thư giả lập + mật khẩu mới | Đăng nhập luôn; mật khẩu cũ không còn dùng được |
| 45 | Nhập sai mã khôi phục | Báo "Mã không đúng (còn 4 lần)"; nút Gửi lại khoá 30 giây |
| 46 | Đăng ký mật khẩu `abc` | Báo "Mật khẩu cần ít nhất 8 ký tự" |
| 47 | Cài đặt → Tài khoản → Đổi mật khẩu với mật khẩu hiện tại sai | Báo lỗi ngay ô Mật khẩu hiện tại |
| 48 | Đăng xuất | Về trang đăng nhập, hiện "Bạn đã đăng xuất."; trạng thái đèn vẫn giữ |
| 49 | Sửa sơ đồ trên điện thoại: chạm giữ rồi kéo phòng / đèn | Phòng, đèn đi theo ngón tay, trang không cuộn |
| 50 | Chọn mẫu khác khi đã có đèn | Đèn tự xếp vào phòng gần nhất; Hoàn tác (↶) đưa về sơ đồ cũ |
| 51 | Đang xem 3D, đổi sơ đồ | 3D dựng lại đúng phòng mới |
