'use strict';

import { cctToChannels, estimatePowerW, kelvinToHex } from '../cct.js';
import { FLOORS, FURNITURE, GATEWAY_FLOORPLAN_POS, ROOMS } from '../data.js';

// Mô hình 3D căn hộ (Three.js, tải khi mở chế độ 3D lần đầu).
// Mỗi đèn là một PointLight thật: màu theo Kelvin, cường độ theo độ sáng tuyến tính của driver.

const THREE_URL = new URL('../vendor/three.module.min.js', import.meta.url).href;
const S = 0.1; // 1 đơn vị mặt bằng = 0,1 m
const X = (x) => (x - 50) * S;
const Z = (y) => (y - 50) * S;
const WALL_H = 1.15; // cắt tường thấp để nhìn được vào trong phòng
const WALL_T = 0.14;
const CEIL = 2.45;
const LIGHT_CANDELA = 22; // cường độ tương đối cho bóng 18 W ở 100 %

const COLORS = {
  wood: '#a77b55', woodDark: '#6b4a34', fabric: '#62718a', fabricDark: '#4a566b',
  sheet: '#efebe3', blanket: '#6f93c8', pillow: '#faf8f3', metal: '#d3d8de', counter: '#ece8e1',
  counterTop: '#3b3b3e', dark: '#2a2b2e', screen: '#0f1115', glass: '#a9c3d3', pot: '#c47a52',
  leaf: '#4f8f4c', wall: '#ebe7e1', lampShade: '#f3e9d6', gateway: '#3b82f6'
};
const RUG = { bedroom: '#b98a74', living: '#7f927b' };
const BOOKS = ['#b94a48', '#3e6fb0', '#d9a441', '#4c8b6b', '#7a5aa6'];

// Dải sát một cạnh (giống bản 2D).
function strip(f, side, t) {
  if (side === 'top') return { x: f.x, y: f.y, w: f.w, h: t };
  if (side === 'bottom') return { x: f.x, y: f.y + f.h - t, w: f.w, h: t };
  if (side === 'left') return { x: f.x, y: f.y, w: t, h: f.h };
  return { x: f.x + f.w - t, y: f.y, w: t, h: f.h };
}
const inset = (f, d) => ({ x: f.x + d, y: f.y + d, w: f.w - 2 * d, h: f.h - 2 * d });

export async function mountFloorplan3D({ host, state, lightById, onToggle, onOpen }) {
  const THREE = await import(THREE_URL);
  const canvas = host.querySelector('canvas');
  const labelLayer = host.querySelector('.fp3d-labels');

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.1;
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 100);
  const hemi = new THREE.HemisphereLight('#a9bde0', '#2b2520', 0.55);
  const sun = new THREE.DirectionalLight('#fff6e8', 0);
  sun.position.set(-6, 10, 4);
  scene.add(hemi, sun);

  const matCache = new Map();
  const mat = (color, extra = {}) => {
    const key = color + JSON.stringify(extra);
    if (!matCache.has(key)) matCache.set(key, new THREE.MeshStandardMaterial({ color, roughness: 0.8, metalness: 0, ...extra }));
    return matCache.get(key);
  };

  // Hộp theo hình chữ nhật trên mặt bằng, từ độ cao y0, cao h (mét).
  function block(rect, y0, h, color, extra) {
    const w = Math.max(0.01, rect.w * S);
    const d = Math.max(0.01, rect.h * S);
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat(color, extra));
    mesh.position.set(X(rect.x) + w / 2, y0 + h / 2, Z(rect.y) + d / 2);
    return mesh;
  }
  function legs(rect, top, color) {
    const g = [];
    const t = 0.6;
    [[0, 0], [1, 0], [0, 1], [1, 1]].forEach(([a, b]) => {
      g.push(block({ x: rect.x + 0.3 + a * (rect.w - t - 0.6), y: rect.y + 0.3 + b * (rect.h - t - 0.6), w: t, h: t }, 0, top, color));
    });
    return g;
  }

  // ------------------------------------------------ Sàn có hoạ tiết
  function floorTexture(kind) {
    const c = document.createElement('canvas');
    c.width = 256;
    c.height = 256;
    const g = c.getContext('2d');
    if (kind === 'tile') {
      g.fillStyle = '#d9d6cf';
      g.fillRect(0, 0, 256, 256);
      for (let i = 0; i < 4; i += 1) for (let j = 0; j < 4; j += 1) {
        const v = 212 + ((i * 7 + j * 13) % 9);
        g.fillStyle = `rgb(${v},${v - 3},${v - 8})`;
        g.fillRect(i * 64 + 2, j * 64 + 2, 60, 60);
      }
    } else {
      for (let row = 0; row < 8; row += 1) {
        let x = -((row * 53) % 128);
        while (x < 256) {
          const len = 90 + ((row * 31 + x) % 60);
          const v = 150 + ((row * 17 + x * 3) % 30);
          g.fillStyle = `rgb(${v},${Math.round(v * 0.72)},${Math.round(v * 0.5)})`;
          g.fillRect(x, row * 32, len - 2, 30);
          x += len;
        }
      }
    }
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    tex.anisotropy = 4;
    return tex;
  }

  const world = new THREE.Group();
  scene.add(world);

  ROOMS.forEach((room) => {
    const x0 = room.bounds.x < 48 ? 4 : 48;
    const y0 = room.bounds.y < 50 ? 4 : 50;
    const w = (x0 === 4 ? 48 : 96) - x0;
    const h = (y0 === 4 ? 50 : 96) - y0;
    const kind = FLOORS[room.id] ?? 'wood';
    const tex = floorTexture(kind);
    tex.repeat.set((w * S) / (kind === 'tile' ? 2.4 : 3), (h * S) / (kind === 'tile' ? 2.4 : 2));
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(w * S, h * S), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.85 }));
    floor.rotation.x = -Math.PI / 2;
    floor.position.set(X(x0) + (w * S) / 2, 0, Z(y0) + (h * S) / 2);
    world.add(floor);
  });

  // Đế nhà
  const base = new THREE.Mesh(new THREE.BoxGeometry(9.6, 0.3, 9.6), mat('#3a3f47'));
  base.position.set(0, -0.151, 0);
  world.add(base);

  // ------------------------------------------------ Tường (cùng toạ độ với bản 2D)
  const walls = [
    [4, 4, 96, 4], [4, 96, 96, 96], [4, 4, 4, 96], [96, 4, 96, 96],
    [48, 4, 48, 44], [48, 56, 48, 96], [4, 50, 44, 50], [56, 50, 96, 50]
  ];
  walls.forEach(([x1, y1, x2, y2]) => {
    const len = Math.hypot(x2 - x1, y2 - y1) * S + WALL_T;
    const geo = x1 === x2 ? new THREE.BoxGeometry(WALL_T, WALL_H, len) : new THREE.BoxGeometry(len, WALL_H, WALL_T);
    const wall = new THREE.Mesh(geo, mat(COLORS.wall, { roughness: 0.95 }));
    wall.position.set(X((x1 + x2) / 2), WALL_H / 2, Z((y1 + y2) / 2));
    world.add(wall);
  });

  // ------------------------------------------------ Nội thất
  const BUILD = {
    rug: (f) => [block(f, 0.002, 0.012, RUG[f.room] ?? '#8a7a6a', { roughness: 1 })],
    bed: (f) => {
      const blanketRect = f.side === 'left' ? { ...inset(f, 0.4), x: f.x + f.w * 0.38, w: f.w * 0.62 - 0.4 }
        : f.side === 'right' ? { ...inset(f, 0.4), w: f.w * 0.62 - 0.4 }
          : f.side === 'top' ? { ...inset(f, 0.4), y: f.y + f.h * 0.38, h: f.h * 0.62 - 0.4 } : { ...inset(f, 0.4), h: f.h * 0.62 - 0.4 };
      const px = f.side === 'left' ? f.x + 2.2 : f.x + f.w - 6.2;
      return [
        block(f, 0, 0.3, COLORS.wood),
        block(inset(f, 0.5), 0.3, 0.2, COLORS.sheet),
        block(blanketRect, 0.5, 0.04, COLORS.blanket),
        block({ x: px, y: f.y + 1.4, w: 4, h: f.h / 2 - 2 }, 0.5, 0.1, COLORS.pillow),
        block({ x: px, y: f.y + f.h / 2 + 0.6, w: 4, h: f.h / 2 - 2 }, 0.5, 0.1, COLORS.pillow),
        block(strip(f, f.side, 1.2), 0, 1.0, COLORS.woodDark)
      ];
    },
    nightstand: (f) => [block(f, 0, 0.5, COLORS.wood), block(inset(f, 1.4), 0.5, 0.32, COLORS.lampShade, { emissive: '#3a2f1f' })],
    wardrobe: (f) => [block(f, 0, 2.0, COLORS.wood)],
    plant: (f) => {
      const pot = new THREE.Mesh(new THREE.CylinderGeometry(f.w * S * 0.38, f.w * S * 0.3, 0.38, 16), mat(COLORS.pot));
      pot.position.set(X(f.x + f.w / 2), 0.19, Z(f.y + f.h / 2));
      const leaf = new THREE.Mesh(new THREE.IcosahedronGeometry(f.w * S * 0.6, 1), mat(COLORS.leaf, { flatShading: true }));
      leaf.position.set(X(f.x + f.w / 2), 0.72, Z(f.y + f.h / 2));
      return [pot, leaf];
    },
    fridge: (f) => [block(f, 0, 1.8, COLORS.metal, { roughness: 0.35, metalness: 0.3 })],
    counter: (f) => [block(f, 0, 0.86, COLORS.counter), block(f, 0.86, 0.04, COLORS.counterTop, { roughness: 0.4 })],
    stove: (f) => [block(f, 0.9, 0.012, COLORS.dark, { roughness: 0.3 })],
    sink: (f) => [block(f, 0.9, 0.01, COLORS.metal, { roughness: 0.25, metalness: 0.6 }), block(inset(f, 0.8), 0.905, 0.01, '#7b828a')],
    table: (f) => {
      const top = f.low ? 0.4 : 0.74;
      const color = f.low ? COLORS.glass : COLORS.wood;
      const extra = f.low ? { transparent: true, opacity: 0.7, roughness: 0.1 } : {};
      return [block(f, top, 0.04, color, extra), ...legs(f, top, COLORS.woodDark)];
    },
    chair: (f) => [block(f, 0.42, 0.05, COLORS.wood), ...legs(f, 0.42, COLORS.woodDark), block(strip(f, f.side, 0.5), 0.47, 0.42, COLORS.woodDark)],
    tv: (f) => {
      const screen = strip({ x: f.x + 3, y: f.y, w: f.w - 6, h: f.h }, f.side, 0.4);
      return [block(f, 0, 0.45, COLORS.woodDark), block(screen, 0.5, 0.62, COLORS.screen, { roughness: 0.2, emissive: '#0b1a2e' })];
    },
    sofa: (f) => {
      const vertical = f.side === 'left' || f.side === 'right';
      const armA = vertical ? { x: f.x, y: f.y, w: f.w, h: 1.8 } : { x: f.x, y: f.y, w: 1.8, h: f.h };
      const armB = vertical ? { x: f.x, y: f.y + f.h - 1.8, w: f.w, h: 1.8 } : { x: f.x + f.w - 1.8, y: f.y, w: 1.8, h: f.h };
      return [
        block(f, 0, 0.42, COLORS.fabric, { roughness: 1 }),
        block(strip(f, f.side, 2.2), 0, 0.82, COLORS.fabricDark, { roughness: 1 }),
        block(armA, 0, 0.6, COLORS.fabricDark, { roughness: 1 }),
        block(armB, 0, 0.6, COLORS.fabricDark, { roughness: 1 })
      ];
    },
    desk: (f) => [
      block(f, 0.73, 0.04, COLORS.wood), ...legs(f, 0.73, COLORS.woodDark),
      block({ x: f.x + f.w / 2 - 3.5, y: f.y + 1, w: 7, h: 0.4 }, 0.85, 0.36, COLORS.screen, { emissive: '#14304f' }),
      block({ x: f.x + f.w / 2 - 0.4, y: f.y + 1.2, w: 0.8, h: 0.8 }, 0.77, 0.08, COLORS.dark),
      block({ x: f.x + f.w / 2 - 2.5, y: f.y + f.h - 3, w: 5, h: 1.4 }, 0.77, 0.02, COLORS.dark)
    ],
    shelf: (f) => {
      const parts = [block(f, 0, 1.8, COLORS.woodDark)];
      const front = strip(f, f.side === 'right' ? 'left' : f.side === 'left' ? 'right' : f.side === 'top' ? 'bottom' : 'top', 0.6);
      [0.12, 0.56, 1.0, 1.42].forEach((y0, row) => {
        const n = 5;
        for (let i = 0; i < n; i += 1) {
          const seg = front.w > front.h
            ? { x: front.x + (front.w / n) * i + 0.3, y: front.y - 0.25, w: front.w / n - 0.6, h: 0.5 }
            : { x: front.x - 0.25, y: front.y + (front.h / n) * i + 0.3, w: 0.5, h: front.h / n - 0.6 };
          parts.push(block(seg, y0, 0.26 + ((row + i) % 3) * 0.03, BOOKS[(row * 2 + i) % BOOKS.length]));
        }
      });
      return parts;
    }
  };
  BUILD.armchair = BUILD.sofa;
  FURNITURE.forEach((f) => (BUILD[f.type]?.(f) ?? []).forEach((m) => world.add(m)));

  // ------------------------------------------------ Gateway
  const gwX = X(GATEWAY_FLOORPLAN_POS.x);
  const gwZ = Z(GATEWAY_FLOORPLAN_POS.y);
  const gwStand = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.12, 0.9, 12), mat('#5b6270'));
  gwStand.position.set(gwX, 0.45, gwZ);
  const gwBox = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.08, 0.22), new THREE.MeshStandardMaterial({ color: COLORS.gateway, emissive: COLORS.gateway, emissiveIntensity: 0.6 }));
  gwBox.position.set(gwX, 0.95, gwZ);
  world.add(gwStand, gwBox);
  const GW_TOP = new THREE.Vector3(gwX, 1.0, gwZ);

  // ------------------------------------------------ Đèn
  const lights = new Map(); // id -> { group, fixture, hit, point, cone, link, label, key }
  const hits = [];
  const coneGeo = new THREE.ConeGeometry(1.25, CEIL - 0.05, 32, 1, true);
  const fixtureGeo = new THREE.CylinderGeometry(0.17, 0.2, 0.05, 24);
  const hitGeo = new THREE.SphereGeometry(0.42, 8, 8);
  const linkMat = new THREE.LineDashedMaterial({ color: '#f59e0b', dashSize: 0.12, gapSize: 0.1, transparent: true, opacity: 0.55 });
  const linkFlashMat = new THREE.LineBasicMaterial({ color: '#fbbf24' });

  function removeLightObj(id) {
    const o = lights.get(id);
    if (!o) return;
    world.remove(o.group);
    scene.remove(o.link);
    o.label.remove();
    hits.splice(hits.indexOf(o.hit), 1);
    lights.delete(id);
  }

  function addLightObj(l) {
    const group = new THREE.Group();
    group.position.set(X(l.fx), 0, Z(l.fy));
    const fixture = new THREE.Mesh(fixtureGeo, new THREE.MeshBasicMaterial({ color: '#555' }));
    fixture.position.y = CEIL;
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.22, 0.02, 8, 24), mat(l.relay ? '#f59e0b' : '#9aa3af'));
    ring.rotation.x = Math.PI / 2;
    ring.position.y = CEIL + 0.03;
    const cord = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.3, 4), mat('#6b7280'));
    cord.position.y = CEIL + 0.17;
    const hit = new THREE.Mesh(hitGeo, new THREE.MeshBasicMaterial({ visible: false }));
    hit.position.y = CEIL;
    hit.userData.id = l.id;
    const point = new THREE.PointLight('#ffffff', 0, 9, 2);
    point.position.y = CEIL - 0.1;
    const cone = new THREE.Mesh(coneGeo, new THREE.MeshBasicMaterial({
      color: '#fff', transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide
    }));
    cone.position.y = (CEIL - 0.05) / 2;
    group.add(fixture, ring, cord, hit, point, cone);
    world.add(group);
    hits.push(hit);

    const geo = new THREE.BufferGeometry();
    const link = new THREE.Line(geo, linkMat);
    scene.add(link);

    const label = document.createElement('span');
    label.className = 'fp3d-label';
    labelLayer.appendChild(label);
    lights.set(l.id, { group, fixture, hit, point, cone, link, label, key: '' });
  }

  const roomLabels = ROOMS.map((room) => {
    const el = document.createElement('span');
    el.className = 'fp3d-room';
    el.textContent = `${room.icon} ${room.name}`;
    labelLayer.appendChild(el);
    return { el, pos: new THREE.Vector3(X(room.labelPos.x), 0.05, Z(room.labelPos.y)) };
  });

  function sync() {
    const ids = new Set(state.lights.map((l) => l.id));
    [...lights.keys()].forEach((id) => { if (!ids.has(id)) removeLightObj(id); });
    const now = Date.now();
    state.lights.forEach((l) => {
      if (!lights.has(l.id)) addLightObj(l);
      const o = lights.get(l.id);
      o.group.position.set(X(l.fx), 0, Z(l.fy));
      const color = new THREE.Color(kelvinToHex(l.kelvin));
      const linear = l.on ? cctToChannels(l.kelvin, l.lightness).linear : 0;
      const blink = l.identifyUntil > now && Math.floor(now / 250) % 2 === 0;
      const level = blink ? (l.on ? 0 : 0.6) : linear;
      o.point.color.copy(color);
      o.point.intensity = LIGHT_CANDELA * (l.watts / 18) * level;
      o.fixture.material.color.copy(level > 0 ? color : new THREE.Color('#4a4f57'));
      o.cone.material.color.copy(color);
      o.cone.material.opacity = 0.11 * Math.sqrt(level);
      o.cone.visible = state.fpOptions.glow && level > 0;

      const parent = l.via === 'gateway' ? null : lightById(l.via);
      const from = parent ? new THREE.Vector3(X(parent.fx), CEIL, Z(parent.fy)) : GW_TOP;
      o.link.geometry.setFromPoints([from, new THREE.Vector3(X(l.fx), CEIL, Z(l.fy))]);
      o.link.computeLineDistances();
      o.link.visible = state.fpOptions.links;

      o.label.textContent = l.on ? `${l.id} · ${estimatePowerW(l.watts, l.on, l.lightness).toFixed(0)}W` : `${l.id} · tắt`;
      o.label.classList.toggle('off', !l.on);
      o.label.hidden = !state.fpOptions.labels;
    });
    gwBox.material.color.set(state.gatewayOnline ? COLORS.gateway : '#6b7280');
    gwBox.material.emissive.set(state.gatewayOnline ? COLORS.gateway : '#000000');
    requestRender();
    if (state.lights.some((l) => l.identifyUntil > now)) setTimeout(sync, 250);
  }

  function flash(targets) {
    targets.forEach((l) => {
      const o = lights.get(l.id);
      if (!o) return;
      o.link.material = linkFlashMat;
      o.link.visible = true;
      setTimeout(() => { o.link.material = linkMat; o.link.visible = state.fpOptions.links; requestRender(); }, 260);
    });
    requestRender();
  }

  // ------------------------------------------------ Camera xoay quanh nhà
  const view = { theta: -0.6, phi: 0.86, radius: 19.5 };
  const target = new THREE.Vector3(0, 0.4, 0);
  function placeCamera() {
    camera.position.set(
      target.x + view.radius * Math.sin(view.phi) * Math.sin(view.theta),
      target.y + view.radius * Math.cos(view.phi),
      target.z + view.radius * Math.sin(view.phi) * Math.cos(view.theta)
    );
    camera.lookAt(target);
  }

  let frame = 0;
  function requestRender() {
    if (!frame) frame = requestAnimationFrame(render);
  }
  const tmp = new THREE.Vector3();
  function place(el, pos, w, h) {
    tmp.copy(pos).project(camera);
    const visible = tmp.z < 1;
    el.style.transform = `translate(-50%, -50%) translate(${((tmp.x + 1) / 2) * w}px, ${((1 - tmp.y) / 2) * h}px)`;
    el.style.visibility = visible ? '' : 'hidden';
  }
  function render() {
    frame = 0;
    placeCamera();
    renderer.render(scene, camera);
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    lights.forEach((o) => { if (!o.label.hidden) place(o.label, tmp.set(o.group.position.x, CEIL + 0.42, o.group.position.z).clone(), w, h); });
    roomLabels.forEach((r) => place(r.el, r.pos, w, h));
  }

  function resize() {
    const w = host.clientWidth;
    const h = host.clientHeight;
    if (!w || !h) return;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    // Màn hình hẹp (điện thoại dọc): mở rộng góc nhìn để thấy trọn căn hộ.
    camera.fov = Math.min(54, 38 * Math.max(1, 0.95 / camera.aspect));
    camera.updateProjectionMatrix();
    requestRender();
  }
  new ResizeObserver(resize).observe(host);

  // Kéo để xoay, cuộn / chụm 2 ngón để phóng to.
  const pointers = new Map();
  let down = null;
  let pinch = 0;
  let clickTimer = 0;
  const ray = new THREE.Raycaster();
  const ndc = new THREE.Vector2();

  function pick(e) {
    const rect = canvas.getBoundingClientRect();
    ndc.set(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
    ray.setFromCamera(ndc, camera);
    return ray.intersectObjects(hits, false)[0]?.object.userData.id ?? null;
  }

  canvas.addEventListener('pointerdown', (e) => {
    canvas.setPointerCapture(e.pointerId);
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    down = { x: e.clientX, y: e.clientY, moved: false };
    if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      pinch = Math.hypot(a.x - b.x, a.y - b.y);
    }
  });
  canvas.addEventListener('pointermove', (e) => {
    const prev = pointers.get(e.pointerId);
    if (!prev) {
      canvas.style.cursor = pick(e) ? 'pointer' : 'grab';
      return;
    }
    if (pointers.size === 2) {
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      const [a, b] = [...pointers.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      if (pinch) zoom(pinch / d);
      pinch = d;
      down.moved = true;
      return;
    }
    const dx = e.clientX - prev.x;
    const dy = e.clientY - prev.y;
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (Math.abs(e.clientX - down.x) + Math.abs(e.clientY - down.y) > 5) down.moved = true;
    view.theta -= dx * 0.008;
    view.phi = Math.min(1.35, Math.max(0.22, view.phi - dy * 0.006));
    canvas.style.cursor = 'grabbing';
    requestRender();
  });
  const end = (e) => {
    pointers.delete(e.pointerId);
    pinch = 0;
    canvas.style.cursor = 'grab';
    if (e.type !== 'pointerup' || !down || down.moved || pointers.size) return;
    const id = pick(e);
    if (!id) return;
    // Click đơn: bật/tắt. Click đúp: mở bảng chỉnh chi tiết.
    if (clickTimer) {
      clearTimeout(clickTimer);
      clickTimer = 0;
      onOpen(id);
    } else {
      clickTimer = setTimeout(() => { clickTimer = 0; onToggle(id); }, 240);
    }
  };
  canvas.addEventListener('pointerup', end);
  canvas.addEventListener('pointercancel', end);

  function zoom(factor) {
    view.radius = Math.min(26, Math.max(6, view.radius * factor));
    requestRender();
  }
  canvas.addEventListener('wheel', (e) => { e.preventDefault(); zoom(1 + Math.sign(e.deltaY) * 0.08); }, { passive: false });

  function resetView() {
    Object.assign(view, { theta: -0.6, phi: 0.86, radius: 19.5 });
    requestRender();
  }
  function setDaylight(day) {
    hemi.intensity = day ? 1.4 : 0.55;
    sun.intensity = day ? 1.6 : 0;
    requestRender();
  }

  resize();
  sync();
  return { sync, flash, resetView, setDaylight, resize };
}
