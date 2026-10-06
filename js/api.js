'use strict';

/**
 * HOMEMESH MVP - API CONTROLLER & SIMULATION
 * Cung cấp giao diện lập trình ứng dụng REST & WebSocket mô phỏng cho Gateway.
 */

export const API_CATALOG = Object.freeze([
  {
    method: 'GET',
    path: '/api/v1/lights',
    description: 'Lấy danh sách tất cả đèn và trạng thái thời gian thực',
    sampleBody: null,
    sampleCurl: 'curl -X GET http://192.168.1.100:8080/api/v1/lights'
  },
  {
    method: 'GET',
    path: '/api/v1/lights/L1',
    description: 'Lấy thông tin chi tiết một đèn theo ID',
    sampleBody: null,
    sampleCurl: 'curl -X GET http://192.168.1.100:8080/api/v1/lights/L1'
  },
  {
    method: 'PUT',
    path: '/api/v1/lights/L1',
    description: 'Điều khiển bật/tắt, độ sáng (%) và nhiệt độ màu (K) của một đèn',
    sampleBody: { on: true, lightness: 85, kelvin: 4000 },
    sampleCurl: "curl -X PUT http://192.168.1.100:8080/api/v1/lights/L1 \\\n  -H 'Content-Type: application/json' \\\n  -d '{\"on\":true,\"lightness\":85,\"kelvin\":4000}'"
  },
  {
    method: 'POST',
    path: '/api/v1/rooms/living/control',
    description: 'Điều khiển đồng thời toàn bộ đèn trong một phòng (1 gói group)',
    sampleBody: { on: true, lightness: 70, kelvin: 3000 },
    sampleCurl: "curl -X POST http://192.168.1.100:8080/api/v1/rooms/living/control \\\n  -H 'Content-Type: application/json' \\\n  -d '{\"on\":true,\"lightness\":70,\"kelvin\":3000}'"
  },
  {
    method: 'GET',
    path: '/api/v1/scenes',
    description: 'Lấy danh sách các ngữ cảnh ánh sáng (Scene Recall)',
    sampleBody: null,
    sampleCurl: 'curl -X GET http://192.168.1.100:8080/api/v1/scenes'
  },
  {
    method: 'POST',
    path: '/api/v1/scenes/1/recall',
    description: 'Kích hoạt ngữ cảnh ánh sáng (Scene 1: Thư giãn, 2: Đọc sách, ...)',
    sampleBody: { scope: 'all' },
    sampleCurl: "curl -X POST http://192.168.1.100:8080/api/v1/scenes/1/recall \\\n  -H 'Content-Type: application/json' \\\n  -d '{\"scope\":\"all\"}'"
  },
  {
    method: 'GET',
    path: '/api/v1/mesh/metrics',
    description: 'Lấy các chỉ số độ trễ, Jitter và thống kê gói tin BLE Mesh',
    sampleBody: null,
    sampleCurl: 'curl -X GET http://192.168.1.100:8080/api/v1/mesh/metrics'
  },
  {
    method: 'POST',
    path: '/api/v1/mesh/scan',
    description: 'Gateway phát lệnh quét Unprovisioned Beacons tìm đèn mới',
    sampleBody: null,
    sampleCurl: 'curl -X POST http://192.168.1.100:8080/api/v1/mesh/scan'
  },
  {
    method: 'POST',
    path: '/api/v1/mesh/provision',
    description: 'Gia nhập thiết bị mới vào mạng Mesh và gán vào phòng',
    sampleBody: { uuid: 'A4C1-38F2-11D0', roomId: 'living' },
    sampleCurl: "curl -X POST http://192.168.1.100:8080/api/v1/mesh/provision \\\n  -H 'Content-Type: application/json' \\\n  -d '{\"uuid\":\"A4C1-38F2-11D0\",\"roomId\":\"living\"}'"
  }
]);

export const apiCallHistory = [];

export function executeApiRequest({ method, path, body = null, context }) {
  const startTime = performance.now();
  const normalizedMethod = method.toUpperCase();
  const cleanPath = path.trim().replace(/\/+$/, '');

  let status = 200;
  let statusText = 'OK';
  let responseData = null;

  try {
    // 1. GET /api/v1/lights
    if (normalizedMethod === 'GET' && cleanPath === '/api/v1/lights') {
      responseData = {
        ok: true,
        count: context.state.lights.length,
        data: context.state.lights.map((l) => ({
          id: l.id,
          name: l.name,
          room: l.room,
          unicast: `0x${l.unicast.toString(16).padStart(4, '0').toUpperCase()}`,
          on: l.on,
          lightness: l.lightness,
          kelvin: l.kelvin,
          watts: l.watts,
          hops: l.hops,
          relay: l.relay
        }))
      };
    }
    // 2. GET /api/v1/lights/:id
    else if (normalizedMethod === 'GET' && cleanPath.startsWith('/api/v1/lights/')) {
      const id = cleanPath.split('/')[4];
      const light = context.lightById(id);
      if (!light) {
        status = 404;
        statusText = 'Not Found';
        responseData = { ok: false, error: `Không tìm thấy đèn với ID: ${id}` };
      } else {
        responseData = { ok: true, data: light };
      }
    }
    // 3. PUT /api/v1/lights/:id
    else if (normalizedMethod === 'PUT' && cleanPath.startsWith('/api/v1/lights/')) {
      const id = cleanPath.split('/')[4];
      const light = context.lightById(id);
      if (!light) {
        status = 404;
        statusText = 'Not Found';
        responseData = { ok: false, error: `Không tìm thấy đèn với ID: ${id}` };
      } else {
        const patch = {};
        if (typeof body?.on === 'boolean') patch.on = body.on;
        if (typeof body?.lightness === 'number') patch.lightness = Math.max(1, Math.min(100, body.lightness));
        if (typeof body?.kelvin === 'number') patch.kelvin = Math.max(2700, Math.min(6500, body.kelvin));

        context.setLight(id, patch, { ack: true, send: true });
        responseData = {
          ok: true,
          message: `Đã cập nhật đèn ${id} thành công`,
          data: context.lightById(id),
          lastPacket: light.lastPacket
        };
      }
    }
    // 4. POST /api/v1/rooms/:roomId/control
    else if (normalizedMethod === 'POST' && cleanPath.match(/^\/api\/v1\/rooms\/([^/]+)\/control$/)) {
      const roomId = cleanPath.split('/')[4];
      const patch = {};
      if (typeof body?.on === 'boolean') patch.on = body.on;
      if (typeof body?.lightness === 'number') patch.lightness = Math.max(1, Math.min(100, body.lightness));
      if (typeof body?.kelvin === 'number') patch.kelvin = Math.max(2700, Math.min(6500, body.kelvin));

      context.setRoom(roomId, patch, { ack: true });
      responseData = {
        ok: true,
        message: `Đã phát lệnh group tới phòng ${roomId}`,
        affectedLights: context.roomLights(roomId).length,
        patch
      };
    }
    // 5. GET /api/v1/scenes
    else if (normalizedMethod === 'GET' && cleanPath === '/api/v1/scenes') {
      responseData = { ok: true, count: context.SCENES.length, data: context.SCENES };
    }
    // 6. POST /api/v1/scenes/:id/recall
    else if (normalizedMethod === 'POST' && cleanPath.match(/^\/api\/v1\/scenes\/(\d+)\/recall$/)) {
      const sceneId = Number(cleanPath.split('/')[4]);
      const scope = body?.scope || 'all';
      context.recallScene(sceneId, scope);
      responseData = {
        ok: true,
        message: `Đã kích hoạt Scene #${sceneId}`,
        sceneId,
        scope
      };
    }
    // 7. GET /api/v1/mesh/metrics
    else if (normalizedMethod === 'GET' && cleanPath === '/api/v1/mesh/metrics') {
      const stats = context.latencyStats(context.state.samples);
      responseData = {
        ok: true,
        metrics: {
          ...stats,
          gatewayOnline: context.state.gatewayOnline,
          activePath: context.state.path,
          nodeCount: context.state.lights.length
        }
      };
    }
    // 8. POST /api/v1/mesh/scan
    else if (normalizedMethod === 'POST' && cleanPath === '/api/v1/mesh/scan') {
      const taken = new Set(context.state.lights.map((l) => l.uuid).filter(Boolean));
      const candidates = context.NEW_DEVICE_CANDIDATES.filter((c) => !taken.has(c.uuid));
      responseData = {
        ok: true,
        count: candidates.length,
        devices: candidates
      };
    }
    // 9. POST /api/v1/mesh/provision
    else if (normalizedMethod === 'POST' && cleanPath === '/api/v1/mesh/provision') {
      const uuid = body?.uuid;
      const roomId = body?.roomId || 'living';
      const target = context.NEW_DEVICE_CANDIDATES.find((c) => c.uuid === uuid);
      if (!target) {
        status = 400;
        statusText = 'Bad Request';
        responseData = { ok: false, error: `UUID thiết bị không hợp lệ hoặc đã vào mạng: ${uuid}` };
      } else {
        const newLight = context.quickProvision(target, roomId);
        responseData = {
          ok: true,
          message: `Đã provisioning thành công thiết bị vào phòng ${roomId}`,
          device: newLight
        };
      }
    }
    // 404
    else {
      status = 404;
      statusText = 'Not Found';
      responseData = { ok: false, error: `Endpoint ${normalizedMethod} ${cleanPath} không tồn tại.` };
    }
  } catch (err) {
    status = 500;
    statusText = 'Internal Server Error';
    responseData = { ok: false, error: err.message };
  }

  const durationMs = Math.round((performance.now() - startTime + Math.random() * 3 + 1) * 10) / 10;
  const result = {
    method: normalizedMethod,
    path: cleanPath,
    status,
    statusText,
    timeMs: durationMs,
    body: responseData,
    timestamp: new Date()
  };

  apiCallHistory.unshift(result);
  if (apiCallHistory.length > 50) apiCallHistory.pop();

  return result;
}

/**
 * Gắn window.HomeMeshAPI vào global scope để DevTools Console hoặc script bên ngoài có thể gọi API.
 */
export function registerGlobalApi(context) {
  if (typeof window === 'undefined') return;

  window.HomeMeshAPI = {
    async request(method, path, body = null) {
      return executeApiRequest({ method, path, body, context });
    },
    async getLights() {
      return executeApiRequest({ method: 'GET', path: '/api/v1/lights', context });
    },
    async getLight(id) {
      return executeApiRequest({ method: 'GET', path: `/api/v1/lights/${id}`, context });
    },
    async setLight(id, { on, lightness, kelvin }) {
      return executeApiRequest({ method: 'PUT', path: `/api/v1/lights/${id}`, body: { on, lightness, kelvin }, context });
    },
    async setRoom(roomId, { on, lightness, kelvin }) {
      return executeApiRequest({ method: 'POST', path: `/api/v1/rooms/${roomId}/control`, body: { on, lightness, kelvin }, context });
    },
    async recallScene(sceneId, scope = 'all') {
      return executeApiRequest({ method: 'POST', path: `/api/v1/scenes/${sceneId}/recall`, body: { scope }, context });
    },
    async getMetrics() {
      return executeApiRequest({ method: 'GET', path: '/api/v1/mesh/metrics', context });
    },
    async scan() {
      return executeApiRequest({ method: 'POST', path: '/api/v1/mesh/scan', context });
    },
    async provision(uuid, roomId) {
      return executeApiRequest({ method: 'POST', path: '/api/v1/mesh/provision', body: { uuid, roomId }, context });
    }
  };
}

