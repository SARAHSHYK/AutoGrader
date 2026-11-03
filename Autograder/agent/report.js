
import fs from "node:fs";
import path from "node:path";
import { USEFULNESS, LIMITATIONS } from "./usefulness.js";

export function buildReport({ submission, submissionHash, rules, firstPass, metrics, grade, failures, suggestions, flags, tools }) {
  return {
    submission,
    submission_hash: submissionHash,
    problem: rules.problem,
    rules_file: rules.file,
    rules_hash: rules.hash,
    grade,
    first_pass: firstPass,
    metrics,
    failures,
    suggestions,
    flags,
    usefulness_limitations: { usefulness: USEFULNESS, limitations: LIMITATIONS },
    tool_versions: tools,
  };
}

export function writeReports(report, text, outDir) {
  fs.mkdirSync(outDir, { recursive: true });
  const stem = path.basename(report.submission).replace(/\.c$/i, "");
  const json = path.join(outDir, `${stem}.json`);
  const txt = path.join(outDir, `${stem}.txt`);
  fs.writeFileSync(json, JSON.stringify(report, null, 2) + "\n");
  fs.writeFileSync(txt, text);
  return { json, txt };
}

const W = 78;
const fmt = (v) => String(Math.round(v * 10) / 10);

function wrap(text, indent, first = "") {
  const words = String(text).split(/\s+/).filter(Boolean);
  const lines = [];
  let cur = first;
  for (const w of words) {
    if (cur.length + w.length + 1 > W && cur.trim()) { lines.push(cur); cur = indent; }
    cur += (cur.trim() && !cur.endsWith(" ") ? " " : "") + w;
  }
  if (cur.trim()) lines.push(cur);
  return lines.join("\n");
}

function block(label, value, indent) {
  const lines = String(value === "" ? "(nothing)" : value).replace(/\n$/, "").split("\n");
  return lines.map((l, i) => (i === 0 ? `${indent}${label.padEnd(10)}${l}` : `${indent}${" ".repeat(10)}${l}`)).join("\n");
}

export function renderText(r) {
  const out = [];
  const fp = r.first_pass;
  out.push(`===== Grading report for ${r.submission} =====`);
  out.push(`Overall grade: ${r.grade.toFixed(1)} / 100`);
  out.push(`Problem: ${r.problem}   Rules: ${r.rules_file} (${r.rules_hash.slice(0, 15)}...${r.rules_hash.slice(-4)})`);
  out.push(`First pass: compiled=${fp.compiled ? "yes" : "NO"}  smoke_run=${fp.smoke_ok ? "ok" : fp.smoke_status || "not run"}  suspected_infinite_loop=${fp.suspected_infinite_loop ? "YES" : "no"}`);
  out.push("");
  out.push(`${"Metric".padEnd(15)}${"Weight".padStart(6)}  ${"Score".padEnd(8)}${"Contribution".padEnd(14)}Verdict`);
  for (const m of r.metrics) {
    const w = Math.round(m.weight * 100);
    const score = m.status === "skipped" ? "--" : `${fmt(m.contribution)}/${w}`;
    const verdict = m.status === "skipped" ? `skipped: ${m.verdict}` : m.verdict;
    out.push(`${m.name.padEnd(15)}${String(w).padStart(6)}  ${score.padEnd(8)}${m.contribution.toFixed(1).padStart(6).padEnd(14)}${verdict}`);
  }

  if (r.flags.length) {
    out.push("", "--- Flags ---");
    for (const f of r.flags) out.push(wrap(`${f.type}: ${f.detail}`, "    ", "  ! "));
  }

  if (r.failures.length) {
    out.push("", "--- Where you failed ---");
    for (const f of r.failures.slice(0, 6)) {
      out.push(f.label);
      out.push(block("INPUT:", f.input, "  "));
      out.push(block("EXPECTED:", f.expected, "  "));
      out.push(block("GOT:", f.got || `(${f.note || "no output"})`, "  "));
      if (f.note && f.got) out.push(block("NOTE:", f.note, "  "));
      out.push(wrap(f.why, " ".repeat(12), "  WHY:      "));
      if (f.hint) out.push(wrap(`(model) ${f.hint}`, " ".repeat(12), "  HINT:     "));
      out.push("");
    }
    if (r.failures.length > 6) out.push(`  … ${r.failures.length - 6} more failing input(s) in the JSON report.`, "");
    else out.pop();
  }

  const memProfile = memoryAndProfile(r.metrics);
  if (memProfile.length) out.push("", "--- Memory & profile ---", ...memProfile);

  if (r.suggestions.length) {
    out.push("", "--- Suggestions to raise the grade ---");
    for (const s of r.suggestions) out.push(wrap(s, "  ", "- "));
  }

  out.push("", "--- Usefulness & limitations of this evaluation ---", "Useful for:");
  r.usefulness_limitations.usefulness.forEach((u, i) => {
    out.push(`  ${i + 1}. ${u.use_case}`);
    out.push(wrap(u.example, "     ", "     Example: "));
    out.push(wrap(u.benefit, "     ", "     Benefit: "), "");
  });
  out.push("Limits of this report:");
  r.usefulness_limitations.limitations.forEach((l, i) => {
    out.push(`  ${i + 1}. ${l.limitation}`);
    out.push(wrap(l.example, "     ", "     Example: "));
    out.push(wrap(l.mitigation, "     ", "     Fix: "), "");
  });
  return out.join("\n");
}

function memoryAndProfile(metrics) {
  const lines = [];
  for (const m of metrics) {
    if (m.status !== "ok") continue;
    if (m.analyzer === "sanitizer_run") {
      lines.push(`  Memory checks (${m.evidence.mode} mode, ${m.evidence.inputs_run} inputs):`);
      if (!m.evidence.issues.length) lines.push("    no leaks, invalid accesses or undefined behaviour found");
      for (const i of m.evidence.issues) lines.push(wrap(i.message, "      ", "    - "));
    }
    if (m.analyzer === "complexity_estimator" && m.evidence.profile) {
      const p = m.evidence.profile;
      lines.push(`  Profile at n=${p.n} (${p.total_ops.toLocaleString("en-US")} line executions; estimated ${m.evidence.estimated || "n/a"}, required ${m.evidence.required}):`);
      for (const h of p.hot_lines) lines.push(`    line ${String(h.line).padStart(3)}  ${String(Math.round(h.share * 100)).padStart(3)}%  ${h.count.toLocaleString("en-US").padStart(12)}x  ${h.code}`);
    }
  }
  return lines;
}
