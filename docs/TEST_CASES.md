# Test cases — HomeMesh MVP

## Tự động

```bash
node tests/model_test.mjs
```

Kiểm tra: giới hạn Kelvin, màu 2700/6500 K, trộn kênh PWM, công suất không đổi khi đổi màu, lightness perceptual → linear, mã hoá opcode/payload, số segment, TID, topology ≤ 3 hop, worst-case LAN 3 hop < 50 ms, cloud > 50 ms, độ trễ group, thống kê.

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
