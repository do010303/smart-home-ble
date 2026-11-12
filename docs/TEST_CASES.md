# Test cases — HomeMesh MVP

## Tự động

```bash
node tests/model_test.mjs
```

29 test: giới hạn Kelvin, màu 2700/6500 K, trộn kênh PWM, công suất không đổi khi đổi màu, lightness perceptual → linear, mã hoá opcode/payload (gồm Health Attention, Config Node Reset, Subscription Overwrite), số segment, TID, topology ≤ 3 hop, worst-case LAN 3 hop < 50 ms, cloud > 50 ms, độ trễ group, độ trễ một chiều tách khỏi khứ hồi, hệ số tải mạng, thống kê và jitter, mặt bằng nhà, API (GET/PUT, cURL, DELETE, identify), cài đặt hợp lệ, sao lưu/khôi phục, lịch quét thiết bị, Web Bluetooth, lệnh điều khiển thử, nội thất nằm trong phòng.

## Thủ công

| # | Bước | Kết quả mong đợi |
|---|---|---|
| 1 | Mở trang | 4 phòng, 8 đèn, gateway Online |
| 2 | Tắt 1 đèn ở Trang chủ | Thẻ mờ, bóng tắt, pill hiện ms, Nhật ký có `Generic OnOff Set` |
| 3 | Mở đèn, kéo Nhiệt độ màu 6500 → 2700 | Bóng đổi dần trắng → vàng; PWM lạnh về 0 %, PWM ấm tăng |
| 4 | Kéo Độ sáng xuống 50 % | Công suất ước tính ≈ 25 % định mức (thang perceptual) |
| 5 | Bấm preset "Trung tính 4000K" | Slider nhảy về 4000 K, chip được chọn |
| 6 | Kéo slider "Màu cả phòng" | Nhật ký: gói tới địa chỉ group `0xC00x (n)`, không phải n gói |
| 7 | Tab Cảnh → "Thư giãn" | Mọi đèn 2700 K 35 %, gói `Scene Recall Unack` |
| 8 | Tab Mạng Mesh → Stress test | ≥ 95 % lệnh < 50 ms, P95 < 50 ms ở chế độ LAN |
| 9 | Chuyển sang Cloud, gửi lệnh | Pill đỏ (> 50 ms) — minh hoạ vì sao phải local-first |
| 10 | Tắt "Gateway online", gửi lệnh | Toast chuyển BLE Proxy, cột Đường = BLE |
| 11 | + Thêm đèn → chọn thiết bị → Phòng ngủ → Bắt đầu | 7 bước chạy lần lượt, đèn mới xuất hiện trên sơ đồ và Trang chủ |
| 12 | Tải lại trang | Trạng thái đèn, đường truyền, đèn mới vẫn còn (localStorage) |
| 13 | Thu nhỏ còn 390 px | Bottom nav, lưới 2 cột, chi tiết đèn thành bottom sheet |
| 14 | Thiết bị → Bắt đầu quét | Radar quay 6 giây, các đèn mới hiện dần, đèn tín hiệu mạnh hiện trước |
| 15 | Bấm Thêm ở một đèn → đặt tên, chọn phòng → Bắt đầu provisioning | 7 bước chạy lần lượt; đèn có trong bảng Thiết bị, Trang chủ, Sơ đồ nhà; biến mất khỏi danh sách quét |
| 16 | Bảng Thiết bị → Nháy | Đèn nhấp nháy 5 giây ở mọi màn hình, Nhật ký có `Health Attention Set` |
| 17 | Sửa → đổi tên + chuyển phòng | Đèn đổi tên, sang phòng mới; Nhật ký có `Config Model Subscription Overwrite` |
| 18 | Xoá một đèn relay (ví dụ L5) → Xác nhận | Đèn biến mất; đèn con (L6) nối lên node cha, số hop cập nhật |
| 19 | Thiết bị → Tìm thiết bị gần đây (Chrome/Edge, HTTPS) | Hộp chọn Bluetooth của trình duyệt mở ra; Firefox/Safari hiện thông báo không hỗ trợ |
| 20 | Điều khiển thử → đổi lệnh, độ sáng, màu | Ô "Gói tin sẽ gửi" cập nhật hex ngay |
| 21 | Chạy thử 30 lệnh có Ack | Bảng kết quả đủ 30 dòng, có cột khứ hồi; nhãn Đạt nếu P95 một chiều < mục tiêu |
| 22 | Bấm Dừng giữa chừng | Dừng ngay, hiện "Đã dừng" |
| 23 | Cài đặt → TTL = 2 | Gợi ý đỏ "2 đèn ở xa hơn 2 hop"; bảng Thiết bị gắn nhãn "vượt TTL" |
| 24 | Cài đặt → đổi IP gateway | Nav và lệnh cURL ở màn hình API dùng IP mới |
| 25 | Sao lưu ra file → Khôi phục mặc định → Khôi phục từ file | Về 8 đèn mẫu, rồi trở lại đúng danh sách đèn đã sao lưu |
| 26 | Điện thoại 390 px → nút Thêm | Mở bảng 5 màn hình kỹ thuật; không màn hình nào bị tràn ngang |
| 27 | Mở link lần đầu | Hiện hộp hướng dẫn; bấm Bắt đầu thì lần sau không hiện lại |
| 28 | Cài như app (Android Chrome), tắt mạng, mở lại | App mở toàn màn hình, vẫn chạy khi offline |
| 29 | Sơ đồ nhà → tắt Phòng ngủ | Phòng ngủ tối hẳn trên bản 2D, các phòng khác vẫn sáng |
| 30 | Bấm **3D** | Hiện mô hình 3D có nội thất; phòng có đèn bật được chiếu sáng theo màu của đèn |
| 31 | Kéo chuột / cuộn chuột trên mô hình 3D | Căn hộ xoay, phóng to / thu nhỏ; **Góc nhìn** đưa về như cũ |
| 32 | Click một đèn trên trần (3D) | Đèn bật/tắt, phòng sáng/tối theo; click đúp mở bảng chỉnh màu |
| 33 | Kéo Nhiệt độ màu 2700 → 6500 K khi đang xem 3D | Ánh sáng trong phòng đổi từ vàng ấm sang trắng |
| 34 | Tải lại trang | Sơ đồ nhà mở lại đúng kiểu xem 2D / 3D đã chọn |
