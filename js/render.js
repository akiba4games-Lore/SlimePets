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
      // v15.7: player-drawn spiky silhouette, scaled per stage.
      return spikyPath(cx, cy, w, h);
    case 'mochi': {
      // wide, low, very rounded pillow
      const ww = w * 1.18,
        hh = h * 0.82;
      return blob(cx, cy, ww, hh);
    }
    case 'fluffy':
      // v15.4: player-drawn silhouette (traced), normalized to a unit box and
      // scaled to (cx,cy,w,h) so it grows with the pet like the other shapes.
      return fluffyPath(cx, cy, w, h);
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

// v15.4: the 'fluffy' body is a hand-drawn silhouette, traced and normalized to
// a unit box (coords in [-1,1] around origin). fluffyPath() maps that unit path
// onto (cx,cy,w,h) — every number is an x/y pair, so a single running index maps
// even→x, odd→y. This lets the traced shape scale per growth stage like the rest.
const FLUFFY_UNIT = 'M 0.0237 -0.9992 C 0.0288 -0.9992 0.0339 -0.9992 0.0392 -0.9992 C 0.2684 -0.9983 0.2684 -0.9983 0.3626 -0.9678 C 0.3659 -0.9667 0.3692 -0.9656 0.3727 -0.9645 C 0.3974 -0.9564 0.4218 -0.9474 0.4462 -0.9378 C 0.4512 -0.9358 0.4563 -0.9339 0.4615 -0.9319 C 0.5489 -0.8937 0.6359 -0.8149 0.6878 -0.7159 C 0.6878 -0.7119 0.6878 -0.708 0.6878 -0.7039 C 0.6909 -0.7039 0.694 -0.7039 0.6971 -0.7039 C 0.8052 -0.5173 0.8206 -0.2556 0.8179 -0.0323 C 0.8263 -0.0311 0.8263 -0.0311 0.8349 -0.0299 C 0.8772 -0.023 0.9113 -0.002 0.9434 0.0337 C 0.9471 0.0373 0.9508 0.0409 0.9547 0.0446 C 0.966 0.065 0.9658 0.0871 0.9666 0.1116 C 0.9422 0.1309 0.9179 0.1491 0.8923 0.1656 C 0.8892 0.1696 0.8861 0.1735 0.883 0.1776 C 0.9141 0.1945 0.9362 0.1991 0.9701 0.1918 C 0.9852 0.1896 0.9852 0.1896 0.9991 0.2016 C 1 0.2233 1 0.2233 0.9991 0.2436 C 0.9963 0.2451 0.9934 0.2465 0.9904 0.2481 C 0.98 0.2544 0.98 0.2544 0.9766 0.2667 C 0.9591 0.3088 0.9106 0.3323 0.8783 0.3515 C 0.8802 0.3543 0.8822 0.3571 0.8841 0.3599 C 0.9031 0.3893 0.9175 0.4197 0.9306 0.4538 C 0.9321 0.4578 0.9336 0.4617 0.9352 0.4658 C 0.9487 0.5016 0.9629 0.5396 0.9666 0.5794 C 0.9651 0.5814 0.9635 0.5833 0.962 0.5854 C 0.953 0.5848 0.9441 0.5839 0.9352 0.5828 C 0.9038 0.5792 0.8727 0.5788 0.8411 0.5794 C 0.8428 0.5845 0.8444 0.5897 0.8461 0.595 C 0.8672 0.6635 0.8785 0.7294 0.8597 0.8013 C 0.8504 0.8133 0.8504 0.8133 0.8365 0.8148 C 0.8226 0.8133 0.8226 0.8133 0.8133 0.8013 C 0.8133 0.7933 0.8133 0.7854 0.8133 0.7773 C 0.8102 0.7759 0.8071 0.7746 0.804 0.7731 C 0.7921 0.7665 0.7825 0.7593 0.7717 0.7503 C 0.7567 0.7378 0.7424 0.7295 0.725 0.7233 C 0.7235 0.7273 0.7219 0.7312 0.7203 0.7353 C 0.7234 0.7373 0.7265 0.7393 0.7296 0.7413 C 0.7266 0.7433 0.7235 0.7452 0.7203 0.7473 C 0.7156 0.7585 0.7112 0.7699 0.707 0.7814 C 0.7022 0.794 0.6973 0.8066 0.6925 0.8192 C 0.6909 0.8234 0.6893 0.8275 0.6877 0.8318 C 0.6792 0.8512 0.6742 0.8551 0.6573 0.8616 C 0.6414 0.8612 0.6414 0.8612 0.6324 0.8549 C 0.6274 0.8432 0.6274 0.8432 0.6277 0.8256 C 0.629 0.8065 0.629 0.8065 0.6181 0.7941 C 0.615 0.7905 0.612 0.787 0.6088 0.7833 C 0.6051 0.7875 0.6051 0.7875 0.6012 0.7919 C 0.4007 1 0.0448 0.966 -0.195 0.9332 C -0.2325 0.9273 -0.2695 0.9189 -0.3065 0.9092 C -0.3115 0.9079 -0.3165 0.9067 -0.3217 0.9054 C -0.3917 0.8873 -0.4632 0.8668 -0.5234 0.8144 C -0.5373 0.8052 -0.5427 0.8072 -0.5574 0.8133 C -0.5715 0.8193 -0.5855 0.8257 -0.5995 0.8322 C -0.6128 0.8371 -0.6228 0.8388 -0.6364 0.8372 C -0.6448 0.8301 -0.6448 0.8301 -0.6504 0.8192 C -0.6521 0.8046 -0.6521 0.8046 -0.6504 0.7893 C -0.648 0.7857 -0.6457 0.7821 -0.6433 0.7784 C -0.6345 0.7617 -0.6348 0.7515 -0.6353 0.7315 C -0.6354 0.7229 -0.6354 0.7229 -0.6355 0.7141 C -0.6357 0.6993 -0.6357 0.6993 -0.6411 0.6873 C -0.6549 0.6911 -0.6549 0.6911 -0.6689 0.6993 C -0.6743 0.7129 -0.6743 0.7129 -0.6782 0.7293 C -0.6799 0.735 -0.6815 0.7408 -0.6832 0.7467 C -0.6848 0.7524 -0.6864 0.7582 -0.6881 0.7642 C -0.6897 0.77 -0.6914 0.7759 -0.6931 0.7819 C -0.6943 0.7863 -0.6955 0.7907 -0.6968 0.7953 C -0.7125 0.796 -0.7125 0.796 -0.7293 0.7953 C -0.7409 0.7803 -0.7428 0.7673 -0.7479 0.7473 C -0.7515 0.7382 -0.7515 0.7382 -0.7552 0.7289 C -0.7649 0.7034 -0.7671 0.6804 -0.767 0.6522 C -0.767 0.6468 -0.7669 0.6415 -0.7669 0.6361 C -0.7669 0.6279 -0.7669 0.6279 -0.7668 0.6195 C -0.7668 0.6139 -0.7668 0.6083 -0.7667 0.6026 C -0.7667 0.5888 -0.7666 0.5751 -0.7665 0.5614 C -0.7741 0.5656 -0.7817 0.57 -0.7892 0.5745 C -0.7955 0.5782 -0.7955 0.5782 -0.8019 0.5819 C -0.8151 0.5932 -0.8179 0.602 -0.8223 0.6214 C -0.8253 0.6214 -0.8284 0.6214 -0.8316 0.6214 C -0.8336 0.6243 -0.8356 0.6273 -0.8377 0.6304 C -0.8455 0.6393 -0.8455 0.6393 -0.8571 0.6416 C -0.871 0.6389 -0.8742 0.6354 -0.8827 0.6214 C -0.8844 0.6089 -0.8844 0.6089 -0.8844 0.5946 C -0.8844 0.5894 -0.8844 0.5842 -0.8844 0.5789 C -0.8843 0.5735 -0.8842 0.5681 -0.8841 0.5625 C -0.8842 0.5545 -0.8842 0.5545 -0.8842 0.5463 C -0.884 0.5171 -0.8822 0.4929 -0.8734 0.4654 C -0.8765 0.4654 -0.8795 0.4654 -0.8827 0.4654 C -0.878 0.4535 -0.878 0.4535 -0.8687 0.4355 C -0.8647 0.4271 -0.8606 0.4187 -0.8565 0.4104 C -0.8534 0.4039 -0.8534 0.4039 -0.8503 0.3973 C -0.8487 0.3941 -0.8471 0.3908 -0.8455 0.3875 C -0.8726 0.3746 -0.8962 0.3723 -0.9245 0.3815 C -0.9348 0.3885 -0.944 0.3964 -0.9535 0.4049 C -0.9647 0.4139 -0.9721 0.4152 -0.9849 0.4115 C -0.9933 0.4044 -0.9933 0.4044 -0.9988 0.3935 C -1 0.3777 -1 0.3777 -0.9988 0.3635 C -0.9973 0.3615 -0.9958 0.3595 -0.9942 0.3575 C -0.993 0.3477 -0.992 0.3378 -0.991 0.3279 C -0.9844 0.2798 -0.9686 0.2412 -0.9384 0.211 C -0.9001 0.1776 -0.9001 0.1776 -0.878 0.1776 C -0.8813 0.167 -0.8813 0.167 -0.8847 0.1562 C -0.8983 0.1128 -0.8975 0.0671 -0.8975 0.0209 C -0.8975 0.0151 -0.8976 0.0092 -0.8977 0.0032 C -0.8977 -0.0053 -0.8977 -0.0053 -0.8977 -0.014 C -0.8977 -0.0191 -0.8977 -0.0242 -0.8977 -0.0294 C -0.8965 -0.0461 -0.8927 -0.059 -0.8873 -0.0743 C -0.8694 -0.071 -0.8588 -0.0661 -0.8455 -0.0503 C -0.8401 -0.0337 -0.8365 -0.0171 -0.8326 0.0001 C -0.8253 0.0202 -0.8193 0.0247 -0.8037 0.0337 C -0.7914 0.0384 -0.7791 0.0421 -0.7665 0.0457 C -0.7666 0.0383 -0.7666 0.0383 -0.7667 0.0308 C -0.7681 -0.1395 -0.7628 -0.3055 -0.7247 -0.47 C -0.7237 -0.4746 -0.7227 -0.4792 -0.7217 -0.4838 C -0.7135 -0.5208 -0.703 -0.5554 -0.6907 -0.5903 C -0.689 -0.5953 -0.6873 -0.6003 -0.6856 -0.6055 C -0.6583 -0.6837 -0.617 -0.75 -0.5685 -0.8081 C -0.566 -0.811 -0.5636 -0.8139 -0.5611 -0.817 C -0.5276 -0.856 -0.4931 -0.8815 -0.452 -0.9055 C -0.445 -0.9098 -0.445 -0.9098 -0.4378 -0.9142 C -0.4054 -0.9333 -0.3738 -0.9462 -0.339 -0.9558 C -0.3358 -0.9567 -0.3325 -0.9576 -0.3292 -0.9586 C -0.2129 -0.9916 -0.0951 -1 0.0237 -0.9992 Z';
function fluffyPath(cx, cy, w, h) {
  let i = 0;
  const WIDEN = 1.17; // v15.5: fluffy body wider than the drawn silhouette (+17%)
  return FLUFFY_UNIT.replace(/-?\d*\.?\d+/g, (n) => {
    const v = parseFloat(n);
    const out = (i++ % 2 === 0) ? cx + w * v * WIDEN : cy + h * v;
    return out.toFixed(2);
  });
}

// v15.7: player-drawn 'spiky' body silhouette (traced, normalized to a unit box).
const SPIKY_UNIT = 'M -0.0497 -1 C 0.0629 -0.9901 0.1474 -0.92 0.2237 -0.8416 C 0.291 -0.7617 0.3325 -0.6618 0.3656 -0.5639 C 0.395 -0.5928 0.3853 -0.6541 0.3873 -0.6942 C 0.3882 -0.7107 0.3882 -0.7107 0.3891 -0.7275 C 0.3905 -0.7548 0.3919 -0.782 0.3933 -0.8092 C 0.4749 -0.7976 0.527 -0.7791 0.5817 -0.715 C 0.6348 -0.642 0.663 -0.5692 0.6841 -0.4822 C 0.7152 -0.5188 0.7378 -0.5455 0.7533 -0.5912 C 0.7784 -0.5886 0.7784 -0.5886 0.8087 -0.5776 C 1 -0.3155 0.9954 0.0569 0.961 0.3627 C 0.9518 0.415 0.938 0.4628 0.9194 0.5126 C 0.9139 0.528 0.9083 0.5434 0.9026 0.5593 C 0.8437 0.7088 0.7587 0.8257 0.6141 0.9044 C 0.468 0.9652 0.3047 0.9911 0.1471 0.9928 C 0.137 0.9929 0.1269 0.993 0.1165 0.9932 C -0.5313 1 -0.5313 1 -0.7459 0.812 C -0.8546 0.7018 -0.9146 0.5678 -0.9358 0.4172 C -0.9396 0.397 -0.9396 0.397 -0.9435 0.3764 C -1 0.0529 -0.9844 -0.3364 -0.7973 -0.6184 C -0.7558 -0.6048 -0.7558 -0.6048 -0.729 -0.5648 C -0.7018 -0.525 -0.6896 -0.5115 -0.6451 -0.4958 C -0.6445 -0.5068 -0.6439 -0.5177 -0.6433 -0.529 C -0.6146 -0.6442 -0.5408 -0.7125 -0.4438 -0.7777 C -0.4097 -0.7956 -0.4097 -0.7956 -0.3405 -0.8092 C -0.3496 -0.7328 -0.3587 -0.6563 -0.3682 -0.5776 C -0.3028 -0.6396 -0.3028 -0.6396 -0.2643 -0.6874 C -0.2297 -0.7275 -0.2297 -0.7275 -0.1951 -0.7513 C -0.1341 -0.8053 -0.1059 -0.8816 -0.0763 -0.9558 C -0.0636 -0.9864 -0.0636 -0.9864 -0.0497 -1 Z';
function spikyPath(cx, cy, w, h) {
  let i = 0;
  return SPIKY_UNIT.replace(/-?\d*\.?\d+/g, (n) => {
    const v = parseFloat(n);
    const out = (i++ % 2 === 0) ? cx + w * v : cy + h * v;
    return out.toFixed(2);
  });
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
    case 'blank':
      // v15.2: like manga but ALL WHITE with a black outline (single circle).
      return `<circle cx="${x}" cy="${y}" r="${r}" fill="#ffffff" stroke="#1c1026" stroke-width="${r * 0.26}"/>`;
    case 'cat': {
      // v15.6: wide white eye with a vertical slit, CUT OFF on top by a heavy
      // upper lid → an unimpressed / "done-with-it" look. No yellow.
      const cyE = y + r * 0.28;
      const rx = r * 0.98, ry = r * 0.74;
      const yLid = cyE - ry * 0.1; // lid line: only the lower ~55% of the eye shows
      return (
        `<ellipse cx="${x}" cy="${cyE}" rx="${rx}" ry="${ry}" fill="#ffffff" stroke="#1c1026" stroke-width="${r * 0.16}"/>` +
        `<ellipse cx="${x}" cy="${cyE}" rx="${r * 0.2}" ry="${r * 0.56}" fill="#1c1026"/>` +
        `<circle cx="${x - r * 0.32}" cy="${cyE + r * 0.02}" r="${r * 0.12}" fill="#ffffff"/>` +
        // heavy upper lid: skin cover erases the top, dark crease draws the cut
        `<path d="M ${x - rx - 1} ${cyE - ry - 2} L ${x + rx + 1} ${cyE - ry - 2} L ${x + rx + 1} ${yLid} L ${x - rx - 1} ${yLid} Z" fill="${pal.body}"/>` +
        `<line x1="${x - rx}" y1="${yLid}" x2="${x + rx}" y2="${yLid}" stroke="#1c1026" stroke-width="${r * 0.2}" stroke-linecap="round"/>`
      );
    }
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

const FANG2_MOUTH = 'M 0.9573 -1 C 0.9759 -0.9952 0.9759 -0.9952 0.9949 -0.9903 C 1 -0.8683 1 -0.8683 0.9949 -0.7224 C 0.9753 -0.6811 0.9753 -0.6811 0.9552 -0.6389 C 0.8987 -0.4939 0.8969 -0.3789 0.8886 -0.1889 C 0.8637 0.2581 0.8269 0.6739 0.6843 1 C 0.6172 0.978 0.5709 0.889 0.5188 0.7943 C 0.5095 0.7776 0.5001 0.7609 0.4905 0.7437 C 0.4092 0.5941 0.3468 0.4257 0.284 0.2329 C 0.2442 0.1433 0.2442 0.1433 0.1863 0.165 C 0.175 0.1701 0.1637 0.1753 0.1521 0.1806 C 0.0679 0.2136 -0.0182 0.2049 -0.1033 0.2058 C -0.122 0.2066 -0.1407 0.2074 -0.1599 0.2082 C -0.3616 0.2103 -0.5331 0.1149 -0.7112 -0.1052 C -0.7249 -0.1213 -0.7385 -0.1374 -0.7526 -0.1541 C -0.9652 -0.4096 -0.9652 -0.4096 -0.9993 -0.5693 C -0.9999 -0.6458 -1 -0.7224 -0.9993 -0.7989 C -0.9723 -0.8115 -0.9453 -0.8242 -0.9176 -0.8372 C -0.9098 -0.804 -0.9021 -0.7709 -0.8941 -0.7367 C -0.8186 -0.4773 -0.692 -0.3578 -0.5733 -0.2344 C -0.5625 -0.2231 -0.5517 -0.2119 -0.5406 -0.2003 C -0.205 0.1361 0.203 0.0021 0.5393 -0.275 C 0.6882 -0.4221 0.7974 -0.6053 0.8859 -0.9243 C 0.9132 -0.9903 0.9132 -0.9903 0.9573 -1 Z';
const FANG2_TOOTH = 'M 0.7824 -0.3779 C 0.7932 -0.3779 0.804 -0.3779 0.8151 -0.3779 C 0.8119 0.0296 0.7827 0.4249 0.6843 0.7704 C 0.6034 0.755 0.5603 0.6581 0.5045 0.5311 C 0.4962 0.5128 0.4879 0.4945 0.4794 0.4757 C 0.4548 0.4213 0.4306 0.3662 0.4064 0.3111 C 0.3909 0.2765 0.3754 0.242 0.3595 0.2064 C 0.3247 0.1197 0.3247 0.1197 0.3247 0.0431 C 0.3341 0.0368 0.3435 0.0304 0.3532 0.0239 C 0.3962 -0.0054 0.4391 -0.0349 0.482 -0.0645 C 0.4968 -0.0745 0.5116 -0.0845 0.5268 -0.0948 C 0.6057 -0.1494 0.6766 -0.2114 0.7497 -0.3013 C 0.7605 -0.3013 0.7713 -0.3013 0.7824 -0.3013 C 0.7824 -0.3266 0.7824 -0.3519 0.7824 -0.3779 Z';
const FANG2_ASPECT = 2.3416;
// v15.8: player-drawn (bigger) fang mouth — two traced paths sharing one
// normalized box. The mouth shape is recolored to the pet's OUTLINE color; the
// fang stays white with a pet-outline stroke. Scaled to the mouth width, aspect
// preserved, sat a touch lower.
function fangMouth(x, y, w, pal) {
  const SX = w * 0.8;            // half rendered width (target ~1.6w)
  const SY = SX / FANG2_ASPECT;  // preserve aspect
  const cyc = y + 6;
  const oc = pal.outline;
  const map = (unit) => {
    let i = 0;
    return unit.replace(/-?\d*\.?\d+/g, (n) => {
      const v = parseFloat(n);
      const out = (i++ % 2 === 0) ? (x + v * SX) : (cyc + v * SY);
      return out.toFixed(2);
    });
  };
  return `<path d="${map(FANG2_MOUTH)}" fill="${oc}"/>` +
    `<path d="${map(FANG2_TOOTH)}" fill="#ffffff" stroke="${oc}" stroke-width="${(w * 0.05).toFixed(2)}" stroke-linejoin="round"/>`;
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
      // v15.2: clean U-shaped open mouth with an outline (no tongue sticking out).
      return `<path d="M ${x - w * 0.32} ${y - w * 0.02} L ${x - w * 0.32} ${y + w * 0.14} Q ${x - w * 0.32} ${y + w * 0.6} ${x} ${y + w * 0.6} Q ${x + w * 0.32} ${y + w * 0.6} ${x + w * 0.32} ${y + w * 0.14} L ${x + w * 0.32} ${y - w * 0.02} Z" fill="${c}" stroke="${pal.outline}" stroke-width="2" stroke-linejoin="round"/>`;
    case 'w':
      // v15: squashed to HALF its former height (control offsets 0.5->0.25,
      // dip 0.08->0.04) so it reads distinct from 'cat'. Same width.
      return `<path d="M ${x - w * 0.5} ${y} Q ${x - w * 0.25} ${y + w * 0.25} ${x} ${y + w * 0.04} Q ${x + w * 0.25} ${y + w * 0.25} ${x + w * 0.5} ${y}" fill="none" stroke="${c}" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/>`;
    case 'fang':
      // v15.8: player-drawn fang mouth (traced), recolored to the pet.
      return fangMouth(x, y, w, pal);
    case 'smile':
    default:
      return `<path d="M ${x - w * 0.42} ${y} Q ${x} ${y + w * 0.6} ${x + w * 0.42} ${y}" fill="none" stroke="${c}" stroke-width="2.6" stroke-linecap="round"/>`;
  }
}

// v15.8: player-drawn cat EAR (traced): outer silhouette + inner ear, normalized
// to the outer's unit box.
const EAR_OUTER = 'M -0.7872 -0.9954 C -0.6371 -1 -0.5101 -0.9884 -0.3665 -0.9493 C -0.348 -0.9444 -0.3296 -0.9394 -0.3106 -0.9343 C 0.0706 -0.8257 0.356 -0.6069 0.5696 -0.3257 C 0.6047 -0.3404 0.6399 -0.3552 0.676 -0.3703 C 0.6806 -0.3531 0.6851 -0.3359 0.6898 -0.3182 C 0.6962 -0.2958 0.7026 -0.2734 0.7093 -0.2503 C 0.7155 -0.2281 0.7216 -0.2058 0.728 -0.1829 C 0.7616 -0.1129 0.7835 -0.11 0.8623 -0.0801 C 0.9932 0.0871 1 0.2937 0.957 0.4852 C 0.8929 0.6565 0.7533 0.7729 0.5673 0.8563 C 0.2828 0.9758 0.0636 1 -0.2551 0.9914 C -0.2891 0.9914 -0.3231 0.9914 -0.3582 0.9914 C -0.4695 0.9615 -0.5248 0.9078 -0.6029 0.8366 C -0.6477 0.7962 -0.6926 0.7619 -0.7439 0.7277 C -0.8138 0.6789 -0.8138 0.6789 -0.867 0.6119 C -0.867 0.5898 -0.867 0.5677 -0.867 0.5449 C -0.8231 0.5449 -0.7792 0.5449 -0.734 0.5449 C -0.7493 0.5347 -0.7647 0.5244 -0.7805 0.5139 C -0.8003 0.5002 -0.82 0.4865 -0.8404 0.4724 C -0.8601 0.4589 -0.8799 0.4454 -0.9002 0.4316 C -0.9468 0.3887 -0.9468 0.3887 -0.9468 0.2994 C -0.9547 0.2602 -0.9636 0.2211 -0.9734 0.1822 C -0.9808 0.1523 -0.9808 0.1523 -0.9884 0.1218 C -0.9922 0.1067 -0.996 0.0917 -1 0.0761 C -0.9737 0.0614 -0.9473 0.0467 -0.9202 0.0315 C -0.9104 -0.0262 -0.9104 -0.0262 -0.9152 -0.0937 C -0.9159 -0.1192 -0.9165 -0.1447 -0.9172 -0.1709 C -0.9182 -0.1981 -0.9192 -0.2252 -0.9202 -0.2531 C -0.9253 -0.5185 -0.9105 -0.7478 -0.7872 -0.9954 Z';
const EAR_INNER = 'M -0.5477 -0.7721 C -0.2519 -0.6604 -0.0779 -0.429 0.0465 -0.1883 C 0.0641 -0.1471 0.0641 -0.1471 0.0641 -0.1025 C 0.0203 -0.0951 -0.0236 -0.0877 -0.0689 -0.0801 C -0.0425 -0.0668 -0.0162 -0.0534 0.0109 -0.0397 C 0.0373 -0.0236 0.0636 -0.0074 0.0908 0.0092 C 0.0908 0.0313 0.0908 0.0534 0.0908 0.0761 C -0.1335 0.1048 -0.1335 0.1048 -0.2551 0.0761 C -0.2288 0.113 -0.2024 0.1498 -0.1753 0.1877 C -0.2411 0.1988 -0.2411 0.1988 -0.3083 0.2101 C -0.3083 0.2322 -0.3083 0.2543 -0.3083 0.277 C -0.361 0.2881 -0.361 0.2881 -0.4147 0.2994 C -0.4147 0.3215 -0.4147 0.3436 -0.4147 0.3663 C -0.4411 0.3663 -0.4674 0.3663 -0.4945 0.3663 C -0.6128 0.2063 -0.6229 0.0602 -0.6275 -0.1248 C -0.6282 -0.1436 -0.6289 -0.1625 -0.6296 -0.1819 C -0.6317 -0.2438 -0.6331 -0.3057 -0.6342 -0.3675 C -0.6348 -0.3872 -0.6353 -0.4068 -0.6359 -0.427 C -0.6367 -0.5575 -0.6105 -0.6526 -0.5477 -0.7721 Z';
const EAR_ASPECT = 0.8391;

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
        // v15.8: player-drawn cat ear (traced). Outer -> pet body+outline,
        // inner -> blush. Placed on the head; the opposite side is mirrored.
        const ay = topY + 12;
        const Hr = w * 0.85;
        const SY = Hr / 2;
        const SX = SY * EAR_ASPECT;
        const mapEar = (unit) => {
          let i = 0;
          return unit.replace(/-?\d*\.?\d+/g, (n) => {
            const v = parseFloat(n);
            const out = (i++ % 2 === 0) ? (mx + v * SX * flip) : (ay + (v - 1) * SY);
            return out.toFixed(2);
          });
        };
        return `<path d="${mapEar(EAR_OUTER)}" fill="${fill}" stroke="${st}" stroke-width="2" stroke-linejoin="round"/>` +
          `<path d="${mapEar(EAR_INNER)}" fill="${inner}"/>`;
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

// v15.7: player-drawn devil-horn PAIR (traced silhouettes, normalized to a unit box).
const DEVIL_UNIT = 'M -0.6875 -1 C -0.6577 -0.9758 -0.628 -0.9516 -0.5973 -0.9266 C -0.5993 -0.896 -0.6012 -0.8654 -0.6032 -0.8338 C -0.6241 -0.4612 -0.6241 -0.4612 -0.5613 -0.1192 C -0.521 -0.0424 -0.4799 0.0225 -0.4344 0.0859 C -0.399 0.1377 -0.399 0.1377 -0.381 0.2111 C -0.3742 0.3782 -0.3721 0.4687 -0.4092 0.6194 C -0.545 0.9456 -0.545 0.9456 -0.6526 0.9841 C -0.7538 0.9808 -0.8038 0.9193 -0.8802 0.7891 C -0.9728 0.565 -1 0.3172 -0.994 0.0276 C -0.9515 -0.3907 -0.8543 -0.742 -0.6875 -1 Z M 0.6286 -1 C 0.7686 -0.9105 0.8495 -0.665 0.9171 -0.4128 C 1 -0.0514 0.9961 0.2428 0.9351 0.6148 C 0.9001 0.7729 0.8584 0.8556 0.7841 0.9451 C 0.6864 1 0.6245 0.9815 0.5362 0.8809 C 0.4846 0.7986 0.4393 0.7117 0.3943 0.6148 C 0.3883 0.6027 0.3824 0.5906 0.3762 0.5781 C 0.3749 0.5162 0.3747 0.4542 0.3751 0.3923 C 0.3753 0.3586 0.3754 0.3248 0.3756 0.2901 C 0.3758 0.264 0.376 0.238 0.3762 0.2111 C 0.3881 0.2111 0.4 0.2111 0.4123 0.2111 C 0.416 0.1907 0.4197 0.1702 0.4236 0.1492 C 0.4483 0.0643 0.4483 0.0643 0.5013 -0.0206 C 0.563 -0.1212 0.5881 -0.2201 0.6106 -0.3761 C 0.6051 -0.5128 0.6051 -0.5128 0.5926 -0.633 C 0.5985 -0.6572 0.6045 -0.6814 0.6106 -0.7064 C 0.6073 -0.7427 0.6039 -0.7791 0.6005 -0.8165 C 0.5966 -0.871 0.5966 -0.871 0.5926 -0.9266 C 0.6045 -0.9508 0.6164 -0.975 0.6286 -1 Z';
const DEVIL_HW = 55.46525, DEVIL_HH = 27.24804;

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
      // v15.2: 50% wider base (18 -> 27). Base still runs behind the body.
      return `<path d="M ${cx} ${topY - 30} l 13.5 72 l -27 0 Z" fill="${c}" stroke="${st}" stroke-width="2" stroke-linejoin="round"/>`;
    case 'double':
      // v15.2: 50% wider base (14 -> 21).
      return (
        `<path d="M ${cx - 16} ${topY - 23} l 10.5 67 l -21 0 Z" fill="${c}" stroke="${st}" stroke-width="2" stroke-linejoin="round"/>` +
        `<path d="M ${cx + 16} ${topY - 23} l 10.5 67 l -21 0 Z" fill="${c}" stroke="${st}" stroke-width="2" stroke-linejoin="round"/>`
      );
    case 'devil': {
      // v15.7: player-drawn devil horns (traced pair). Colored with the pet's
      // horn/outline colors, scaled onto the head with aspect preserved. Bases
      // run a little into the head (hidden behind the body).
      const SX = L.w * 0.95;
      const SY = SX * (DEVIL_HH / DEVIL_HW);
      const baseY = topY + 8 - SY;
      let i = 0;
      const d = DEVIL_UNIT.replace(/-?\d*\.?\d+/g, (n) => {
        const v = parseFloat(n);
        const out = (i++ % 2 === 0) ? cx + v * SX : baseY + v * SY;
        return out.toFixed(2);
      });
      return `<path d="${d}" fill="${c}" stroke="${st}" stroke-width="2" stroke-linejoin="round"/>`;
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
      // v15.2: open curl that sweeps out, over the top, and ENDS pointing UP
      // (no longer loops back down behind the body).
      return `<path d="M ${rx - 4} ${by} q 31 -7 29 -29 q -3 -20 -20 -18 q -9 1 -7 -11" fill="none" stroke="${pal.bodyDark}" stroke-width="9.6" stroke-linecap="round"/>`;
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
  const cyc = eyeY + eyeR * 1.02 + 4; // v15.5: 4px higher (was +8)
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
  const eyeDX = L.w * 0.4 + 5; // v15.3: eyes 10px farther apart (5 per side)
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
  const eyeDX = L.w * 0.4 + 5; // v15.3: eyes 10px farther apart (5 per side)
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
