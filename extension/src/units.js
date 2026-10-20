// Unit icons: one small drawing per kind of unit (infantry, cavalry, scout,
// ram, catapult, chief, settler, hero, animal), the same for every tribe.
// The game's own pictures can't be used outside its pages.

// Tribes come in blocks of ten unit numbers: u1–u10 Romans, u11–u20
// Teutons, u21–u30 Gauls, u31–u40 animals, u41–u50 Natars, u51–u60
// Egyptians, u61–u70 Huns, u71–u80 Spartans. Slot 7–10 is the same kind
// for everyone; 1–6 differ.
const TRIBE_KINDS = {
  0: ['inf', 'inf', 'inf', 'scout', 'cav', 'cav'],      // Romans
  10: ['inf', 'inf', 'inf', 'scout', 'cav', 'cav'],     // Teutons (scout on foot)
  20: ['inf', 'inf', 'scout', 'cav', 'cav', 'cav'],     // Gauls
  40: ['inf', 'inf', 'inf', 'scout', 'cav', 'cav'],     // Natars
  50: ['inf', 'inf', 'inf', 'scout', 'cav', 'cav'],     // Egyptians
  60: ['inf', 'inf', 'scout', 'cav', 'cav', 'cav'],     // Huns
  70: ['inf', 'scout', 'inf', 'inf', 'cav', 'cav'],     // Spartans
};
const LATE = ['ram', 'cat', 'chief', 'settler'];

const num = (unit) => Number(String(unit || '').replace(/^u/, '')) || 0;

// What kind of unit a game unit number is ("u24" → "cav").
export function unitKind(unit) {
  if (unit === 'hero' || unit === 'uhero') return 'hero';
  const n = num(unit);
  if (!n) return 'inf';
  const base = Math.floor((n - 1) / 10) * 10;
  if (base === 30) return 'animal';
  const slot = (n - 1) % 10;
  if (slot >= 6) return LATE[slot - 6];
  return (TRIBE_KINDS[base] || TRIBE_KINDS[0])[slot];
}

// First unit number of the player's tribe (0, 10, 20, …), from any unit the
// extension has seen in their villages; null until one was seen.
// What the villages can train comes first: troops at home may include
// allies' reinforcements of another tribe.
export function tribeBase(villages) {
  const all = Object.values(villages || {}).filter(Boolean);
  const sources = [
    (v) => Object.values(v.units || {}).flat().map((x) => x.unit),
    (v) => Object.values(v.trainingQueue || {}).flatMap((q) => (q.items || []).map((x) => x.unit)),
    (v) => (v.troops || []).map((x) => x.unit),
  ];
  for (const from of sources) {
    for (const v of all) {
      for (const u of from(v)) {
        const n = num(u);
        const base = Math.floor((n - 1) / 10) * 10;
        if (n && base !== 30) return base;
      }
    }
  }
  return null;
}

// Form field (t1..t11) → kind, for the player's tribe.
export function fieldKind(field, base) {
  if (field === 't11') return 'hero';
  const i = Number(String(field).slice(1));
  return i ? unitKind(`u${(base ?? 0) + i}`) : 'inf';
}

const PATHS = {
  // Sword
  inf: '<path d="M14.5 4.5 19.5 4.5 19.5 9.5 10 19"/><path d="M5 14l5 5M7.5 16.5 4.5 19.5"/>',
  // Horse head
  cav: '<path d="M7 20c0-4 1.5-6 3-7.5L8 9.5l2-1 2.5 1.5L15 5l1.5 3 3 2.5-1 2-2.5-.5L14 14v6"/><circle cx="15.2" cy="9" r=".6" fill="currentColor" stroke="none"/>',
  // Eye
  scout: '<path d="M2.5 12S6 6 12 6s9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6Z"/><circle cx="12" cy="12" r="2.6"/>',
  // Battering ram: log on wheels
  ram: '<path d="M3 11h15l3 1.5-3 1.5H3z"/><circle cx="7" cy="17.5" r="2"/><circle cx="15" cy="17.5" r="2"/>',
  // Catapult: arm, bucket, wheels
  cat: '<path d="M4 16h14M6 16l7-9.5"/><circle cx="14.5" cy="5.5" r="2"/><circle cx="7" cy="18.5" r="1.8"/><circle cx="15" cy="18.5" r="1.8"/>',
  // Crown
  chief: '<path d="M4 17.5 3 7.5l5 4 4-6 4 6 5-4-1 10z"/><path d="M4.5 20.5h15"/>',
  // Covered wagon
  settler: '<path d="M4 15V10a5 5 0 0 1 5-5h6a5 5 0 0 1 5 5v5z"/><path d="M9 5v10M15 5v10"/><circle cx="7.5" cy="18" r="1.8"/><circle cx="16.5" cy="18" r="1.8"/>',
  // Star
  hero: '<path d="m12 3.5 2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.9l-5.2 2.7 1-5.8-4.3-4.1 5.9-.9z"/>',
  // Paw
  animal: '<circle cx="7" cy="9.5" r="1.8"/><circle cx="10.5" cy="6" r="1.8"/><circle cx="14.5" cy="6" r="1.8"/><circle cx="18" cy="9.5" r="1.8"/><path d="M12.5 11c3 0 5 3.5 5 5.5 0 2-1.6 2.5-2.7 2.5-1 0-1.5-.6-2.3-.6s-1.3.6-2.3.6c-1.1 0-2.7-.5-2.7-2.5 0-2 2-5.5 5-5.5z"/>',
};

// Inline SVG for a kind; colour comes from CSS (.uicon.k-<kind>).
export function kindIcon(kind, size = 16) {
  const k = PATHS[kind] ? kind : 'inf';
  return `<svg class="uicon k-${k}" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${PATHS[k]}</svg>`;
}

export const unitIcon = (unit, size) => kindIcon(unitKind(unit), size);
