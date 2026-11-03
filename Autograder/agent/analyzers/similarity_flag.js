
import fs from "node:fs";
import path from "node:path";
import { sourceText } from "../rules.js";
import { normalizedTokens } from "../cparse.js";
import { resolveModel, callModel, extractJson } from "../llm.js";
import { BASELINE_SYSTEM, baselineUser } from "../prompts.js";

const K = 5, W = 4;

export default {
  kind: "source",

  async run(ctx, params) {
    const threshold = params.flag_threshold ?? 0.85;
    const sources = [];
    const self = path.resolve(ctx.submissionPath);

    if (ctx.corpusDir && fs.existsSync(ctx.corpusDir)) {
      for (const f of fs.readdirSync(ctx.corpusDir).filter((x) => x.endsWith(".c")).sort()) {
        const p = path.join(ctx.corpusDir, f);
        if (path.resolve(p) === self || f === path.basename(self)) continue;
        sources.push({ kind: "classmate", name: f, text: fs.readFileSync(p, "utf8") });
      }
    }
    for (const [i, k] of (params.known_sources || []).entries()) {
      const text = sourceText(k?.code);
      if (text === null) throw new Error(`params.known_sources[${i}] needs "code": a string or a list of lines`);
      sources.push({ kind: "online", name: k.name || `known source ${i + 1}`, text });
    }
    if (params.llm_baseline && ctx.rules.statement) {
      const baseline = await llmBaseline(ctx, params);
      if (baseline) sources.push(baseline);
    }

    const base = new Set();
    if (ctx.rules.reference) fingerprints(sourceText(ctx.rules.reference)).forEach((h) => base.add(h));
    const classmates = sources.filter((s) => s.kind === "classmate").map((s) => fingerprints(s.text));
    if (classmates.length >= 4) {
      const freq = new Map();
      classmates.forEach((fp) => fp.forEach((h) => freq.set(h, (freq.get(h) || 0) + 1)));
      for (const [h, c] of freq) if (c >= classmates.length / 2) base.add(h);
    }

    const mine = without(fingerprints(ctx.source), base);
    const ranked = sources
      .map((s) => ({ kind: s.kind, source: s.name, similarity: round(jaccard(mine, without(fingerprints(s.text), base))) }))
      .sort((a, b) => b.similarity - a.similarity || a.source.localeCompare(b.source));
    const top = ranked[0] || { similarity: 0, source: null, kind: null };
    const minPrints = params.min_fingerprints ?? 10;
    const tooShort = mine.size < minPrints;
    const flagged = tooShort ? [] : ranked.filter((r) => r.similarity >= threshold);

    ctx.log({ kind: flagged.length ? "flag" : "observe", msg: `similarity_flag: compared with ${sources.length} source(s); max ${top.similarity.toFixed(2)}${top.source ? ` (${top.source})` : ""}${flagged.length ? " — FLAGGED for review" : tooShort ? ` — only ${mine.size} distinctive fingerprints, too short to judge` : ""}.` });
    return {
      score: flagged.length ? 0 : 1,
      verdict: flagged.length
        ? `FLAGGED: ${top.similarity.toFixed(2)} vs ${top.kind} source`
        : tooShort ? `too short to judge (max ${top.similarity.toFixed(2)})` : `max similarity ${top.similarity.toFixed(2)} (safe)`,
      feedback: flagged.length
        ? `Similarity ${top.similarity.toFixed(2)} with ${top.source} (${top.kind}) is at or above the ${threshold} threshold. Flagged for instructor review; this is not a finding of misconduct.`
        : tooShort
          ? `Only ${mine.size} distinctive fingerprints remain after removing boilerplate (minimum ${minPrints}); a program this short can't be told apart from independent work, so it is not flagged. Max similarity ${top.similarity.toFixed(2)}${top.source ? ` (${top.source})` : ""}.`
          : `Max similarity ${top.similarity.toFixed(2)}${top.source ? ` (${top.source})` : ""}, below the ${threshold} threshold.`,
      evidence: {
        method: `winnowing k=${K} w=${W} over normalized tokens, Jaccard, boilerplate removed`,
        threshold, fingerprints: mine.size, min_fingerprints: minPrints, too_short: tooShort,
        compared: ranked.length, top_matches: ranked.slice(0, 5),
      },
      flags: flagged.map((r) => ({ type: "suspected_copy", detail: `similarity ${r.similarity.toFixed(2)} with ${r.source} (${r.kind})` })),
    };
  },
};

async function llmBaseline(ctx, params) {
  const resolved = await resolveModel(params.model);
  if (!resolved) {
    ctx.log({ kind: "error", msg: "similarity_flag: no local model — skipping the LLM-written baseline." });
    return null;
  }
  try {
    const out = await callModel({ model: resolved.model, system: BASELINE_SYSTEM, user: baselineUser(ctx.rules.statement), temperature: 0, seed: params.seed ?? ctx.seed, maxTokens: 900 });
    const code = String(extractJson(out.text).code || "");
    ctx.log({ kind: "llm", msg: `similarity_flag: ${out.cached ? "replayed cached" : "generated"} LLM baseline solution with ${resolved.model}.` });
    return code ? { kind: "llm", name: `llm:${resolved.model}`, text: code } : null;
  } catch (e) {
    ctx.log({ kind: "error", msg: `similarity_flag: LLM baseline unusable (${e.message}).` });
    return null;
  }
}

function fingerprints(src) {
  const toks = normalizedTokens(src);
  const grams = [];
  for (let i = 0; i + K <= toks.length; i++) grams.push(fnv(toks.slice(i, i + K).join(" ")));
  if (!grams.length && toks.length) grams.push(fnv(toks.join(" ")));
  const out = new Set();
  for (let i = 0; i + W <= grams.length; i++) {
    let min = i;
    for (let j = i; j < i + W; j++) if (grams[j] <= grams[min]) min = j;
    out.add(grams[min]);
  }
  if (grams.length < W) grams.forEach((g) => out.add(g));
  return out;
}

function fnv(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

const without = (set, base) => new Set([...set].filter((h) => !base.has(h)));
function jaccard(a, b) {
  if (!a.size || !b.size) return 0;
  let inter = 0;
  for (const h of a) if (b.has(h)) inter++;
  return inter / (a.size + b.size - inter);
}
const round = (v) => Math.round(v * 100) / 100;
