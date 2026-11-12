# Changelog

## 1.0.0 — 12/11/2026

Bản hoàn thiện để nộp và chia sẻ online.

### Thêm
- **Thiết bị:** quét đèn mới bằng radar mô phỏng (cường độ tín hiệu, firmware, kiểu OOB), thêm vào phòng có đặt tên, nháy nhận diện (Health Attention), đổi tên, chuyển phòng (Config Model Subscription Overwrite), xoá khỏi mạng (Config Node Reset); thử Bluetooth thật qua Web Bluetooth.
- **Điều khiển thử:** 8 loại lệnh, đích là một đèn / một phòng / toàn nhà, xem trước gói tin, chạy lặp tới 200 lần, đo độ trễ một chiều và khứ hồi, kết luận Đạt / Chưa đạt, 4 bài thử nhanh.
- **Cài đặt:** chủ đề theo hệ thống, tên và địa chỉ gateway, TTL, mục tiêu độ trễ, nhịp gửi slider, thời gian nháy, môi trường mô phỏng; sao lưu / khôi phục ra file; khôi phục mặc định.
- **Cài như ứng dụng (PWA):** manifest, biểu tượng, service worker chạy offline.
- Hộp hướng dẫn lần đầu; menu **Thêm** trên điện thoại cho các màn hình kỹ thuật.
- API: `POST /lights/:id/identify`, `DELETE /lights/:id`; lệnh cURL theo địa chỉ gateway trong Cài đặt.
- Deploy tự động lên GitHub Pages bằng GitHub Actions (chạy test trước).

### Sửa
- Thống kê tách **độ trễ một chiều** (so với mục tiêu 50 ms) khỏi **khứ hồi** của lệnh có Ack. Trước đây gộp chung nên stress test chỉ đạt 90 % dưới 50 ms.
- Đổi nhãn jitter thành "IPDV trung bình" cho đúng cách tính (không phải bộ lọc RFC 3550).
- Chế độ Sáng: bóng đèn và thanh màu có viền, không còn lẫn vào nền trắng; thanh điều hướng mobile theo màu chủ đề.
- Console API: nhãn phương thức và đường dẫn nằm sát nhau.
- ID đèn mới không bị trùng sau khi xoá đèn.

## 0.2.0 — 06/10/2026
Sơ đồ mặt bằng nhà, API Gateway mô phỏng, đo jitter và khứ hồi, chế độ sáng/tối.

## 0.1.0 — 02/10/2026
MVP đầu tiên: trang chủ, chi tiết đèn, cảnh, mạng mesh, nhật ký gói tin.
