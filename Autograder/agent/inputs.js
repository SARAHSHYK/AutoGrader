
export const INT_MIN = -2147483648;
export const INT_MAX = 2147483647;
const TYPICAL = 1000;

export const CATEGORIES = [
  "typical", "zero", "negatives", "int_overflow", "boundaries", "empty",
  "single", "large", "whitespace", "duplicates", "sorted", "reverse",
];

export function parseSpec(spec) {
  if (typeof spec !== "string" || !spec) throw new Error("input_spec is missing from the rules file");
  const parts = [];
  const re = /\{([^}]*)\}/g;
  let last = 0, m;
  const num = (v, d) => (v === undefined || v === "" ? d : Number(v));
  while ((m = re.exec(spec))) {
    if (m.index > last) parts.push({ kind: "lit", text: spec.slice(last, m.index) });
    const [type, a, b, c] = m[1].split(":");
    if (type === "int") parts.push({ kind: "int", lo: num(a, INT_MIN), hi: num(b, INT_MAX) });
    else if (type === "n") parts.push({ kind: "size", lo: num(a, 0), hi: num(b, 1000) });
    else if (type === "ints") parts.push({ kind: "ints", lo: num(b, INT_MIN), hi: num(c, INT_MAX) });
    else throw new Error(`input_spec: unknown placeholder {${m[1]}}`);
    last = re.lastIndex;
  }
  if (last < spec.length) parts.push({ kind: "lit", text: spec.slice(last) });
  return parts;
}

function render(parts, size, int) {
  let n = 0, slot = 0, out = "";
  for (const p of parts) {
    if (p.kind === "lit") out += p.text;
    else if (p.kind === "size") { n = size(p); out += n; }
    else if (p.kind === "int") out += int(p, slot++, 0);
    else { const s = slot++; out += Array.from({ length: n }, (_, i) => int(p, s, i)).join(" "); }
  }
  return out.endsWith("\n") ? out : out + "\n";
}

function hashSeed(text) {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
function mulberry32(seed) {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export function rngFor(seed, label) { return mulberry32(hashSeed(`${seed}:${label}`)); }
const randInt = (rng, lo, hi) => lo + Math.floor(rng() * (hi - lo + 1));

const clamp = (v, p) => Math.min(p.hi, Math.max(p.lo, v));
const tlo = (p) => Math.max(p.lo, -TYPICAL);
const thi = (p) => Math.min(p.hi, TYPICAL);
const typicalValue = (rng) => (p) => randInt(rng, tlo(p), thi(p));
const fixedSize = (k) => (p) => clamp(k, p);
const typicalSize = (rng) => (p) => randInt(rng, Math.max(p.lo, 1), Math.max(Math.max(p.lo, 1), Math.min(p.hi, 10)));

const has = (parts, kind) => parts.some((p) => p.kind === kind);
const numbers = (parts) => parts.filter((p) => p.kind === "int" || p.kind === "ints");
const sizeOf = (parts) => parts.find((p) => p.kind === "size");

const BUILDERS = {
  typical: (parts, rng) => [1, 2, 3].map(() => render(parts, typicalSize(rng), typicalValue(rng))),

  zero: (parts) => numbers(parts).length ? [render(parts, fixedSize(3), (p) => clamp(0, p))] : [],

  negatives: (parts, rng) => numbers(parts).some((p) => p.lo < 0)
    ? [1, 2].map(() => render(parts, typicalSize(rng), (p) => (p.lo < 0 ? randInt(rng, tlo(p), Math.min(p.hi, -1)) : randInt(rng, tlo(p), thi(p)))))
    : [],

  int_overflow: (parts) => numbers(parts).some((p) => p.hi === INT_MAX || p.lo === INT_MIN)
    ? [
      render(parts, fixedSize(3), (p, s, i) => (s === 0 && i === 0 ? p.hi : clamp(1, p))),
      render(parts, fixedSize(3), (p, s, i) => (s === 0 && i === 0 ? p.lo : clamp(-1, p))),
      render(parts, fixedSize(3), (p) => p.hi),
      render(parts, fixedSize(3), (p) => p.lo),
    ]
    : [],

  boundaries: (parts) => numbers(parts).length
    ? [
      render(parts, (p) => p.lo, (p) => p.lo),
      render(parts, fixedSize(3), (p) => p.hi),
      render(parts, fixedSize(4), (p, s, i) => ((s + i) % 2 ? p.hi : p.lo)),
    ]
    : [],

  empty: (parts, rng) => (sizeOf(parts)?.lo === 0 ? [render(parts, () => 0, typicalValue(rng))] : []),

  single: (parts, rng) => {
    const s = sizeOf(parts);
    return s && s.lo <= 1 && s.hi >= 1 ? [render(parts, () => 1, typicalValue(rng))] : [];
  },

  large: (parts, rng) => (sizeOf(parts) ? [render(parts, (p) => p.hi, typicalValue(rng))] : []),

  whitespace: (parts, rng) => {
    const base = render(parts, typicalSize(rng), typicalValue(rng));
    return [
      "  " + base.replace(/ /g, " \t  ").replace(/\n/g, "  \n\n"),
      base.replace(/\n$/, "").replace(/ /g, "   "),
    ];
  },

  duplicates: (parts, rng) => {
    if (!has(parts, "ints")) return [];
    const v = randInt(rng, -TYPICAL, TYPICAL);
    return [render(parts, fixedSize(6), (p) => clamp(v, p))];
  },

  sorted: (parts, rng) => {
    if (!has(parts, "ints")) return [];
    const start = randInt(rng, -TYPICAL, 0);
    return [render(parts, fixedSize(8), (p, s, i) => clamp(start + i * 7, p))];
  },

  reverse: (parts, rng) => {
    if (!has(parts, "ints")) return [];
    const start = randInt(rng, 0, TYPICAL);
    return [render(parts, fixedSize(8), (p, s, i) => clamp(start - i * 7, p))];
  },
};

export function generateCases(spec, categories, seed) {
  const parts = parseSpec(spec);
  const cases = [], notApplicable = [];
  for (const cat of categories) {
    if (!BUILDERS[cat]) throw new Error(`unknown edge case category "${cat}" (known: ${CATEGORIES.join(", ")})`);
    const inputs = [...new Set(BUILDERS[cat](parts, rngFor(seed, cat)))];
    if (!inputs.length) notApplicable.push(cat);
    inputs.forEach((input, k) => cases.push({ category: cat, label: `${cat} #${k + 1}`, input }));
  }
  return { cases, notApplicable };
}

export function randomCases(spec, count, seed) {
  const parts = parseSpec(spec);
  const rng = rngFor(seed, "random");
  const out = [];
  for (let k = 0; k < count; k++) {
    const wide = rng() < 0.3;
    out.push({
      category: "random",
      label: `random #${k + 1}`,
      input: render(parts, typicalSize(rng), (p) => (wide ? randInt(rng, p.lo, p.hi) : randInt(rng, tlo(p), thi(p)))),
    });
  }
  return out;
}

export function inputsForSize(spec, n, seed) {
  const parts = parseSpec(spec);
  if (!sizeOf(parts)) return [{ shape: "scalar", input: render(parts, () => n, () => n) }];
  const rng = rngFor(seed, `size:${n}`);
  const wide = (p) => randInt(rng, Math.max(p.lo, -1000000), Math.min(p.hi, 1000000));
  return [
    { shape: "random", input: render(parts, () => n, wide) },
    { shape: "ascending", input: render(parts, () => n, (p, s, i) => clamp(i - Math.floor(n / 2), p)) },
    { shape: "descending", input: render(parts, () => n, (p, s, i) => clamp(Math.floor(n / 2) - i, p)) },
  ];
}
