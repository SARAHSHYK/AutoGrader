
import { resolveModel, callModel, extractJson } from "../llm.js";
import { sourceStats } from "../cparse.js";
import { READABILITY_SYSTEM, readabilityUser, numbered } from "../prompts.js";

const RUBRIC = { naming: 3, comments: 2, layout: 3, clarity: 2 };

export default {
  kind: "source",

  async run(ctx, params) {
    const stats = sourceStats(ctx.source);
    const temperature = params.temperature ?? 0;
    const seed = params.seed ?? ctx.seed;

    const resolved = await resolveModel(params.model);
    let parts = null, reasons = [], source = "model", raw = null, problem = null, cached = false, capped = [];
    if (resolved) {
      ctx.log({ kind: "llm", msg: `llm_review: asking ${resolved.model} (T=${temperature}, seed=${seed})${resolved.substituted ? ` — "${params.model}" isn't pulled, using the configured default` : ""}.` });
      try {
        const out = await callModel({ model: resolved.model, system: READABILITY_SYSTEM, user: readabilityUser(numbered(ctx.source), stats), temperature, seed, maxTokens: 400 });
        raw = out.text;
        cached = out.cached;
        const parsed = extractJson(out.text);
        const caps = factCaps(stats);
        parts = Object.fromEntries(Object.entries(RUBRIC).map(([k, max]) => {
          const v = Number(parsed[k]);
          if (!Number.isFinite(v)) throw new Error(`missing "${k}" sub-score`);
          return [k, Math.max(0, Math.min(max, caps[k], Math.round(v)))];
        }));
        capped = Object.keys(RUBRIC).filter((k) => Math.round(Number(parsed[k])) > parts[k]);
        reasons = (Array.isArray(parsed.reasons) ? parsed.reasons : []).filter((r) => typeof r === "string").slice(0, 4).map((r) => r.slice(0, 200));
        ctx.log({ kind: "llm", msg: `llm_review: ${cached ? "replayed cached answer" : "model answered"} — ${JSON.stringify(parts)}.` });
      } catch (e) {
        problem = `model answer unusable (${e.message})`;
        parts = null;
      }
    } else {
      problem = "no local model available (Ollama not running or model not pulled)";
    }

    if (!parts) {
      ctx.log({ kind: "error", msg: `llm_review: ${problem} — using the deterministic rubric.` });
      ({ parts, reasons } = heuristic(stats, ctx.source));
      source = "deterministic_fallback";
    }

    const total = Object.values(parts).reduce((s, v) => s + v, 0);
    const weak = Object.entries(parts).filter(([k, v]) => v < RUBRIC[k]).map(([k]) => k);
    return {
      score: total / 10,
      verdict: weak.length ? `weak: ${weak.join(", ")}` : "clear and well laid out",
      feedback: reasons.length ? reasons.join(" ") : `Readability ${total}/10.`,
      evidence: {
        source,
        model: resolved?.model ?? null,
        requested_model: params.model ?? null,
        temperature, seed,
        rubric: parts,
        capped_by_measured_facts: capped,
        measured: { comment_lines: stats.commentLines, code_lines: stats.codeLines, short_names: stats.shortIdentifiers, cramped_commas: stats.crampedCommas },
        raw_response: raw,
        ...(problem ? { fallback_reason: problem } : {}),
      },
      suggestions: suggestions(parts, stats),
      flags: source === "deterministic_fallback" ? [{ type: "llm_unavailable", detail: `readability scored by the deterministic rubric: ${problem}` }] : [],
    };
  },
};

function factCaps(stats) {
  const ratio = stats.commentLines / Math.max(stats.codeLines, 1);
  return {
    naming: Math.max(0, 3 - stats.shortIdentifiers.length),
    comments: stats.commentLines === 0 ? 0 : ratio < 0.05 ? 1 : 2,
    layout: Math.max(0, 3 - (stats.crampedCommas > 0) - (stats.longLines > 0)),
    clarity: 2,
  };
}

function heuristic(stats, source) {
  const ratio = stats.commentLines / Math.max(stats.codeLines, 1);
  const lines = source.split(/\r?\n/);
  const indentSteps = new Set(lines.map((l) => (l.match(/^( +)\S/) || [])[1]?.length).filter(Boolean).map((n) => n % 4 === 0 ? 4 : n % 2 === 0 ? 2 : 1));
  const parts = {
    naming: Math.max(0, 3 - stats.shortIdentifiers.length),
    comments: ratio >= 0.15 ? 2 : ratio >= 0.05 ? 1 : 0,
    layout: Math.max(0, 3 - (stats.crampedCommas > 0) - (stats.longLines > 0) - (indentSteps.size > 1) - (stats.codeLines > 8 && stats.blankLines === 0)),
    clarity: stats.functions > 0 ? 2 : 1,
  };
  const reasons = [];
  if (stats.shortIdentifiers.length) reasons.push(`Single-letter names: ${stats.shortIdentifiers.join(", ")}.`);
  if (parts.comments < 2) reasons.push(`${stats.commentLines} comment line(s) for ${stats.codeLines} code lines.`);
  if (stats.crampedCommas) reasons.push(`${stats.crampedCommas} comma(s) without a following space.`);
  return { parts, reasons };
}

function suggestions(parts, stats) {
  const out = [];
  if (parts.naming < 3 && stats.shortIdentifiers.length) out.push(`Rename ${stats.shortIdentifiers.join(", ")} to names that say what they hold.`);
  if (parts.comments < 2) out.push("Add a one-line comment above main() (and each helper) saying what it does.");
  if (parts.layout < 3) out.push("Put spaces after commas and around operators, and one statement per line.");
  return out;
}
