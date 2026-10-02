# Luồng hoạt động — HomeMesh MVP

Các sơ đồ dùng Mermaid (GitHub hiển thị trực tiếp). Mỗi luồng đều chạy được trong demo.

## 1. Onboarding lần đầu

```mermaid
flowchart TD
  A[Mở app] --> B{Đã có tài khoản?}
  B -- Chưa --> C[Đăng ký / đăng nhập]
  B -- Rồi --> D
  C --> D[Tạo Nhà + đặt tên phòng]
  D --> E[Cắm Gateway, bật Bluetooth trên điện thoại]
  E --> F[App tìm Gateway qua BLE → gửi SSID/mật khẩu Wi-Fi]
  F --> G[Gateway vào Wi-Fi, đăng ký với Cloud qua MQTT]
  G --> H[Gateway tạo mạng mesh: NetKey, AppKey, IV Index]
  H --> I[Thêm đèn — xem luồng 2]
```

## 2. Provisioning — thêm đèn vào mạng mesh

Demo: tab **Mạng Mesh → + Thêm đèn**.

```mermaid
sequenceDiagram
  autonumber
  actor U as Người dùng
  participant App
  participant GW as Gateway (Provisioner)
  participant L as Đèn mới
  U->>App: Bấm "Thêm đèn"
  App->>GW: scan_start
  L-->>GW: Unprovisioned Device Beacon (UUID)
  GW-->>App: Danh sách thiết bị + RSSI
  U->>App: Chọn đèn + chọn phòng
  App->>GW: provision(uuid, room)
  GW->>L: Provisioning Invite
  L-->>GW: Capabilities (elements, OOB)
  GW->>L: Public Key (ECDH P-256)
  L-->>GW: Public Key
  GW->>L: Confirmation / Random (Static OOB từ QR)
  GW->>L: Provisioning Data (NetKey, Unicast, IV Index)
  L-->>GW: Complete
  GW->>L: Config AppKey Add
  GW->>L: Config Model App Bind (OnOff, Lightness, CTL, Scene)
  GW->>L: Config Subscription Add (group của phòng, 0xC000)
  GW->>L: Config Light CTL Temperature Range Set (2700–6500K)
  GW-->>App: device_added (unicast, room)
  App-->>U: Đèn xuất hiện trong phòng
```

Thời gian mục tiêu: < 10 s mỗi đèn. Hỗ trợ thêm hàng loạt: quét QR nhiều đèn rồi provision tuần tự.

## 3. Điều khiển một đèn (đường LAN, < 50 ms)

Demo: bấm một đèn → kéo **Độ sáng** / **Nhiệt độ màu**.

```mermaid
sequenceDiagram
  autonumber
  actor U as Người dùng
  participant App
  participant GW as Gateway
  participant R as Relay node
  participant L as Đèn đích
  U->>App: Kéo slider 4000K → 2700K
  Note over App: Cập nhật UI ngay (optimistic)<br/>Throttle 1 gói / 60 ms
  loop Trong khi kéo
    App->>GW: WS {op:"ctl", dst:0x0006, k:3100, l:70, ack:false}
    GW->>R: Light CTL Set Unack (adv, TTL 3)
    R->>L: relay (TTL 2)
    Note over L: Cập nhật PWM ấm/lạnh
  end
  U->>App: Thả tay
  App->>GW: WS {…, k:2700, ack:true}
  GW->>R: Light CTL Set
  R->>L: relay
  L-->>R: Light CTL Status
  R-->>GW: relay
  GW-->>App: state {dst:0x0006, k:2700, l:70, rtt_ms:31}
  Note over App: Đối chiếu trạng thái thật,<br/>ghi độ trễ vào thống kê
```

## 4. Điều khiển cả phòng / kịch bản (Scene)

Demo: slider **cả phòng** ở Trang chủ, hoặc tab **Cảnh**.

```mermaid
sequenceDiagram
  participant App
  participant GW as Gateway
  participant G as Group 0xC002 (Phòng ngủ)
  App->>GW: scene_recall(scene=1, dst=0xC002)
  GW->>G: Scene Recall Unack (1 gói duy nhất)
  Note over G: Mọi đèn subscribe 0xC002<br/>nhận cùng lúc → đổi đồng thời
```

Scene được **lưu sẵn trong Scene Server của từng đèn** (Scene Store lúc tạo cảnh), nên khi gọi chỉ cần 1 gói 5 byte, dù phòng có bao nhiêu đèn.

## 5. Mất gateway → chuyển BLE Proxy

Demo: tab **Mạng Mesh → tắt "Gateway online"**, rồi điều khiển đèn bình thường.

```mermaid
flowchart LR
  A[Lệnh từ App] --> B{Gateway phản hồi<br/>WebSocket trong 300 ms?}
  B -- Có --> C[Gửi qua LAN]
  B -- Không --> D[Kết nối GATT tới node Proxy<br/>RSSI mạnh nhất]
  D --> E[Gửi Proxy PDU]
  E --> F[Mesh lan tới đèn]
  D --> G[Hiển thị banner:<br/>"Đang điều khiển trực tiếp qua Bluetooth"]
```

## 6. Điều khiển từ xa (Cloud)

```mermaid
sequenceDiagram
  participant App
  participant API as Backend API
  participant MQ as MQTT Broker
  participant GW as Gateway
  App->>API: POST /homes/{id}/lights/{lid}/state (JWT)
  API->>MQ: publish home/{id}/gw/{gw}/cmd
  MQ->>GW: cmd
  GW->>GW: → BLE Mesh (như luồng 3)
  GW->>MQ: publish .../state
  MQ->>API: state
  API-->>App: push (WebSocket / FCM)
```

## 7. Đồng bộ trạng thái

- Mỗi đèn **publish Light CTL Status** tới group `0xC0FF` (group giám sát) khi trạng thái đổi (kể cả do công tắc vật lý).
- Gateway giữ bảng trạng thái mới nhất, đẩy qua WebSocket cho mọi client đang mở và lên MQTT `.../state` (retained).
- App mở lên: nhận snapshot từ gateway (LAN) hoặc Redis (cloud) → không phải hỏi từng đèn.
- Heartbeat mesh mỗi 60 s để phát hiện đèn offline.
