// js/render.js — procedural kawaii slime renderer (inline SVG).
// PUBLIC CONTRACT (used by Agent B too):
//   renderPet(svgEl, genome, stage, opts)
// Draws the pet/egg into the given <svg> element. No external images.
//
// Design goals: every pet is a rounded, glossy, pastel kawaii slime that
// evolves silhouette by stage. Body shapes, eyes, mouths, ears, horns, tails,
// legs and patterns all derive from the genome so pets look genuinely varied.

import { sanitizeGenome } from './pet.js';

// ---------------------------------------------------------------------------
// Color helpers (pastel HSL from genome hue).
// ---------------------------------------------------------------------------
function hsl(h, s, l, a) {
  h = ((h % 360) + 360) % 360;
  return a == null ? `hsl(${h} ${s}% ${l}%)` : `hsl(${h} ${s}% ${l}% / ${a})`;
}

function palette(g) {
  // Body S/L now follow the element (from the genome); fall back to the old
  // pastel defaults (70/80) for any legacy genome without sat/light. Every
  // derived tone keeps the SAME relative offset the fixed constants used, so a
  // default 70/80 reproduces the original look exactly, while earth/dark/light
  // shift correctly (brown / moody / cream).
  const S = typeof g.sat === 'number' && isFinite(g.sat) ? g.sat : 70;
  const L = typeof g.light === 'number' && isFinite(g.light) ? g.light : 80;
  const cl = (v) => Math.max(0, Math.min(100, v));
  return {
    body: hsl(g.hue, S, L),
    bodyDark: hsl(g.hue, cl(S - 8), cl(L - 12)),
    outline: hsl(g.hue, cl(S - 20), cl(L - 35)),
    shade: hsl(g.hue, cl(S - 10), cl(L - 8)),
    accent: hsl(g.hue2, cl(S - 2), cl(L - 2)),
    accentDark: hsl(g.hue2, cl(S - 12), cl(L - 18)),
    belly: hsl(g.hue2, cl(S - 10), cl(L + 10)),
    blush: hsl((g.hue + 340) % 360, 80, 78), // cheeks stay kawaii pink
    horn: hsl((g.hue2 + 20) % 360, 45, 88),
    eye: hsl(g.hue, 45, 22),
  };
}

// Subtle pastel element tint (a soft aura clipped to the body). 'none' = no tint.
const ELEMENT_TINT = {
  water: 'hsl(205 90% 70%)',
  fire: 'hsl(14 92% 68%)',
  grass: 'hsl(130 60% 66%)',
  earth: 'hsl(32 55% 62%)',
  lightning: 'hsl(48 95% 66%)',
  dark: 'hsl(265 35% 55%)',
  light: 'hsl(52 100% 82%)',
};

// Which parts are visible at each stage.
function features(stage, g) {
  const f = {
    body: true,
    eyes: true,
    mouth: true,
    cheeks: !!g.cheeks,
    ears: false,
    horn: false,
    nose: false,
    tail: false,
    legs: false,
    arms: false,
    pattern: false,
  };
  if (stage === 'child') {
    f.ears = g.ears !== 'none';
    f.horn = g.horn !== 'none';
  } else if (stage === 'teen') {
    f.ears = g.ears !== 'none';
    f.horn = g.horn !== 'none';
    f.nose = g.nose !== 'none';
    f.tail = g.tail !== 'none';
    f.legs = true;
  } else if (stage === 'adult') {
    f.ears = g.ears !== 'none';
    f.horn = g.horn !== 'none';
    f.nose = g.nose !== 'none';
    f.tail = g.tail !== 'none';
    f.legs = true;
    f.arms = true;
    f.pattern = g.pattern !== 'none';
  }
  return f;
}

// Body dimensions per stage.
function layout(stage) {
  const table = {
    baby: { cx: 100, cy: 122, w: 46, h: 42, eyeScale: 1.18, legLen: 0 },
    child: { cx: 100, cy: 120, w: 50, h: 46, eyeScale: 1.08, legLen: 0 },
    teen: { cx: 100, cy: 114, w: 52, h: 48, eyeScale: 1.0, legLen: 12 },
    adult: { cx: 100, cy: 110, w: 55, h: 52, eyeScale: 0.94, legLen: 16 },
  };
  return table[stage] || table.teen;
}

// ---------------------------------------------------------------------------
// Body shape paths. Each returns an SVG path `d` centered on (cx, cy).
// ---------------------------------------------------------------------------
function bodyPath(shape, cx, cy, w, h) {
  switch (shape) {
    case 'drop':
      return (
        `M ${cx} ${cy - h * 1.18} ` +
        `C ${cx + w * 0.75} ${cy - h * 0.5} ${cx + w} ${cy + h * 0.35} ${cx} ${cy + h} ` +
        `C ${cx - w} ${cy + h * 0.35} ${cx - w * 0.75} ${cy - h * 0.5} ${cx} ${cy - h * 1.18} Z`
      );
    case 'square': {
      // rounded squircle
      const r = Math.min(w, h) * 0.55;
      const l = cx - w,
        rt = cx + w,
        t = cy - h,
        b = cy + h;
      return (
        `M ${l + r} ${t} ` +
        `L ${rt - r} ${t} Q ${rt} ${t} ${rt} ${t + r} ` +
        `L ${rt} ${b - r} Q ${rt} ${b} ${rt - r} ${b} ` +
        `L ${l + r} ${b} Q ${l} ${b} ${l} ${b - r} ` +
        `L ${l} ${t + r} Q ${l} ${t} ${l + r} ${t} Z`
      );
    }
    case 'spiky':
      // blob base with three softly-rounded peaks along the top
      return (
        `M ${cx - w} ${cy} ` +
        `C ${cx - w} ${cy - h * 0.5} ${cx - w * 0.85} ${cy - h * 0.6} ${cx - w * 0.7} ${cy - h * 0.62} ` +
        `Q ${cx - w * 0.55} ${cy - h * 1.22} ${cx - w * 0.4} ${cy - h * 0.66} ` +
        `Q ${cx - w * 0.2} ${cy - h * 0.78} ${cx} ${cy - h * 1.32} ` +
        `Q ${cx + w * 0.2} ${cy - h * 0.78} ${cx + w * 0.4} ${cy - h * 0.66} ` +
        `Q ${cx + w * 0.55} ${cy - h * 1.22} ${cx + w * 0.7} ${cy - h * 0.62} ` +
        `C ${cx + w * 0.85} ${cy - h * 0.6} ${cx + w} ${cy - h * 0.5} ${cx + w} ${cy} ` +
        `C ${cx + w} ${cy + h * 0.9} ${cx + w * 0.6} ${cy + h} ${cx} ${cy + h} ` +
        `C ${cx - w * 0.6} ${cy + h} ${cx - w} ${cy + h * 0.9} ${cx - w} ${cy} Z`
      );
    case 'mochi': {
      // wide, low, very rounded pillow
      const ww = w * 1.18,
        hh = h * 0.82;
      return blob(cx, cy, ww, hh);
    }
    case 'blob':
    default:
      return blob(cx, cy, w, h);
  }
}

function blob(cx, cy, w, h) {
  return (
    `M ${cx - w} ${cy} ` +
    `C ${cx - w} ${cy - h * 0.92} ${cx - w * 0.55} ${cy - h} ${cx} ${cy - h} ` +
    `C ${cx + w * 0.55} ${cy - h} ${cx + w} ${cy - h * 0.92} ${cx + w} ${cy} ` +
    `C ${cx + w} ${cy + h * 0.92} ${cx + w * 0.6} ${cy + h} ${cx} ${cy + h} ` +
    `C ${cx - w * 0.6} ${cy + h} ${cx - w} ${cy + h * 0.92} ${cx - w} ${cy} Z`
  );
}

// ---------------------------------------------------------------------------
// Eyes (5 styles) — big, cute, with white sparkle highlights.
// ---------------------------------------------------------------------------
function eye(style, x, y, r, pal, mood) {
  const closed = mood === 'sleepy';
  if (closed || style === 'sleepy') {
    // gentle downward lids: happy closed ‿ eyes
    return `<path d="M ${x - r} ${y} Q ${x} ${y + r * 1.1} ${x + r} ${y}" fill="none" stroke="${pal.eye}" stroke-width="${r * 0.42}" stroke-linecap="round"/>`;
  }
  const sparkle =
    `<circle cx="${x - r * 0.32}" cy="${y - r * 0.42}" r="${r * 0.34}" fill="#ffffff"/>` +
    `<circle cx="${x + r * 0.34}" cy="${y + r * 0.3}" r="${r * 0.16}" fill="#ffffff" opacity="0.85"/>`;
  switch (style) {
    case 'oval':
      return (
        `<ellipse cx="${x}" cy="${y}" rx="${r * 0.72}" ry="${r * 1.12}" fill="${pal.eye}"/>` +
        sparkle
      );
    case 'star':
      return starPath(x, y, r * 1.05, pal.eye) + `<circle cx="${x - r * 0.28}" cy="${y - r * 0.3}" r="${r * 0.26}" fill="#ffffff"/>`;
    case 'sparkle':
      return (
        `<circle cx="${x}" cy="${y}" r="${r}" fill="${pal.eye}"/>` +
        `<circle cx="${x - r * 0.3}" cy="${y - r * 0.4}" r="${r * 0.42}" fill="#ffffff"/>` +
        `<circle cx="${x + r * 0.36}" cy="${y + r * 0.28}" r="${r * 0.2}" fill="#ffffff"/>` +
        `<path d="M ${x - r * 0.05} ${y - r * 0.05} l ${r * 0.5} ${r * 0.14} l ${-r * 0.5} ${r * 0.14} l ${-r * 0.14} ${r * 0.4} l ${-r * 0.14} ${-r * 0.4} l ${-r * 0.5} ${-r * 0.14} l ${r * 0.5} ${-r * 0.14} z" fill="#ffffff" opacity="0.55"/>`
      );
    case 'round':
    default:
      return `<circle cx="${x}" cy="${y}" r="${r}" fill="${pal.eye}"/>` + sparkle;
  }
}

function starPath(cx, cy, r, fill) {
  const pts = [];
  for (let i = 0; i < 5; i++) {
    const ao = -Math.PI / 2 + (i * 2 * Math.PI) / 5;
    const ai = ao + Math.PI / 5;
    pts.push(`${cx + Math.cos(ao) * r} ${cy + Math.sin(ao) * r}`);
    pts.push(`${cx + Math.cos(ai) * r * 0.46} ${cy + Math.sin(ai) * r * 0.46}`);
  }
  return `<path d="M ${pts.join(' L ')} Z" fill="${fill}"/>`;
}

// ---------------------------------------------------------------------------
// Mouths (4 styles).
// ---------------------------------------------------------------------------
function mouth(style, x, y, w, pal, mood) {
  const c = pal.eye;
  if (mood === 'sad') {
    return `<path d="M ${x - w * 0.5} ${y + w * 0.3} Q ${x} ${y - w * 0.2} ${x + w * 0.5} ${y + w * 0.3}" fill="none" stroke="${c}" stroke-width="2.4" stroke-linecap="round"/>`;
  }
  switch (style) {
    case 'cat':
      return (
        `<path d="M ${x - w * 0.55} ${y} Q ${x - w * 0.27} ${y + w * 0.4} ${x} ${y}" fill="none" stroke="${c}" stroke-width="2.4" stroke-linecap="round"/>` +
        `<path d="M ${x} ${y} Q ${x + w * 0.27} ${y + w * 0.4} ${x + w * 0.55} ${y}" fill="none" stroke="${c}" stroke-width="2.4" stroke-linecap="round"/>`
      );
    case 'open':
      return (
        `<path d="M ${x - w * 0.4} ${y - w * 0.05} Q ${x} ${y + w * 0.75} ${x + w * 0.4} ${y - w * 0.05} Z" fill="${c}"/>` +
        `<ellipse cx="${x}" cy="${y + w * 0.32}" rx="${w * 0.22}" ry="${w * 0.16}" fill="${pal.blush}"/>`
      );
    case 'w':
      return `<path d="M ${x - w * 0.5} ${y} Q ${x - w * 0.25} ${y + w * 0.5} ${x} ${y + w * 0.08} Q ${x + w * 0.25} ${y + w * 0.5} ${x + w * 0.5} ${y}" fill="none" stroke="${c}" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/>`;
    case 'smile':
    default:
      return `<path d="M ${x - w * 0.42} ${y} Q ${x} ${y + w * 0.6} ${x + w * 0.42} ${y}" fill="none" stroke="${c}" stroke-width="2.6" stroke-linecap="round"/>`;
  }
}

// ---------------------------------------------------------------------------
// Ears (behind/atop the body).
// ---------------------------------------------------------------------------
function ears(style, L, pal) {
  const { cx, cy, w, h } = L;
  const topY = cy - h * 0.95;
  const dx = w * 0.62;
  const inner = pal.blush;
  const fill = pal.body;
  const st = pal.outline;
  const one = (mx, flip) => {
    switch (style) {
      case 'cat':
        return `<path d="M ${mx} ${topY + 6} l ${flip * 16} ${-26} l ${flip * 4} ${28} Z" fill="${fill}" stroke="${st}" stroke-width="2" stroke-linejoin="round"/>` +
          `<path d="M ${mx + flip * 4} ${topY + 3} l ${flip * 8} ${-15} l ${flip * 2} ${16} Z" fill="${inner}"/>`;
      case 'bunny':
        return `<ellipse cx="${mx + flip * 6}" cy="${topY - 22}" rx="9" ry="26" fill="${fill}" stroke="${st}" stroke-width="2" transform="rotate(${flip * 10} ${mx + flip * 6} ${topY - 22})"/>` +
          `<ellipse cx="${mx + flip * 6}" cy="${topY - 24}" rx="4.5" ry="18" fill="${inner}" transform="rotate(${flip * 10} ${mx + flip * 6} ${topY - 22})"/>`;
      case 'floppy':
        return `<path d="M ${mx} ${topY + 8} q ${flip * 26} ${-4} ${flip * 30} ${28} q ${flip * -14} ${8} ${flip * -26} ${-6} Z" fill="${fill}" stroke="${st}" stroke-width="2" stroke-linejoin="round"/>`;
      case 'round':
        return `<circle cx="${mx + flip * 4}" cy="${topY - 6}" r="14" fill="${fill}" stroke="${st}" stroke-width="2"/>` +
          `<circle cx="${mx + flip * 4}" cy="${topY - 6}" r="7" fill="${inner}"/>`;
      default:
        return '';
    }
  };
  return `<g class="sp-ears">${one(cx - dx, -1)}${one(cx + dx, 1)}</g>`;
}

// ---------------------------------------------------------------------------
// Horns.
// ---------------------------------------------------------------------------
function horns(style, L, pal) {
  const { cx, cy, h } = L;
  const topY = cy - h * 1.02;
  const c = pal.horn;
  const st = pal.accentDark;
  switch (style) {
    case 'single':
      return `<path d="M ${cx} ${topY - 22} l 9 24 l -18 0 Z" fill="${c}" stroke="${st}" stroke-width="2" stroke-linejoin="round"/>`;
    case 'double':
      return (
        `<path d="M ${cx - 16} ${topY - 16} l 7 20 l -14 0 Z" fill="${c}" stroke="${st}" stroke-width="2" stroke-linejoin="round"/>` +
        `<path d="M ${cx + 16} ${topY - 16} l 7 20 l -14 0 Z" fill="${c}" stroke="${st}" stroke-width="2" stroke-linejoin="round"/>`
      );
    case 'antlers': {
      const branch = (mx, flip) =>
        `<path d="M ${mx} ${topY + 4} q ${flip * 4} ${-20} ${flip * 2} ${-30} m 0 10 q ${flip * 10} ${-6} ${flip * 16} ${-10} m ${flip * -16} 20 q ${flip * 12} ${-3} ${flip * 18} 0" fill="none" stroke="${st}" stroke-width="3.4" stroke-linecap="round"/>`;
      return branch(cx - 12, -1) + branch(cx + 12, 1);
    }
    default:
      return '';
  }
}

// ---------------------------------------------------------------------------
// Tails (behind the body).
// ---------------------------------------------------------------------------
function tail(style, L, pal) {
  const { cx, cy, w, h } = L;
  const bx = cx + w * 0.86;
  const by = cy + h * 0.55;
  switch (style) {
    case 'nub':
      return `<circle cx="${bx}" cy="${by}" r="12" fill="${pal.bodyDark}" stroke="${pal.outline}" stroke-width="2"/>`;
    case 'curl':
      return `<path d="M ${bx - 4} ${by} q 26 -6 24 -24 q -2 -16 -18 -12 q -10 3 -6 12" fill="none" stroke="${pal.bodyDark}" stroke-width="8" stroke-linecap="round"/>`;
    case 'fox':
      return `<path d="M ${bx - 6} ${by - 6} q 34 -2 40 26 q 4 22 -18 30 q -6 -20 -22 -22 q -8 -18 0 -34 Z" fill="${pal.accent}" stroke="${pal.outline}" stroke-width="2" stroke-linejoin="round"/>` +
        `<path d="M ${bx + 30} ${by + 40} q 8 -8 8 -18 q 6 12 -2 22 Z" fill="#ffffff" opacity="0.8"/>`;
    default:
      return '';
  }
}

// ---------------------------------------------------------------------------
// Legs / arms (stubby, rounded).
// ---------------------------------------------------------------------------
function legs(L, pal, withPaws) {
  const { cx, cy, w, h, legLen } = L;
  const footY = cy + h + legLen;
  const dx = w * 0.42;
  const foot = (fx) =>
    `<ellipse cx="${fx}" cy="${cy + h - 2}" rx="12" ry="${8 + legLen * 0.5}" fill="${pal.bodyDark}" stroke="${pal.outline}" stroke-width="2"/>` +
    (withPaws ? `<ellipse cx="${fx}" cy="${footY - 4}" rx="9" ry="6" fill="${pal.belly}" opacity="0.9"/>` : '');
  return `<g class="sp-legs">${foot(cx - dx)}${foot(cx + dx)}</g>`;
}

function arms(L, pal) {
  const { cx, cy, w, h } = L;
  const ay = cy + h * 0.2;
  const arm = (ax, flip) =>
    `<ellipse cx="${ax}" cy="${ay}" rx="10" ry="14" fill="${pal.bodyDark}" stroke="${pal.outline}" stroke-width="2" transform="rotate(${flip * 22} ${ax} ${ay})"/>`;
  return `<g class="sp-arms">${arm(cx - w * 0.98, -1)}${arm(cx + w * 0.98, 1)}</g>`;
}

// ---------------------------------------------------------------------------
// Pattern overlays (clipped to the body).
// ---------------------------------------------------------------------------
function pattern(style, L, pal, clipId) {
  const { cx, cy, w, h } = L;
  if (style === 'belly') {
    return `<g clip-path="url(#${clipId})"><ellipse cx="${cx}" cy="${cy + h * 0.28}" rx="${w * 0.55}" ry="${h * 0.6}" fill="${pal.belly}" opacity="0.9"/></g>`;
  }
  if (style === 'spots') {
    const spots = [
      [cx - w * 0.5, cy - h * 0.2, 7],
      [cx + w * 0.45, cy + h * 0.1, 6],
      [cx - w * 0.15, cy + h * 0.55, 5],
      [cx + w * 0.2, cy - h * 0.5, 5],
    ];
    return (
      `<g clip-path="url(#${clipId})">` +
      spots.map((s) => `<circle cx="${s[0]}" cy="${s[1]}" r="${s[2]}" fill="${pal.accentDark}" opacity="0.55"/>`).join('') +
      `</g>`
    );
  }
  return '';
}

// ---------------------------------------------------------------------------
// Dirty marks (DESIGN v5 §5): a few brown smudge dots clipped to the body plus
// a little buzzing fly near the pet. Subtle, still kawaii. Shown when the pet
// is dirty (hygiene < 35 — the caller passes opts.dirty).
// ---------------------------------------------------------------------------
function dirtyMarks(L, clipId) {
  const { cx, cy, w, h } = L;
  const c = 'hsl(28 38% 38%)';
  const dots = [
    [cx - w * 0.46, cy + h * 0.18, 5.0, 3.4],
    [cx + w * 0.42, cy + h * 0.34, 4.2, 2.8],
    [cx - w * 0.08, cy + h * 0.56, 3.6, 2.6],
    [cx + w * 0.16, cy - h * 0.22, 3.0, 2.2],
  ];
  return (
    `<g clip-path="url(#${clipId})" opacity="0.5">` +
    dots.map((d) => `<ellipse cx="${d[0]}" cy="${d[1]}" rx="${d[2]}" ry="${d[3]}" fill="${c}"/>`).join('') +
    `</g>`
  );
}

function dirtyFly(L) {
  const { cx, cy, w, h } = L;
  const fx = cx + w * 0.92;
  const fy = cy - h * 0.62;
  return (
    `<g class="sp-fly"><g transform="translate(${fx} ${fy})">` +
    `<ellipse cx="-3.2" cy="-2.4" rx="3.2" ry="1.9" fill="#ffffff" opacity="0.75" stroke="hsl(0 0% 55%)" stroke-width="0.5"/>` +
    `<ellipse cx="3.2" cy="-2.4" rx="3.2" ry="1.9" fill="#ffffff" opacity="0.75" stroke="hsl(0 0% 55%)" stroke-width="0.5"/>` +
    `<ellipse cx="0" cy="0" rx="2.6" ry="2.0" fill="hsl(0 0% 22%)"/>` +
    `</g></g>`
  );
}

// ---------------------------------------------------------------------------
// Egg rendering (patterned by hue).
// ---------------------------------------------------------------------------
function renderEgg(g, opts) {
  const pal = palette(g);
  const cx = 100,
    cy = 116;
  const w = 44,
    h = 58;
  // Proper egg silhouette: narrower rounded top, widest below centre, round bottom.
  const eggPath =
    `M ${cx} ${cy - h} ` +
    `C ${cx + w * 0.52} ${cy - h} ${cx + w} ${cy - h * 0.02} ${cx + w * 0.98} ${cy + h * 0.32} ` +
    `C ${cx + w * 0.9} ${cy + h * 0.78} ${cx + w * 0.48} ${cy + h} ${cx} ${cy + h} ` +
    `C ${cx - w * 0.48} ${cy + h} ${cx - w * 0.9} ${cy + h * 0.78} ${cx - w * 0.98} ${cy + h * 0.32} ` +
    `C ${cx - w} ${cy - h * 0.02} ${cx - w * 0.52} ${cy - h} ${cx} ${cy - h} Z`;
  const clipId = 'eggclip';
  // zigzag band
  const band = [];
  const bandY = cy + h * 0.1;
  for (let i = -1; i <= 7; i++) {
    const px = cx - w + (i * (2 * w)) / 6;
    band.push(`${px} ${bandY + (i % 2 === 0 ? 8 : -8)}`);
  }
  const taps = opts.eggTaps || 0;
  const cracks =
    taps > 0
      ? `<g stroke="${pal.outline}" stroke-width="2" fill="none" opacity="${Math.min(1, taps / 5)}">` +
        `<path d="M ${cx - 6} ${cy - h * 0.5} l 8 10 l -6 8 l 10 8"/>` +
        (taps > 2 ? `<path d="M ${cx + 10} ${cy - h * 0.2} l -6 8 l 8 6"/>` : '') +
        `</g>`
      : '';
  const anim = opts.animate === false ? '' : ' class="sp-egg-anim"';
  return (
    `<defs><clipPath id="${clipId}"><path d="${eggPath}"/></clipPath></defs>` +
    `<g${anim}>` +
    `<ellipse cx="${cx}" cy="${cy + h + 8}" rx="${w * 0.7}" ry="7" fill="rgba(0,0,0,0.10)"/>` +
    `<path d="${eggPath}" fill="${pal.body}" stroke="${pal.outline}" stroke-width="3"/>` +
    `<g clip-path="url(#${clipId})">` +
    `<polyline points="${band.join(' ')}" fill="none" stroke="${pal.accent}" stroke-width="10" stroke-linejoin="round"/>` +
    `<circle cx="${cx - w * 0.4}" cy="${cy - h * 0.4}" r="6" fill="${pal.accentDark}" opacity="0.6"/>` +
    `<circle cx="${cx + w * 0.45}" cy="${cy - h * 0.15}" r="5" fill="${pal.accentDark}" opacity="0.6"/>` +
    `<circle cx="${cx + w * 0.1}" cy="${cy + h * 0.5}" r="7" fill="${pal.accentDark}" opacity="0.5"/>` +
    `</g>` +
    `<ellipse cx="${cx - w * 0.35}" cy="${cy - h * 0.45}" rx="12" ry="18" fill="#ffffff" opacity="0.35"/>` +
    cracks +
    `</g>`
  );
}

// ---------------------------------------------------------------------------
// Death / angel form (DESIGN v4 §5): faded body, halo, closed ✕ eyes, wings,
// a gentle float-up idle. When opts.flyAway is set it plays the one-shot
// "drift up and fade" send-off animation instead of the idle float.
// ---------------------------------------------------------------------------
function renderAngel(g, stage, opts) {
  const pal = palette(g);
  const L = { ...layout(stage === 'egg' ? 'baby' : stage) };
  const bodyD = bodyPath(g.bodyShape, L.cx, L.cy, L.w, L.h);
  const clipId = 'angelclip';

  const eyeR = L.w * 0.19 * L.eyeScale;
  const eyeY = L.cy + L.h * 0.02;
  const eyeDX = L.w * 0.4;
  const mouthY = eyeY + eyeR + L.h * 0.14;

  // ✕ (closed/gone) eyes.
  const xEye = (x) => {
    const r = eyeR * 0.7;
    return (
      `<path d="M ${x - r} ${eyeY - r} L ${x + r} ${eyeY + r} M ${x + r} ${eyeY - r} L ${x - r} ${eyeY + r}" ` +
      `stroke="${pal.eye}" stroke-width="${eyeR * 0.34}" stroke-linecap="round"/>`
    );
  };

  // Halo above the head.
  const haloY = L.cy - L.h * 1.28;
  const halo =
    `<ellipse cx="${L.cx}" cy="${haloY}" rx="${L.w * 0.42}" ry="${L.w * 0.16}" fill="none" ` +
    `stroke="hsl(48 100% 70%)" stroke-width="5" opacity="0.95"/>`;

  // Little wings peeking out either side.
  const wing = (mx, flip) =>
    `<path d="M ${mx} ${L.cy} q ${flip * 26} ${-20} ${flip * 34} 2 q ${flip * -6} 16 ${flip * -30} 14 Z" ` +
    `fill="#ffffff" stroke="hsl(220 30% 85%)" stroke-width="1.6" opacity="0.9"/>`;
  const wings = wing(L.cx - L.w * 0.9, -1) + wing(L.cx + L.w * 0.9, 1);

  const body =
    `<path d="${bodyD}" fill="${pal.body}" stroke="${pal.outline}" stroke-width="3" ` +
    `stroke-linejoin="round" opacity="0.62"/>`;
  const mouthStr = `<path d="M ${L.cx - eyeR * 0.5} ${mouthY} Q ${L.cx} ${mouthY - eyeR * 0.4} ${L.cx + eyeR * 0.5} ${mouthY}" fill="none" stroke="${pal.eye}" stroke-width="2.2" stroke-linecap="round" opacity="0.7"/>`;

  const cls = opts.flyAway ? 'sp-flyaway' : 'sp-angel';
  const defs = `<defs><clipPath id="${clipId}"><path d="${bodyD}"/></clipPath></defs>`;
  return (
    defs +
    `<g class="${cls}">` +
    wings +
    body +
    halo +
    xEye(L.cx - eyeDX) +
    xEye(L.cx + eyeDX) +
    mouthStr +
    `</g>`
  );
}

// ---------------------------------------------------------------------------
// Main entry point.
// ---------------------------------------------------------------------------
export function renderPet(svgEl, genome, stage, opts) {
  if (!svgEl) return;
  opts = opts || {};
  const g = sanitizeGenome(genome);
  svgEl.setAttribute('viewBox', '0 0 200 200');
  svgEl.setAttribute('xmlns', 'http://www.w3.org/2000/svg');

  if (opts.dead) {
    svgEl.innerHTML = renderAngel(g, stage, opts);
    return;
  }

  if (stage === 'egg') {
    svgEl.innerHTML = renderEgg(g, opts);
    return;
  }

  const pal = palette(g);
  const L = { ...layout(stage) }; // clone: never mutate the shared layout table
  // Chubbiness (0..1): a heavier pet gets subtly wider & squatter, still cute.
  const chubby = Math.max(0, Math.min(1, opts.chubby || 0));
  if (chubby > 0) {
    L.w = L.w * (1 + chubby * 0.28);
    L.h = L.h * (1 - chubby * 0.06);
    L.cy = L.cy + chubby * 3;
  }
  const f = features(stage, g);
  const mood = opts.mood || (pet_isTired(opts) ? 'sleepy' : 'idle');
  const clipId = 'bodyclip';

  const bodyD = bodyPath(g.bodyShape, L.cx, L.cy, L.w, L.h);

  // Face geometry.
  const eyeR = L.w * 0.19 * L.eyeScale;
  const eyeY = L.cy + L.h * 0.02;
  const eyeDX = L.w * 0.4;
  const mouthY = eyeY + eyeR + L.h * 0.14;
  const mouthW = L.w * 0.5;

  // Back layer (behind body): tail, ears, horns, legs.
  let back = '';
  if (f.tail) back += tail(g.tail, L, pal);
  if (f.legs) back += legs(L, pal, stage === 'adult');
  if (f.arms) back += arms(L, pal);
  if (f.ears) back += ears(g.ears, L, pal);
  if (f.horn) back += horns(g.horn, L, pal);

  // Body + gloss.
  const shadow = `<ellipse cx="${L.cx}" cy="${L.cy + L.h + (L.legLen || 6) + 8}" rx="${L.w * 0.85}" ry="8" fill="rgba(0,0,0,0.10)"/>`;
  const body =
    `<path d="${bodyD}" fill="${pal.body}" stroke="${pal.outline}" stroke-width="3" stroke-linejoin="round"/>` +
    // soft inner shading at the bottom
    `<g clip-path="url(#${clipId})"><ellipse cx="${L.cx}" cy="${L.cy + L.h * 0.9}" rx="${L.w * 1.1}" ry="${L.h * 0.5}" fill="${pal.bodyDark}" opacity="0.35"/></g>`;

  const pat = f.pattern ? pattern(g.pattern, L, pal, clipId) : '';

  // Optional subtle element tint: a soft aura clipped inside the body.
  const el = opts.element || g.element;
  const tintColor = ELEMENT_TINT[el];
  const tint = tintColor
    ? `<g clip-path="url(#${clipId})"><ellipse cx="${L.cx}" cy="${L.cy - L.h * 0.15}" rx="${L.w * 1.1}" ry="${L.h * 1.1}" fill="${tintColor}" opacity="0.16"/></g>`
    : '';

  // v7: sickly tint — a subtle pale-green desaturating cast over the whole body.
  const sickTint = opts.sick
    ? `<g clip-path="url(#${clipId})"><ellipse cx="${L.cx}" cy="${L.cy}" rx="${L.w * 1.3}" ry="${L.h * 1.35}" fill="hsl(96 42% 66%)" opacity="0.32"/></g>`
    : '';

  // Glossy highlight.
  const gloss =
    `<ellipse cx="${L.cx - L.w * 0.38}" cy="${L.cy - L.h * 0.45}" rx="${L.w * 0.28}" ry="${L.h * 0.34}" fill="#ffffff" opacity="0.5" transform="rotate(-18 ${L.cx - L.w * 0.38} ${L.cy - L.h * 0.45})"/>` +
    `<circle cx="${L.cx + L.w * 0.3}" cy="${L.cy - L.h * 0.55}" r="${L.w * 0.08}" fill="#ffffff" opacity="0.55"/>`;

  // Face.
  let face = '';
  if (f.cheeks) {
    face +=
      `<ellipse cx="${L.cx - eyeDX - eyeR * 0.7}" cy="${eyeY + eyeR * 0.7}" rx="${eyeR * 0.72}" ry="${eyeR * 0.5}" fill="${pal.blush}" opacity="0.8"/>` +
      `<ellipse cx="${L.cx + eyeDX + eyeR * 0.7}" cy="${eyeY + eyeR * 0.7}" rx="${eyeR * 0.72}" ry="${eyeR * 0.5}" fill="${pal.blush}" opacity="0.8"/>`;
  }
  const eyesG =
    `<g class="sp-eyes">` +
    eye(g.eyes, L.cx - eyeDX, eyeY, eyeR, pal, mood) +
    eye(g.eyes, L.cx + eyeDX, eyeY, eyeR, pal, mood) +
    `</g>`;
  face += eyesG;
  if (f.nose) {
    if (g.nose === 'dot') face += `<circle cx="${L.cx}" cy="${mouthY - eyeR * 0.5}" r="2.6" fill="${pal.eye}"/>`;
    else if (g.nose === 'triangle')
      face += `<path d="M ${L.cx - 4} ${mouthY - eyeR * 0.6} L ${L.cx + 4} ${mouthY - eyeR * 0.6} L ${L.cx} ${mouthY - eyeR * 0.1} Z" fill="${pal.accentDark}"/>`;
  }
  face += mouth(g.mouth, L.cx, mouthY, mouthW, pal, mood);

  // Sleep Zzz.
  const zzz =
    mood === 'sleepy'
      ? `<g fill="${pal.outline}" opacity="0.8" font-family="sans-serif" font-weight="700"><text x="${L.cx + L.w * 0.7}" y="${L.cy - L.h * 0.7}" font-size="14">z</text><text x="${L.cx + L.w * 0.95}" y="${L.cy - L.h}" font-size="18">Z</text></g>`
      : '';

  // Dirty overlay (§5): smudges ride with the body (clipped, inside the squish
  // group); the fly buzzes independently outside it (like the sleep Zzz).
  const smudges = opts.dirty ? dirtyMarks(L, clipId) : '';
  const fly = opts.dirty ? dirtyFly(L) : '';

  const defs = `<defs><clipPath id="${clipId}"><path d="${bodyD}"/></clipPath></defs>`;
  const animClass = opts.animate === false ? '' : ' class="sp-squish"';

  svgEl.innerHTML =
    defs +
    shadow +
    `<g${animClass}>` +
    back +
    body +
    tint +
    sickTint +
    pat +
    gloss +
    face +
    smudges +
    `</g>` +
    zzz +
    fly;
}

function pet_isTired(opts) {
  return opts && opts.tired === true;
}

export default renderPet;
