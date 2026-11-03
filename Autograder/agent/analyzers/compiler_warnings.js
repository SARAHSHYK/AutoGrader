
import { compile } from "../sandbox.js";

export default {
  kind: "source",

  async run(ctx, params) {
    const flags = String(params.flags || "-Wall -Wextra").split(/\s+/).filter(Boolean);
    const werror = flags.some((f) => f === "-Werror");
    const used = flags.filter((f) => f !== "-Werror" && !f.startsWith("-Werror="));
    const penalty = params.penalty_per_warning ?? 0.1;

    const res = await compile(ctx.workDir, { out: "syntax.o", flags: used, objectOnly: true });
    const errors = res.diagnostics.filter((d) => d.kind === "error");
    const warnings = res.diagnostics.filter((d) => d.kind === "warning");
    ctx.log({ kind: "observe", msg: `compiler_warnings: ${errors.length} error(s), ${warnings.length} warning(s) with ${used.join(" ")}.` });

    const byFlag = {};
    for (const w of warnings) byFlag[w.flag || "warning"] = (byFlag[w.flag || "warning"] || 0) + 1;
    const summary = Object.entries(byFlag).map(([f, n]) => `${f} x${n}`).join(", ");

    const score = errors.length ? 0 : Math.max(0, 1 - penalty * warnings.length);
    return {
      score,
      verdict: errors.length ? `${errors.length} compile error(s)` : warnings.length ? summary : "no warnings",
      feedback: errors.length
        ? `Does not compile: line ${errors[0].line}: ${errors[0].message}.`
        : warnings.length
          ? `${warnings.length} warning(s): ${summary}.${werror ? " With -Werror (as the rules specify) this build would fail." : ""}`
          : `Compiles cleanly with ${flags.join(" ")}.`,
      evidence: { flags: flags.join(" "), errors, warnings },
      suggestions: [...errors, ...warnings].slice(0, 4).map((d) => `Line ${d.line}: ${d.message}${d.flag ? ` [${d.flag}]` : ""}.`),
    };
  },
};
