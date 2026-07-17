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
    // v15: cheeks is a style string ('none' | 'blush' | 'shy' | 'whiskers').
    // Visible when it's a non-'none' style; legacy boolean true stays visible.
    cheeks: g.cheeks === true || (typeof g.cheeks === 'string' && g.cheeks !== 'none'),
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
      // water droplet: pointed on TOP, perfectly ROUND bottom (circular arc)
      return (
        `M ${cx} ${cy - h * 1.15} ` +
        `C ${cx + w * 0.5} ${cy - h * 0.92} ${cx + w} ${cy - h * 0.1} ${cx + w} ${cy + h * 0.3} ` +
        `A ${w} ${h * 0.72} 0 0 1 ${cx - w} ${cy + h * 0.3} ` +
        `C ${cx - w} ${cy - h * 0.1} ${cx - w * 0.5} ${cy - h * 0.92} ${cx} ${cy - h * 1.15} Z`
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
    case 'fluffy': {
      // v15.1: blob with CAT-FUR at the BASE — a zigzag bottom edge with tips
      // pointing down and up (like ruffled fur), top and sides stay round.
      const lo = cy + h * 1.02; // fur tips pointing DOWN
      const hi = cy + h * 0.7;  // valleys pointing UP
      return (
        `M ${cx - w} ${cy} ` +
        `C ${cx - w} ${cy - h * 0.92} ${cx - w * 0.55} ${cy - h} ${cx} ${cy - h} ` +
        `C ${cx + w * 0.55} ${cy - h} ${cx + w} ${cy - h * 0.92} ${cx + w} ${cy} ` +
        // right side down to where the fur starts
        `C ${cx + w} ${cy + h * 0.35} ${cx + w * 0.96} ${cy + h * 0.48} ${cx + w * 0.88} ${cy + h * 0.58} ` +
        // zigzag fur along the bottom (tips down / valleys up)
        `L ${cx + w * 0.7} ${lo} L ${cx + w * 0.48} ${hi} ` +
        `L ${cx + w * 0.28} ${lo} L ${cx + w * 0.06} ${hi} ` +
        `L ${cx - w * 0.16} ${lo} L ${cx - w * 0.38} ${hi} ` +
        `L ${cx - w * 0.58} ${lo} L ${cx - w * 0.76} ${hi * 0.99} ` +
        // left side back up
        `C ${cx - w * 0.96} ${cy + h * 0.48} ${cx - w} ${cy + h * 0.35} ${cx - w} ${cy} Z`
      );
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
    case 'manga':
      // v15.1: redesigned per feedback — plain BLACK eye with a smaller white
      // circle in the center (simple, high-contrast anime look).
      return (
        `<circle cx="${x}" cy="${y}" r="${r}" fill="#1c1026"/>` +
        `<circle cx="${x}" cy="${y}" r="${r * 0.42}" fill="#ffffff"/>`
      );
    case 'dot':
      // v15: minimal dot eye — a small filled circle (~38% of normal radius).
      return `<circle cx="${x}" cy="${y}" r="${r * 0.38}" fill="${pal.eye}"/>`;
    case 'star': // v15: legacy (no longer generated) — kept so old saves still draw.
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
  if (mood === 'angry') {
    // a deeper, grumpy frown (brows + 💢 added by the caller)
    return `<path d="M ${x - w * 0.5} ${y + w * 0.34} Q ${x} ${y - w * 0.3} ${x + w * 0.5} ${y + w * 0.34}" fill="none" stroke="${c}" stroke-width="3" stroke-linecap="round"/>`;
  }
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
      // v15: squashed to HALF its former height (control offsets 0.5->0.25,
      // dip 0.08->0.04) so it reads distinct from 'cat'. Same width.
      return `<path d="M ${x - w * 0.5} ${y} Q ${x - w * 0.25} ${y + w * 0.25} ${x} ${y + w * 0.04} Q ${x + w * 0.25} ${y + w * 0.25} ${x + w * 0.5} ${y}" fill="none" stroke="${c}" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/>`;
    case 'fang': {
      // v15.1: fangs 20% shorter and 20% wider, on a FLATTER smile; the mouth
      // stroke is drawn ON TOP of the teeth so they hang from behind the lip.
      const smile = `<path d="M ${x - w * 0.42} ${y} Q ${x} ${y + w * 0.35} ${x + w * 0.42} ${y}" fill="none" stroke="${c}" stroke-width="2.6" stroke-linecap="round"/>`;
      const fw = w * 0.2;  // fang width (was 0.17)
      const fh = w * 0.29; // fang length (was 0.36)
      const fang = (fx) => `<path d="M ${fx} ${y + w * 0.06} l ${fw} 0 l ${-fw * 0.5} ${fh} Z" fill="#ffffff" stroke="${c}" stroke-width="1" stroke-linejoin="round"/>`;
      return fang(x - w * 0.28 - fw * 0.5) + fang(x + w * 0.28 - fw * 0.5) + smile;
    }
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
      case 'cat': {
        // v15.1: closer together (-8 each side) and 10px lower so they attach
        // to the head instead of floating beside it.
        const ex = mx - flip * 8;
        const ly = topY + 21; // 10 lower than before (was topY+11)
        return `<path d="M ${ex} ${ly} l ${flip * 24} ${-31} l ${flip * 6} ${34} Z" fill="${fill}" stroke="${st}" stroke-width="2" stroke-linejoin="round"/>` +
          `<path d="M ${ex + flip * 5} ${ly - 3} l ${flip * 12} ${-18} l ${flip * 3} ${19} Z" fill="${inner}"/>`;
      }
      case 'bunny': {
        // v15: 20% bigger and lowered a touch (center was topY-22).
        const by = topY - 16;
        return `<ellipse cx="${mx + flip * 6}" cy="${by}" rx="10.8" ry="31" fill="${fill}" stroke="${st}" stroke-width="2" transform="rotate(${flip * 10} ${mx + flip * 6} ${by})"/>` +
          `<ellipse cx="${mx + flip * 6}" cy="${by - 2}" rx="5.4" ry="22" fill="${inner}" transform="rotate(${flip * 10} ${mx + flip * 6} ${by})"/>`;
      }
      case 'floppy':
        return `<path d="M ${mx} ${topY + 8} q ${flip * 26} ${-4} ${flip * 30} ${28} q ${flip * -14} ${8} ${flip * -26} ${-6} Z" fill="${fill}" stroke="${st}" stroke-width="2" stroke-linejoin="round"/>`;
      case 'round':
        // v15: 20% bigger (r 14->16.8, inner 7->8.4).
        return `<circle cx="${mx + flip * 4}" cy="${topY - 6}" r="16.8" fill="${fill}" stroke="${st}" stroke-width="2"/>` +
          `<circle cx="${mx + flip * 4}" cy="${topY - 6}" r="8.4" fill="${inner}"/>`;
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
      // v15.1: base extended 40px downward (hidden behind the body) so the horn
      // is clearly rooted in the head instead of floating above it.
      return `<path d="M ${cx} ${topY - 30} l 9 72 l -18 0 Z" fill="${c}" stroke="${st}" stroke-width="2" stroke-linejoin="round"/>`;
    case 'double':
      // v15.1: base extended 40px downward (hidden behind the body).
      return (
        `<path d="M ${cx - 16} ${topY - 23} l 7 67 l -14 0 Z" fill="${c}" stroke="${st}" stroke-width="2" stroke-linejoin="round"/>` +
        `<path d="M ${cx + 16} ${topY - 23} l 7 67 l -14 0 Z" fill="${c}" stroke="${st}" stroke-width="2" stroke-linejoin="round"/>`
      );
    case 'devil': {
      // v15.1: same visible curve, but the base runs 40px further down (hidden
      // behind the body) so the horns anchor into the head.
      const horn = (mx, flip) =>
        `<path d="M ${mx} ${topY + 56} L ${mx} ${topY + 16} q ${flip * 3} ${-26} ${flip * 22} ${-40} q ${flip * -10} ${20} ${flip * -10} ${30} l 0 40 Z" fill="${c}" stroke="${st}" stroke-width="2" stroke-linejoin="round"/>`;
      return horn(cx - 26, -1) + horn(cx + 26, 1);
    }
    case 'antlers': { // v15: legacy (no longer generated) — kept so old saves still draw.
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
  // v15: nub & curl attach further to the RIGHT so they peek out more.
  const rx = cx + w * 0.98;
  switch (style) {
    case 'nub':
      // v15: 20% bigger and pushed clearly outside the silhouette (past the arm).
      return `<circle cx="${cx + w * 1.12}" cy="${by}" r="15" fill="${pal.bodyDark}" stroke="${pal.outline}" stroke-width="2"/>`;
    case 'curl':
      // v15: 20% bigger (deltas & stroke ×1.2) and pushed further right.
      return `<path d="M ${rx - 4} ${by} q 31 -7 29 -29 q -2 -19 -22 -14 q -12 4 -7 14" fill="none" stroke="${pal.bodyDark}" stroke-width="9.6" stroke-linecap="round"/>`;
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
    // v15.1: squashed flatter (wider-than-tall oval, was rx 0.55 / ry 0.6).
    return `<g clip-path="url(#${clipId})"><ellipse cx="${cx}" cy="${cy + h * 0.38}" rx="${w * 0.62}" ry="${h * 0.42}" fill="${pal.belly}" opacity="0.9"/></g>`;
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
  if (style === 'stripes') {
    // v15: a few soft, slightly-curved horizontal stripes clipped to the body.
    // Kept on the LOWER body so they never cross the face (the face sits mid-body).
    const ys = [cy + h * 0.42, cy + h * 0.66, cy + h * 0.9];
    return (
      `<g clip-path="url(#${clipId})" opacity="0.5">` +
      ys.map((sy) => `<path d="M ${cx - w * 1.1} ${sy} Q ${cx} ${sy + h * 0.1} ${cx + w * 1.1} ${sy}" fill="none" stroke="${pal.accentDark}" stroke-width="${h * 0.11}" stroke-linecap="round"/>`).join('') +
      `</g>`
    );
  }
  if (style === 'vshape') {
    // v15: a V-shaped chevron marking on the belly, below the mouth.
    const vy = cy + h * 0.42;
    const vw = w * 0.55;
    const vh = h * 0.38;
    return (
      `<g clip-path="url(#${clipId})">` +
      `<path d="M ${cx - vw} ${vy} L ${cx} ${vy + vh} L ${cx + vw} ${vy}" fill="none" stroke="${pal.accentDark}" stroke-width="${h * 0.13}" stroke-linecap="round" stroke-linejoin="round" opacity="0.6"/>` +
      `</g>`
    );
  }
  if (style === 'cheekdots') {
    // v15: two darker BODY markings, one on each cheek area (distinct from the
    // blush cheek feature — this rides on the body, patterned like spots).
    const dy = cy + h * 0.22;
    const dx = w * 0.66;
    const rr = w * 0.17;
    return (
      `<g clip-path="url(#${clipId})">` +
      `<circle cx="${cx - dx}" cy="${dy}" r="${rr}" fill="${pal.accentDark}" opacity="0.6"/>` +
      `<circle cx="${cx + dx}" cy="${dy}" r="${rr}" fill="${pal.accentDark}" opacity="0.6"/>` +
      `</g>`
    );
  }
  return '';
}

// ---------------------------------------------------------------------------
// Cheek marks (v15): 'blush' (soft ellipses), 'shy' (diagonal embarrassment
// lines) or 'whiskers' (outward cat whiskers). All sit a touch LOWER than the
// old blush position. 'none' is handled by the feature gate (never reaches here);
// a legacy boolean true is treated as 'blush' defensively.
// ---------------------------------------------------------------------------
function cheeksMark(style, L, eyeDX, eyeY, eyeR, pal) {
  const cyc = eyeY + eyeR * 1.02 + 20; // v15.1: all cheek marks 20px lower
  const lx = L.cx - eyeDX - eyeR * 0.7;
  const rx = L.cx + eyeDX + eyeR * 0.7;
  const st = style === true ? 'blush' : String(style);
  if (st === 'shy') {
    // 3 short diagonal red lines per cheek (anime embarrassment marks).
    const c = pal.blush;
    const marks = (mx) => {
      let s = '';
      for (let i = 0; i < 3; i++) {
        const ox = mx + (i - 1) * eyeR * 0.4;
        s += `<line x1="${ox - eyeR * 0.18}" y1="${cyc - eyeR * 0.38}" x2="${ox + eyeR * 0.18}" y2="${cyc + eyeR * 0.38}" stroke="${c}" stroke-width="${Math.max(2, eyeR * 0.22)}" stroke-linecap="round"/>`;
      }
      return s;
    };
    return marks(lx) + marks(rx);
  }
  if (st === 'whiskers') {
    // 3 thin whisker lines per side, fanning outward from the cheek.
    const c = pal.outline;
    const wh = (mx, flip) => {
      let s = '';
      for (const a of [-0.3, 0, 0.3]) {
        const ex = mx + flip * eyeR * 1.6;
        const ey = cyc + a * eyeR * 1.5;
        s += `<line x1="${mx}" y1="${cyc}" x2="${ex}" y2="${ey}" stroke="${c}" stroke-width="1.4" stroke-linecap="round" opacity="0.75"/>`;
      }
      return s;
    };
    return wh(lx, -1) + wh(rx, 1);
  }
  // default 'blush': the classic soft pink ellipses, just a bit lower.
  return (
    `<ellipse cx="${lx}" cy="${cyc}" rx="${eyeR * 0.72}" ry="${eyeR * 0.5}" fill="${pal.blush}" opacity="0.8"/>` +
    `<ellipse cx="${rx}" cy="${cyc}" rx="${eyeR * 0.72}" ry="${eyeR * 0.5}" fill="${pal.blush}" opacity="0.8"/>`
  );
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
    // v15: cheeks are a style now (blush / shy / whiskers) — drawn a bit lower.
    face += cheeksMark(g.cheeks, L, eyeDX, eyeY, eyeR, pal);
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
  // Angry mood: slanted V-brows over the eyes + a 💢 anger mark.
  if (mood === 'angry') {
    const by = eyeY - eyeR * 1.05;
    const bl = eyeR * 0.95;
    face +=
      `<g stroke="${pal.eye}" stroke-width="3" stroke-linecap="round">` +
      `<line x1="${L.cx - eyeDX - bl * 0.5}" y1="${by - bl * 0.35}" x2="${L.cx - eyeDX + bl * 0.5}" y2="${by + bl * 0.2}"/>` +
      `<line x1="${L.cx + eyeDX + bl * 0.5}" y1="${by - bl * 0.35}" x2="${L.cx + eyeDX - bl * 0.5}" y2="${by + bl * 0.2}"/>` +
      `</g>` +
      `<text x="${L.cx + L.w * 0.72}" y="${L.cy - L.h * 0.72}" font-size="18">💢</text>`;
  }

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
