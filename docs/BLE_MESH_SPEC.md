# Đặc tả BLE Mesh — HomeMesh MVP

## 1. Cấu hình mạng

| Tham số | Giá trị | Ghi chú |
|---|---|---|
| NetKey | 1 (index 0) | Sinh ngẫu nhiên khi tạo nhà |
| AppKey | 1 (index 0) bind cho mọi model đèn | |
| Default TTL | **3** | Giới hạn 3 hop cho mục tiêu < 50 ms |
| Network Transmit | count 2, interval 10 ms | |
| Relay Retransmit | count 1, interval 10 ms | Chỉ bật trên node được chọn làm relay |
| Scan (node đèn) | 100 % duty | Nguồn điện lưới |
| Proxy feature | Bật trên node relay | Cho đường BLE GATT Proxy |
| Heartbeat | Publish mỗi 60 s tới gateway | Phát hiện offline |

## 2. Quy hoạch địa chỉ

| Dải | Dùng cho |
|---|---|
| `0x0001` | Gateway (provisioner) |
| `0x0002` – `0x00FF` | Đèn (unicast, mỗi đèn 1 element) |
| `0x0100` – `0x01FF` | App điện thoại (khi làm provisioner phụ) |
| `0xC000` | Group **Tất cả đèn** |
| `0xC001` – `0xC0FE` | Group theo phòng (Phòng khách `0xC001`, Phòng ngủ `0xC002`, Bếp `0xC003`, Phòng làm việc `0xC004`, …) |
| `0xC0FF` | Group giám sát: đèn publish Status về đây |

## 3. Composition của node đèn

Element 0 (primary):

| Model | ID | Vai trò |
|---|---|---|
| Configuration Server | 0x0000 | Bắt buộc |
| Health Server | 0x0002 | Báo lỗi (quá nhiệt, lỗi driver) |
| Generic OnOff Server | 0x1000 | Bật/tắt |
| Generic Default Transition Time Server | 0x1004 | Thời gian fade mặc định |
| Generic Power OnOff Server | 0x1006 | Hành vi khi có điện lại (khôi phục / luôn bật) |
| Light Lightness Server | 0x1300 | Độ sáng |
| Light CTL Server | 0x1303 | Độ sáng + nhiệt độ màu |
| Light CTL Setup Server | 0x1304 | Đặt dải 2700–6500 K |
| Scene Server / Setup Server | 0x1203 / 0x1204 | Lưu & gọi cảnh |

Element 1: **Light CTL Temperature Server** (0x1306) — theo spec, Temperature nằm ở element thứ 2.

Gateway: Configuration Client, Generic OnOff Client, Light CTL Client, Scene Client.

## 4. Các message dùng trong MVP

| Message | Opcode | Tham số | Access payload | Segment |
|---|---|---|---:|---:|
| Generic OnOff Get | `82 01` | — | 2 B | 1 |
| Generic OnOff Set | `82 02` | OnOff(1) TID(1) [Trans(1) Delay(1)] | 4 B | 1 |
| Generic OnOff Set Unack | `82 03` | như trên | 4 B | 1 |
| Light Lightness Set Unack | `82 4D` | Lightness(2) TID(1) | 5 B | 1 |
| Scene Recall | `82 42` | Scene(2) TID(1) | 5 B | 1 |
| Scene Recall Unack | `82 43` | như trên | 5 B | 1 |
| Light CTL Set | `82 5E` | Lightness(2) Temp(2) ΔUV(2) TID(1) | 9 B | 1 |
| Light CTL Set Unack | `82 5F` | như trên | 9 B | 1 |
| Light CTL Temperature Range Set | `82 6B` | Min(2) Max(2) | 6 B | 1 |

Ví dụ (đúng như demo hiển thị ở tab Nhật ký):

```text
Light CTL Set Unack, lightness 100 %, 4000 K, TID 7
82 5F | FF FF | A0 0F | 00 00 | 07
 op    L=65535  T=4000  ΔUV=0  TID
```

Mọi giá trị đa byte là **little-endian**. Access payload tối đa 11 byte → 1 gói unsegmented.

## 5. Driver: từ message tới PWM

1. **Lightness** trong mesh là thang *cảm nhận* (perceptual). Chuyển sang tuyến tính:
   `Linear = Actual² / 65535` (50 % trên slider ≈ 25 % công suất — đúng với cảm nhận mắt).
2. **Trộn 2 kênh theo mired** (`M = 10⁶ / K`), mượt hơn trộn tuyến tính theo Kelvin:

   ```text
   r_cool = (M_warm − M) / (M_warm − M_cool)       M_warm = 10⁶/2700, M_cool = 10⁶/6500
   duty_warm = Linear × (1 − r_cool)
   duty_cool = Linear × r_cool
   ```

   Tổng `duty_warm + duty_cool = Linear` → **đổi màu không đổi công suất / độ sáng**.
3. Giới hạn dòng theo công suất định mức 12 W hoặc 18 W (tham số lưu trong flash của driver).
4. PWM ≥ 3 kHz (khuyến nghị ≥ 20 kHz), độ phân giải ≥ 12 bit để dim mượt ở mức thấp.
5. Khi nhận lệnh trong lúc đang kéo slider (Unack liên tục), dùng transition 0 ms; lệnh chốt (Ack) cho phép fade 200 ms.

Code tham khảo: `js/cct.js` — `cctToChannels()`, `lightnessActualToLinear()`.

## 6. Bảo mật

- Toàn bộ message mã hoá 2 lớp: NetKey (network) + AppKey (application), AES-CCM.
- Provisioning dùng ECDH P-256 + **Static OOB** (mã in trên QR của driver) → chống người lạ chiếm đèn.
- Key Refresh Procedure khi xoá một thiết bị khỏi mạng (tránh thiết bị cũ còn giữ khoá).
- IV Update theo spec khi sequence number gần tràn.
