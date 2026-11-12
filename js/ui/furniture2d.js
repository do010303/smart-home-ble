'use strict';

// Vẽ nội thất nhìn từ trên xuống cho sơ đồ mặt bằng (SVG, toạ độ 0–100).

const r = (x, y, w, h, cls, rx = 0.6) =>
  `<rect class="${cls}" x="${x.toFixed(2)}" y="${y.toFixed(2)}" width="${w.toFixed(2)}" height="${h.toFixed(2)}" rx="${rx}" />`;
const c = (cx, cy, rad, cls) => `<circle class="${cls}" cx="${cx.toFixed(2)}" cy="${cy.toFixed(2)}" r="${rad}" />`;

// Dải sát một cạnh của hộp (lưng sofa, đầu giường…).
function strip(f, side, t) {
  if (side === 'top') return [f.x, f.y, f.w, t];
  if (side === 'bottom') return [f.x, f.y + f.h - t, f.w, t];
  if (side === 'left') return [f.x, f.y, t, f.h];
  return [f.x + f.w - t, f.y, t, f.h];
}
const vertical = (side) => side === 'left' || side === 'right';

const SHAPES = {
  rug: (f) => r(f.x, f.y, f.w, f.h, 'fu-rug', 1) + r(f.x + 1, f.y + 1, f.w - 2, f.h - 2, 'fu-rug-inner', 0.6),

  bed(f) {
    const head = strip(f, f.side, 1.6);
    const along = vertical(f.side);
    // Gối: 2 chiếc nằm ngang ở đầu giường.
    const pillows = along
      ? [r(f.x + (f.side === 'left' ? 2.2 : f.w - 6.2), f.y + 1.2, 4, f.h / 2 - 1.8, 'fu-pillow', 1),
        r(f.x + (f.side === 'left' ? 2.2 : f.w - 6.2), f.y + f.h / 2 + 0.6, 4, f.h / 2 - 1.8, 'fu-pillow', 1)]
      : [r(f.x + 1.2, f.y + (f.side === 'top' ? 2.2 : f.h - 6.2), f.w / 2 - 1.8, 4, 'fu-pillow', 1),
        r(f.x + f.w / 2 + 0.6, f.y + (f.side === 'top' ? 2.2 : f.h - 6.2), f.w / 2 - 1.8, 4, 'fu-pillow', 1)];
    const blanket = along
      ? r(f.side === 'left' ? f.x + f.w * 0.38 : f.x, f.y + 0.4, f.w * 0.62, f.h - 0.8, 'fu-blanket', 0.8)
      : r(f.x + 0.4, f.side === 'top' ? f.y + f.h * 0.38 : f.y, f.w - 0.8, f.h * 0.62, 'fu-blanket', 0.8);
    return r(f.x, f.y, f.w, f.h, 'fu-wood', 0.8) + r(f.x + 0.4, f.y + 0.4, f.w - 0.8, f.h - 0.8, 'fu-sheet', 0.8)
      + blanket + pillows.join('') + r(...head, 'fu-wood-dark', 0.5);
  },

  nightstand: (f) => r(f.x, f.y, f.w, f.h, 'fu-wood', 0.5) + c(f.x + f.w / 2, f.y + f.h / 2, 1.3, 'fu-lamp'),

  wardrobe: (f) => r(f.x, f.y, f.w, f.h, 'fu-wood', 0.4)
    + `<line class="fu-line" x1="${f.x + f.w / 2}" y1="${f.y + 0.6}" x2="${f.x + f.w / 2}" y2="${f.y + f.h - 0.6}" />`,

  plant: (f) => {
    const cx = f.x + f.w / 2;
    const cy = f.y + f.h / 2;
    return c(cx, cy, f.w / 2, 'fu-pot') + c(cx - 0.9, cy - 0.6, 1.5, 'fu-leaf') + c(cx + 1, cy - 0.3, 1.4, 'fu-leaf')
      + c(cx, cy + 1, 1.4, 'fu-leaf');
  },

  fridge: (f) => r(f.x, f.y, f.w, f.h, 'fu-metal', 0.6) + r(f.x + 0.8, f.y + f.h * 0.6, f.w - 1.6, 0.4, 'fu-line-fill', 0.2),

  counter: (f) => r(f.x, f.y, f.w, f.h, 'fu-counter', 0.3),

  stove: (f) => r(f.x, f.y, f.w, f.h, 'fu-dark', 0.4)
    + [[0.28, 0.27], [0.72, 0.27], [0.28, 0.73], [0.72, 0.73]].map(([a, b]) => c(f.x + f.w * a, f.y + f.h * b, 0.95, 'fu-burner')).join(''),

  sink: (f) => r(f.x, f.y, f.w, f.h, 'fu-metal', 0.6) + r(f.x + 0.7, f.y + 0.7, f.w - 1.4, f.h - 1.4, 'fu-basin', 0.9),

  table: (f) => r(f.x, f.y, f.w, f.h, f.low ? 'fu-glass' : 'fu-wood', f.low ? 1.2 : 0.8),

  chair: (f) => r(f.x, f.y, f.w, f.h, 'fu-wood', 0.8) + r(...strip(f, f.side, 1.1), 'fu-wood-dark', 0.5),

  tv: (f) => r(f.x, f.y, f.w, f.h, 'fu-wood-dark', 0.4) + r(...strip({ x: f.x + 3, y: f.y, w: f.w - 6, h: f.h }, f.side, 0.9), 'fu-screen', 0.2),

  sofa(f) {
    const arms = vertical(f.side)
      ? [r(f.x, f.y, f.w, 1.8, 'fu-fabric-dark', 0.8), r(f.x, f.y + f.h - 1.8, f.w, 1.8, 'fu-fabric-dark', 0.8)]
      : [r(f.x, f.y, 1.8, f.h, 'fu-fabric-dark', 0.8), r(f.x + f.w - 1.8, f.y, 1.8, f.h, 'fu-fabric-dark', 0.8)];
    const seats = vertical(f.side) ? Math.max(1, Math.round(f.h / 9)) : Math.max(1, Math.round(f.w / 9));
    const lines = [];
    for (let i = 1; i < seats; i += 1) {
      if (vertical(f.side)) lines.push(`<line class="fu-seam" x1="${f.x}" y1="${f.y + (f.h * i) / seats}" x2="${f.x + f.w}" y2="${f.y + (f.h * i) / seats}" />`);
      else lines.push(`<line class="fu-seam" x1="${f.x + (f.w * i) / seats}" y1="${f.y}" x2="${f.x + (f.w * i) / seats}" y2="${f.y + f.h}" />`);
    }
    return r(f.x, f.y, f.w, f.h, 'fu-fabric', 1.2) + lines.join('') + r(...strip(f, f.side, 2.2), 'fu-fabric-dark', 0.9) + arms.join('');
  },

  desk: (f) => r(f.x, f.y, f.w, f.h, 'fu-wood', 0.5)
    + r(f.x + f.w / 2 - 3.5, f.y + 1, 7, 0.9, 'fu-screen', 0.2)
    + r(f.x + f.w / 2 - 2.5, f.y + f.h - 3, 5, 1.4, 'fu-dark', 0.3),

  shelf(f) {
    const books = [];
    const n = Math.floor(f.h / 2.2);
    for (let i = 0; i < n; i += 1) books.push(r(f.x + 0.6, f.y + 0.6 + i * 2.2, f.w - 1.2 - (i % 3) * 0.7, 1.7, `fu-book b${i % 4}`, 0.2));
    return r(f.x, f.y, f.w, f.h, 'fu-wood-dark', 0.3) + books.join('');
  }
};
SHAPES.armchair = SHAPES.sofa;

export function furnitureSvg(list) {
  return list.map((f) => `<g class="fu fu-${f.type}">${SHAPES[f.type]?.(f) ?? ''}</g>`).join('');
}

// Hoạ tiết sàn: ván gỗ và gạch ô vuông.
export const FLOOR_PATTERNS = `
  <pattern id="fp-wood" width="12" height="4" patternUnits="userSpaceOnUse">
    <rect class="fl-wood" width="12" height="4" />
    <line class="fl-seam" x1="0" y1="4" x2="12" y2="4" />
    <line class="fl-seam" x1="7" y1="0" x2="7" y2="2" />
    <line class="fl-seam" x1="2" y1="2" x2="2" y2="4" />
    <line class="fl-seam" x1="0" y1="2" x2="12" y2="2" />
  </pattern>
  <pattern id="fp-tile" width="5" height="5" patternUnits="userSpaceOnUse">
    <rect class="fl-tile" width="5" height="5" />
    <path class="fl-seam" d="M5 0V5M0 5H5" />
  </pattern>`;
