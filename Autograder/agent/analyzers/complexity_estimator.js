
import fs from "node:fs";
import path from "node:path";
import { compile, link, run, exec, TOOLS } from "../sandbox.js";
import { inputsForSize } from "../inputs.js";

const CLASSES = [
  { id: "O(1)", f: () => 1 },
  { id: "O(log n)", f: (n) => Math.log2(Math.max(n, 1)) },
  { id: "O(n)", f: (n) => n },
  { id: "O(n log n)", f: (n) => n * Math.log2(Math.max(n, 1)) },
  { id: "O(n^2)", f: (n) => n * n },
  { id: "O(n^3)", f: (n) => n ** 3 },
  { id: "O(2^n)", f: (n) => 2 ** n },
];

export function normalizeClass(s) {
  const t = String(s).replace(/\s+/g, "").replace("²", "^2").replace("³", "^3").replace(/\*/g, "").toLowerCase();
  const found = CLASSES.find((c) => c.id.replace(/\s+/g, "").toLowerCase() === t || c.id.replace(/\s+/g, "").replace("^", "").toLowerCase() === t);
  if (!found) throw new Error(`unknown complexity class "${s}" (use one of ${CLASSES.map((c) => c.id).join(", ")})`);
  return found.id;
}
const rankOf = (id) => CLASSES.findIndex((c) => c.id === id);

export default {
  kind: "execution",
  requires: ["input_spec"],

  async run(ctx, params) {
    const required = normalizeClass(params.required || "O(n)");
    const sizes = [...new Set(params.sizes || [100, 1000, 10000])].sort((a, b) => a - b);
    if (sizes.length < 3) throw new Error("params.sizes needs at least 3 sizes to fit a growth curve");
    const spec = params.generator || ctx.rules.input_spec;
    const timeLimitS = ctx.timeLimitS * (params.time_factor ?? 5);

    const obj = await compile(ctx.workDir, { out: "prog_cov.o", flags: ["-O0", "-std=c11", "--coverage"], shim: true, objectOnly: true });
    if (!obj.ok) throw new Error(`coverage build failed: ${obj.stderr.slice(0, 200)}`);
    const linked = await link(ctx.workDir, { objects: ["prog_cov.o"], out: "prog_cov.exe", flags: ["--coverage"] });
    if (!linked.ok) throw new Error(`coverage link failed: ${linked.stderr.slice(0, 200)}`);
    const exe = path.join(ctx.workDir, "prog_cov.exe");
    const gcda = path.join(ctx.workDir, "prog_cov.gcda");

    const points = [];
    let lastProfile = null, timedOutAt = null;
    sizeLoop: for (const n of sizes) {
      let worst = null;
      const byShape = {};
      for (const { shape, input } of inputsForSize(spec, n, ctx.seed)) {
        fs.rmSync(gcda, { force: true });
        const r = await run(exe, { input, timeLimitS, memoryLimitMb: ctx.memoryLimitMb, cwd: ctx.workDir });
        if (r.status === "timeout") {
          timedOutAt = n;
          ctx.log({ kind: "observe", msg: `complexity: n=${n} (${shape} input) exceeded ${timeLimitS}s — stopping.` });
          break sizeLoop;
        }
        if (r.status !== "ok") { ctx.log({ kind: "observe", msg: `complexity: n=${n} (${shape} input) ended with ${r.status}; skipped.` }); continue; }
        const counts = await lineCounts(ctx.workDir);
        const ops = counts.reduce((s, c) => s + c.count, 0);
        byShape[shape] = ops;
        if (!worst || ops > worst.ops) worst = { shape, counts, ops };
      }
      if (!worst) continue;
      points.push({ n, ops: worst.ops, worst_shape: worst.shape, by_shape: byShape });
      lastProfile = { n, counts: worst.counts, ops: worst.ops, shape: worst.shape };
      ctx.log({ kind: "tool", msg: `complexity: n=${n} → ${worst.ops.toLocaleString("en-US")} line executions (worst: ${worst.shape} input).` });
    }

    const profile = lastProfile ? hotLines(lastProfile, ctx.source) : null;
    if (timedOutAt !== null || points.length < 3) {
      return {
        score: 0,
        verdict: timedOutAt !== null ? `too slow at n=${timedOutAt}` : "could not measure",
        feedback: timedOutAt !== null
          ? `The program did not finish at n=${timedOutAt} within ${timeLimitS}s — far beyond the required ${required}.`
          : `Fewer than 3 sizes ran successfully, so growth could not be measured.`,
        evidence: { required, estimated: null, sizes: points, timed_out_at: timedOutAt, profile },
        suggestions: profile?.hot_lines?.length ? [`Most of the work happens on line ${profile.hot_lines[0].line}: \`${profile.hot_lines[0].code}\` — reduce how often it runs.`] : [],
      };
    }

    const fit = fitClass(points);
    const gap = rankOf(fit.estimated) - rankOf(required);
    const score = gap <= 0 ? 1 : gap === 1 ? 0.5 : 0;
    ctx.log({ kind: "observe", msg: `complexity: estimated ${fit.estimated} (R²=${fit.r2.toFixed(4)}), required ${required}.` });

    const hot = profile?.hot_lines?.[0];
    return {
      score,
      verdict: gap <= 0 ? `${fit.estimated} confirmed` : `${fit.estimated}, required ${required}`,
      feedback: gap <= 0
        ? `Operation counts grow as ${fit.estimated}, within the required ${required}.`
        : `Operation counts grow as ${fit.estimated}, but the problem requires ${required}.${hot ? ` Hot spot: line ${hot.line} runs ${hot.count.toLocaleString("en-US")} times at n=${profile.n}.` : ""}`,
      evidence: { required, estimated: fit.estimated, r2: round(fit.r2, 4), sizes: points, fits: fit.all, profile },
      suggestions: gap > 0 && hot
        ? [`Line ${hot.line} (\`${hot.code}\`) accounts for ${Math.round(hot.share * 100)}% of the work at n=${profile.n}; restructure it (e.g. avoid recomputing inside a nested loop) to reach ${required}.`]
        : [],
    };
  },
};

async function lineCounts(workDir) {
  const res = await exec(TOOLS.gcov, ["-t", "-o", ".", "prog_cov.gcda"], { cwd: workDir });
  const out = [];
  for (const l of res.stdout.split(/\r?\n/)) {
    const m = l.match(/^\s*([^:]+):\s*(\d+):(.*)$/);
    if (!m || m[2] === "0") continue;
    const c = m[1].trim().replace("*", "");
    if (c === "-") continue;
    out.push({ line: Number(m[2]), count: /^\d+$/.test(c) ? Number(c) : 0 });
  }
  return out;
}

function hotLines({ n, counts, ops, shape }, source) {
  const src = source.replace(/\r\n/g, "\n").split("\n");
  const hot_lines = [...counts].sort((a, b) => b.count - a.count || a.line - b.line).slice(0, 3)
    .filter((c) => c.count > 0)
    .map((c) => ({ line: c.line, count: c.count, share: round(c.count / Math.max(ops, 1), 3), code: (src[c.line - 1] || "").trim().slice(0, 80) }));
  return { n, input_shape: shape, total_ops: ops, hot_lines };
}

function fitClass(points) {
  const ops = points.map((p) => p.ops);
  const spread = (Math.max(...ops) - Math.min(...ops)) / Math.max(...ops);
  if (spread <= 0.05) return { estimated: "O(1)", r2: 1, all: [{ class: "O(1)", r2: 1 }] };

  const all = [];
  for (const c of CLASSES.slice(1)) {
    const xs = points.map((p) => c.f(p.n));
    if (xs.some((x) => !Number.isFinite(x))) continue;
    const r = regress(xs, ops);
    if (r.b > 0) all.push({ class: c.id, r2: round(r.r2, 6) });
  }
  const best = Math.max(...all.map((a) => a.r2));
  const pick = all.find((a) => a.r2 >= best - 1e-3);
  return { estimated: pick.class, r2: pick.r2, all };
}

function regress(xs, ys) {
  const n = xs.length;
  const mx = xs.reduce((s, x) => s + x, 0) / n, my = ys.reduce((s, y) => s + y, 0) / n;
  let sxy = 0, sxx = 0, syy = 0;
  for (let i = 0; i < n; i++) { sxy += (xs[i] - mx) * (ys[i] - my); sxx += (xs[i] - mx) ** 2; syy += (ys[i] - my) ** 2; }
  const b = sxx ? sxy / sxx : 0;
  const a = my - b * mx;
  const ssRes = xs.reduce((s, x, i) => s + (ys[i] - (a + b * x)) ** 2, 0);
  return { a, b, r2: syy ? 1 - ssRes / syy : 1 };
}

const round = (v, d) => Math.round(v * 10 ** d) / 10 ** d;
