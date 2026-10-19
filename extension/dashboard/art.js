// Little SVG illustrations for the dashboard: a village scene drawn from the
// village's real state, and a hero portrait. Colours come from CSS classes so
// they follow light/dark mode.
import { FIELD_RESOURCE } from '../src/shared.js';
import { wallOf } from '../src/advisor.js';

let uid = 0;

// Small deterministic random generator so each village always looks the same.
function seeded(str) {
  let h = 2166136261;
  for (const c of String(str)) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return () => {
    h += 0x6d2b79f5;
    let x = h;
    x = Math.imul(x ^ (x >>> 15), x | 1);
    x ^= x + Math.imul(x ^ (x >>> 7), x | 61);
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

const levelOf = (v, gid) => Math.max(0, ...(v.buildings || []).filter((b) => b.gid === gid).map((b) => b.level));

function fieldInfo(v) {
  const out = { wood: { n: 0, sum: 0 }, clay: { n: 0, sum: 0 }, iron: { n: 0, sum: 0 }, crop: { n: 0, sum: 0 } };
  for (const f of v.fields || []) {
    const k = FIELD_RESOURCE[f.gid];
    if (k) { out[k].n += 1; out[k].sum += f.level; }
  }
  for (const k of Object.keys(out)) {
    if (!out[k].n) out[k] = { n: k === 'crop' ? 6 : 4, sum: 0 };
    out[k].avg = out[k].sum / out[k].n;
  }
  return out;
}

const r1 = (n) => Math.round(n * 10) / 10;

export function villageArt(v, { label = '', now = Date.now(), wide = false } = {}) {
  const id = `va${++uid}`;
  // Wide banners keep the same village centred and add countryside on both sides.
  const W = wide ? 760 : 360;
  const ox = (W - 360) / 2;
  const rnd = seeded(v.id);
  const main = Math.max(1, levelOf(v, 15));
  const wall = wallOf(v);
  const building = (v.buildQueue || []).some((b) => !b.finishAt || b.finishAt > now);
  const fields = fieldInfo(v);
  const built = (v.buildings || []).filter((b) => b.level > 0).length;
  const parts = [];

  // Sky, sun, clouds, hills.
  parts.push(`<defs><linearGradient id="${id}s" x1="0" y1="0" x2="0" y2="1"><stop offset="0" class="sky-top"/><stop offset="1" class="sky-bottom"/></linearGradient></defs>`);
  parts.push(`<rect width="${W}" height="150" fill="url(#${id}s)"/>`);
  // In banners the sun sits away from the building chips along the top edge.
  parts.push(`<circle cx="${wide ? r1(W * 0.42 + rnd() * 30) : r1(W - 60 + rnd() * 30)}" cy="${wide ? 92 - 30 : 26 + rnd() * 8}" r="13" class="sun"/>`);
  for (let i = 0; i < (wide ? 4 : 2); i++) {
    const cx = 40 + rnd() * (W - 160), cy = 18 + rnd() * 22;
    parts.push(`<g class="cloud"><ellipse cx="${r1(cx)}" cy="${r1(cy)}" rx="18" ry="6"/><ellipse cx="${r1(cx + 12)}" cy="${r1(cy - 4)}" rx="12" ry="6"/></g>`);
  }
  parts.push(`<path class="hill-far" d="M0 92 Q${W / 6} ${62 + rnd() * 10} ${W * 0.36} 86 T${W * 0.72} ${80 + rnd() * 6} T${W} 84 V150 H0Z"/>`);
  parts.push(`<path class="ground" d="M0 104 Q${W / 4} 92 ${W / 2} 100 T${W} 98 V150 H0Z"/>`);
  if (wide) {
    // Countryside on the flanks: woods on one side, wheat and rocks on the other.
    for (let i = 0; i < 9; i++) parts.push(`<g class="tree"><rect x="${r1(14 + i * 22 - 1.2)}" y="${r1(112 + (i % 3) * 9)}" width="2.4" height="4" class="trunk"/><path d="M${r1(14 + i * 22)} ${r1(98 + (i % 3) * 9)} L${r1(8 + i * 22)} ${r1(114 + (i % 3) * 9)} L${r1(20 + i * 22)} ${r1(114 + (i % 3) * 9)}Z"/></g>`);
    for (let i = 0; i < 8; i++) {
      const x = W - 196 + (i % 4) * 46, y = 116 + Math.floor(i / 4) * 14;
      parts.push(`<g class="wheat"><rect x="${x}" y="${y}" width="38" height="9" rx="2"/><path d="M${x + 6} ${y + 1}v7M${x + 14} ${y + 1}v7M${x + 22} ${y + 1}v7M${x + 30} ${y + 1}v7"/></g>`);
    }
  }
  parts.push(`<g transform="translate(${ox} 0)">`);

  // Fields: woods on the far left, clay pits, wheat in front, iron rocks on the right.
  const tree = (x, y, s) => `<g class="tree"><rect x="${r1(x - 1.2)}" y="${r1(y - 3)}" width="2.4" height="${r1(4 * s)}" class="trunk"/><path d="M${r1(x)} ${r1(y - 16 * s)} L${r1(x - 6 * s)} ${r1(y - 2)} L${r1(x + 6 * s)} ${r1(y - 2)}Z"/></g>`;
  const ws = 0.75 + Math.min(1, fields.wood.avg / 12) * 0.5;
  for (let i = 0; i < fields.wood.n; i++) parts.push(tree(14 + i * 13 + rnd() * 4, 118 + (i % 2) * 8, ws));
  for (let i = 0; i < fields.clay.n; i++) parts.push(`<rect class="clay" x="${r1(70 + (i % 2) * 16)}" y="${r1(124 + Math.floor(i / 2) * 9)}" width="13" height="6" rx="2"/>`);
  for (let i = 0; i < fields.crop.n; i++) {
    const x = 118 + (i % 3) * 22, y = 126 + Math.floor(i / 3) * 10;
    parts.push(`<g class="wheat"><rect x="${x}" y="${y}" width="19" height="7" rx="1.5"/><path d="M${x + 3} ${y + 1}v5M${x + 8} ${y + 1}v5M${x + 13} ${y + 1}v5"/></g>`);
  }
  for (let i = 0; i < fields.iron.n; i++) {
    const x = 262 + (i % 2) * 20 + rnd() * 6, y = 124 + Math.floor(i / 2) * 10;
    parts.push(`<path class="rock" d="M${r1(x)} ${r1(y + 7)} L${r1(x + 4)} ${r1(y)} L${r1(x + 11)} ${r1(y + 1)} L${r1(x + 15)} ${r1(y + 7)}Z"/>`);
  }

  // Houses around the keep; more buildings, more houses.
  const houses = Math.max(2, Math.min(8, 2 + Math.floor(built / 3)));
  const house = (x, y) => `<g class="house"><rect x="${r1(x)}" y="${r1(y)}" width="16" height="11"/><path class="roof" d="M${r1(x - 2)} ${r1(y)} L${r1(x + 8)} ${r1(y - 8)} L${r1(x + 18)} ${r1(y)}Z"/><rect class="window" x="${r1(x + 6)}" y="${r1(y + 4)}" width="4" height="4"/></g>`;
  for (let i = 0; i < houses; i++) {
    const side = i % 2 ? 1 : -1;
    const step = Math.floor(i / 2);
    parts.push(house(180 + side * (34 + step * 22) - 8 + rnd() * 4, 96 + (step % 2) * 4 + rnd() * 3));
  }

  // The keep grows with the Main Building.
  const h = 30 + Math.min(20, main) * 2;
  const top = 106 - h;
  parts.push(`<g class="keep"><rect x="164" y="${top}" width="32" height="${h}"/>${[0, 1, 2, 3].map((i) => `<rect x="${164 + i * 9}" y="${top - 5}" width="5" height="6"/>`).join('')}<path class="door" d="M175 106 V96 a5 5 0 0 1 10 0 V106Z"/><rect class="window" x="177" y="${top + 8}" width="6" height="8" rx="3"/></g>`);
  parts.push(`<line x1="180" y1="${top - 5}" x2="180" y2="${top - 24}" class="pole"/><path class="${v.underAttack ? 'flag bad' : 'flag'}" d="M180 ${top - 24} L196 ${top - 19} L180 ${top - 14}Z"/>`);

  // Scaffolding while something is being built.
  if (building) {
    parts.push(`<g class="scaffold"><path d="M200 106 V${top + 6} M214 106 V${top + 6} M200 ${top + 14} H214 M200 ${top + 30} H214 M200 ${top + 46} H214 M200 ${top + 14} L214 ${top + 30} M214 ${top + 30} L200 ${top + 46}"/><path d="M214 ${top + 6} V${top - 10} H238 M234 ${top - 10} V${top + 2}"/><rect x="231" y="${top + 2}" width="6" height="5" class="crate"/></g>`);
  }

  // The wall rings the village front; taller with level.
  if (wall) {
    const th = 5 + Math.min(20, wall.level) * 0.25;
    const crenels = [];
    for (let x = 118; x <= 242; x += 9) {
      const u = (x + 2.5 - 181) / 67; // follow the wall's curve
      const y = 112 - th + 6 * (1 - u * u);
      crenels.push(`<rect x="${x}" y="${r1(y - 4)}" width="5" height="4.5"/>`);
    }
    parts.push(`<g class="wall"><path d="M114 ${r1(108 - th + 4)} Q180 ${r1(124 - th)} 248 ${r1(108 - th + 4)} V112 Q180 128 114 112Z"/>${crenels.join('')}</g>`);
  }

  parts.push('</g>');
  if (v.underAttack) {
    parts.push(`<rect width="${W}" height="150" class="attack-tint"/>`);
    // Beside the village, so it stays in view however much of the sides is cropped.
    const bx = ox + 30, by = wide ? 52 : 30;
    parts.push(`<g class="attack-badge"><circle cx="${bx}" cy="${by}" r="14"/><text x="${bx}" y="${by + 5}" text-anchor="middle">⚔</text></g>`);
  }
  return `<svg viewBox="0 0 ${W} 150" class="art village-art" role="img" aria-label="${label}" preserveAspectRatio="xMidYMax slice">${parts.join('')}</svg>`;
}

export function heroArt({ home = true } = {}) {
  return `<svg viewBox="0 0 120 120" class="art hero-art" aria-hidden="true">
    <circle cx="60" cy="60" r="58" class="hero-bg"/>
    <path class="cape" d="M24 118 C26 84 40 74 60 74 C80 74 94 84 96 118Z"/>
    <path class="armor" d="M32 118 C34 92 44 82 60 82 C76 82 86 92 88 118Z"/>
    <path class="belt" d="M40 106 H80 V111 H40Z"/>
    <rect x="52" y="66" width="16" height="12" class="skin"/>
    <circle cx="60" cy="54" r="17" class="skin"/>
    <path class="helmet" d="M41 54 C41 34 79 34 79 54 L79 58 L71 58 L71 50 L49 50 L49 58 L41 58Z"/>
    <path class="crest" d="M56 30 C58 18 70 16 76 24 C70 24 64 28 62 34Z"/>
    <rect x="58" y="44" width="4" height="14" class="helmet"/>
    <circle cx="53" cy="56" r="1.8" class="eye"/><circle cx="67" cy="56" r="1.8" class="eye"/>
    <path class="mouth" d="M55 64 Q60 67 65 64"/>
    <path class="shield" d="M78 84 H100 V98 C100 108 89 114 89 114 C89 114 78 108 78 98Z"/>
    <path class="emblem" d="M89 88 L92 95 L99 95 L93 99 L95 106 L89 102 L83 106 L85 99 L79 95 L86 95Z"/>
    ${home ? '' : '<g class="away-badge"><circle cx="22" cy="24" r="14"/><path d="M22 15 c-5 0 -8 4 -8 8 c0 6 8 13 8 13 s8 -7 8 -13 c0 -4 -3 -8 -8 -8z M22 20 a3 3 0 1 1 0 6 a3 3 0 1 1 0 -6z"/></g>'}
  </svg>`;
}
