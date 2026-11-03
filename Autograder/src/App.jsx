
import { useState, useEffect, useRef } from "react";
import {
  GraduationCap, PlayCircle, Loader2, RotateCcw, XCircle,
  FileCode2, FileJson, Upload, Download, Cpu, FolderOpen, FileText, Bot,
} from "lucide-react";

const C = {
  bg: "#12141C", surface: "#1B1E2B", surface2: "#232736", border: "#2E3242",
  text: "#E6E8EF", muted: "#9AA0B4", faint: "#5A6072",
  truth: "#57C08B", model: "#E0A458", fail: "#E5484D", info: "#6B8AFF",
};

export default function App() {
  const [rulesFile, setRulesFile] = useState(null);
  const [cFile, setCFile] = useState(null);

  const [running, setRunning] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const [health, setHealth] = useState(null);

  useEffect(() => { checkHealth(); }, []);

  async function checkHealth() {
    try { setHealth(await (await fetch("/api/health")).json()); }
    catch { setHealth({ gcc: null, offline: true }); }
  }

  const ready = Boolean(health?.gcc);
  const haveFiles = Boolean(rulesFile && cFile);

  async function onRulesUpload(file) {
    const content = await file.text();
    try { JSON.parse(content); }
    catch (e) { return setError(`${file.name} is not valid JSON: ${e.message}`); }
    setError(null); setRulesFile({ name: file.name, content }); setResult(null);
  }
  async function onCUpload(file) {
    setError(null); setCFile({ name: file.name, content: await file.text() }); setResult(null);
  }

  async function handleGrade() {
    setError(null); setResult(null); setRunning(true);
    try {
      const body = { rulesName: rulesFile.name, rulesContent: rulesFile.content, sourceName: cFile.name, source: cFile.content };
      const res = await fetch("/api/grade", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `Server error ${res.status}`);
      setResult(data);
    } catch (e) { setError(e.message); }
    finally { setRunning(false); }
  }
  function reset() { setResult(null); setError(null); }

  return (
    <div style={{ background: C.bg, color: C.text, minHeight: "100vh" }} className="font-sans">
      <div className="max-w-6xl mx-auto px-6 py-8">
        <div className="flex items-center gap-3 mb-1">
          <div className="w-9 h-9 rounded-md flex items-center justify-center" style={{ background: `${C.truth}18`, border: `1px solid ${C.truth}55` }}>
            <GraduationCap size={18} style={{ color: C.truth }} />
          </div>
          <h1 className="font-mono text-lg tracking-tight">AutoGrader</h1>
          <span className="font-mono text-[11px] px-2 py-0.5 rounded" style={{ border: `1px solid ${C.border}`, color: C.muted }}>
            rule-driven evaluator for C programs
          </span>
          <button onClick={checkHealth} className="ml-auto flex gap-2"><StatusChip health={health} /><ModelChip health={health} /></button>
        </div>
        <p className="text-sm mb-6 ml-12" style={{ color: C.muted }}>
          Upload the instructor's rules and a student's C program. The agent runs it safely, checks it with one analyzer per metric, and returns one reproducible grade with feedback that shows exactly where the program falls short.
        </p>

        <div className="rounded-lg p-3 mb-4" style={{ background: C.surface, border: `1px solid ${C.border}` }}>
          <div className="grid md:grid-cols-2 gap-3">
            <UploadSlot icon={FileJson} accept=".json,application/json" file={rulesFile} onFile={onRulesUpload} disabled={running}
              title="rules file (.json)" empty="metrics, weights, thresholds, limits" />
            <UploadSlot icon={FileCode2} accept=".c,text/x-c" file={cFile} onFile={onCUpload} disabled={running}
              title="submission (.c)" empty="the student's C program" />
          </div>
          <div className="flex flex-col sm:flex-row gap-3 mt-3">
            <button onClick={handleGrade} disabled={running || !ready || !haveFiles}
              className="flex-1 flex items-center justify-center gap-2 font-mono text-sm font-medium px-4 py-2 rounded-md transition-opacity disabled:opacity-40"
              style={{ background: C.truth, color: C.bg }}>
              {running ? <Loader2 size={15} className="animate-spin" /> : <PlayCircle size={15} />} run the grader
            </button>
            <button onClick={reset} disabled={running}
              className="flex items-center justify-center gap-2 font-mono text-sm px-3 py-2 rounded-md disabled:opacity-40" style={{ border: `1px solid ${C.border}`, color: C.muted }}>
              <RotateCcw size={14} /> reset
            </button>
          </div>
        </div>

        {error && (
          <div className="mb-4 flex items-start gap-2 rounded-lg px-4 py-3 font-mono text-sm whitespace-pre-wrap" style={{ background: `${C.fail}14`, border: `1px solid ${C.fail}55`, color: C.fail }}>
            <XCircle size={16} className="shrink-0 mt-0.5" /> {error}
          </div>
        )}
        {health && !health.gcc && (
          <Banner color={C.fail}>gcc isn't reachable from the server. Install it and put it on PATH (or set <code>CC</code> in <code>.env</code>), then click the status chip.</Banner>
        )}
        {health && health.gcc && !health.ollamaModelAvailable && (
          <Banner color={C.model}>
            The local model ({health.ollamaModel}) isn't {health.ollamaRunning ? "pulled" : "running"}: readability uses its deterministic fallback and failing inputs get no model hint. Start Ollama and run <code>ollama pull {health.ollamaModel}</code>, then click the status chip.
          </Banner>
        )}
        <div className="space-y-4">
          {result ? <ReportFilesCard report={result.report} text={result.text} files={result.files} />
            : <Card><Empty text={running ? "Grading… compiling, running the tests and the analyzers." : "Upload a rules file and a C file, then click “run the grader”. The agent compiles and runs the program in a sandbox, dispatches one analyzer per metric, and writes the grade and feedback to reports/<name>.json and reports/<name>.txt."} /></Card>}

          {result && <ReportTextCard text={result.text} path={result.files?.txt} />}

          <div className="grid md:grid-cols-2 gap-4">
            <SourceCard name={cFile?.name} source={cFile?.content} />
            <RulesCard name={rulesFile?.name} content={rulesFile?.content} hash={result?.report.rules_hash} />
          </div>
        </div>
      </div>
    </div>
  );
}

function StatusChip({ health }) {
  if (!health) return <Chip color={C.muted}><Loader2 size={11} className="animate-spin" /> checking…</Chip>;
  if (health.offline) return <Chip color={C.fail}><Cpu size={11} /> server offline</Chip>;
  if (!health.gcc) return <Chip color={C.fail}><Cpu size={11} /> gcc missing</Chip>;
  return <Chip color={C.truth}><Cpu size={11} /> gcc {health.gcc}{health.cppcheck ? ` · cppcheck ${health.cppcheck}` : ""}</Chip>;
}
function ModelChip({ health }) {
  if (!health || health.offline || !health.gcc) return null;
  const ok = health.ollamaModelAvailable;
  return <Chip color={ok ? C.model : C.faint}><Bot size={11} /> {ok ? health.ollamaModel : "no model · fallback"}</Chip>;
}
function Chip({ color, children }) {
  return <span className="flex items-center gap-1.5 font-mono text-[11px] px-2 py-1 rounded" style={{ border: `1px solid ${color}55`, color, background: `${color}0D` }}>{children}</span>;
}
function Banner({ color, children }) {
  return <div className="mb-4 rounded-lg px-4 py-3 font-mono text-sm" style={{ background: `${color}14`, border: `1px solid ${color}55`, color }}>{children}</div>;
}
function UploadSlot({ icon: Icon, accept, file, onFile, disabled, title, empty }) {
  const input = useRef(null);
  const [over, setOver] = useState(false);
  const take = (f) => { if (f && !disabled) onFile(f); };
  return (
    <div
      onClick={() => !disabled && input.current?.click()}
      onDragOver={(e) => { e.preventDefault(); setOver(true); }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => { e.preventDefault(); setOver(false); take(e.dataTransfer.files?.[0]); }}
      className={`flex items-center gap-3 rounded-lg p-3 ${disabled ? "opacity-50" : "cursor-pointer"}`}
      style={{ background: over ? `${C.info}12` : C.bg, border: `1px dashed ${file ? `${C.truth}88` : over ? C.info : C.border}` }}>
      <input ref={input} type="file" accept={accept} className="hidden"
        onChange={(e) => { take(e.target.files?.[0]); e.target.value = ""; }} />
      <Icon size={20} className="shrink-0" style={{ color: file ? C.truth : C.muted }} />
      <div className="min-w-0 flex-1">
        <div className="font-mono text-[12px]" style={{ color: C.muted }}>{title}</div>
        <div className="font-mono text-[13px] truncate" style={{ color: file ? C.text : C.faint }}>{file ? file.name : empty}</div>
      </div>
      <span className="flex items-center gap-1.5 font-mono text-[11px] px-2.5 py-1 rounded shrink-0" style={{ border: `1px solid ${C.info}66`, color: C.info }}>
        <Upload size={12} /> {file ? "replace" : "upload"}
      </span>
    </div>
  );
}
function Card({ children, accent }) {
  return <div className="rounded-lg p-4" style={{ background: C.surface, border: `1px solid ${accent ? `${accent}44` : C.border}` }}>{children}</div>;
}
function CardTitle({ icon: Icon, color = C.muted, children, right }) {
  return (
    <div className="flex items-center gap-2 mb-3">
      {Icon && <Icon size={14} style={{ color }} />}
      <span className="font-mono text-xs tracking-wide" style={{ color }}>{children}</span>
      {right && <span className="ml-auto">{right}</span>}
    </div>
  );
}
function Empty({ text }) { return <div className="text-[12px] leading-relaxed" style={{ color: C.faint }}>{text}</div>; }

function ReportFilesCard({ report, text, files }) {
  const stem = report.submission.replace(/\.c$/i, "");
  return (
    <Card>
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-1.5 font-mono text-[11px]" style={{ color: C.truth }}>
          <FolderOpen size={13} /> saved: {files.json} · {files.txt}
        </div>
        <div className="ml-auto flex gap-2">
          <DownloadBtn name={`${stem}.json`} data={JSON.stringify(report, null, 2) + "\n"} type="application/json" />
          <DownloadBtn name={`${stem}.txt`} data={text} type="text/plain" />
        </div>
      </div>
    </Card>
  );
}
function DownloadBtn({ name, data, type }) {
  function save() {
    const url = URL.createObjectURL(new Blob([data], { type }));
    const a = document.createElement("a");
    a.href = url; a.download = name; a.click();
    URL.revokeObjectURL(url);
  }
  return (
    <button onClick={save} className="flex items-center gap-1.5 font-mono text-[11px] px-2.5 py-1 rounded" style={{ border: `1px solid ${C.info}66`, color: C.info }}>
      <Download size={12} /> {name}
    </button>
  );
}

function SourceCard({ name, source }) {
  const lines = (source || "").replace(/\r\n/g, "\n").split("\n");
  return (
    <Card>
      <CardTitle icon={FileCode2}>SUBMISSION — {name || "(none)"}</CardTitle>
      {source ? (
        <pre className="font-mono text-[11px] leading-relaxed rounded p-2 overflow-auto max-h-80" style={{ background: C.bg, border: `1px solid ${C.border}` }}>
          {lines.map((l, i) => (
            <div key={i} className="flex">
              <span className="select-none w-7 shrink-0 text-right pr-2" style={{ color: C.faint }}>{i + 1}</span>
              <span style={{ color: C.text }}>{l || " "}</span>
            </div>
          ))}
        </pre>
      ) : <Empty text="Upload a .c file to see it here." />}
    </Card>
  );
}

function RulesCard({ name, content, hash }) {
  return (
    <Card>
      <CardTitle icon={FileJson} color={C.info}>RULES — {name || "(none)"}</CardTitle>
      {content
        ? <pre className="font-mono text-[10.5px] leading-relaxed rounded p-2 overflow-auto max-h-80" style={{ background: C.bg, border: `1px solid ${C.border}`, color: C.muted }}>{content}</pre>
        : <Empty text="Upload a rules .json file to see it here." />}
      <div className="mt-2 text-[10.5px]" style={{ color: C.faint }}>
        Kept outside the agent's code: edit this file to change metrics, thresholds or weights.{hash ? ` Hash ${hash.slice(0, 23)}…` : ""}
      </div>
    </Card>
  );
}

function ReportTextCard({ text, path }) {
  return (
    <Card>
      <CardTitle icon={FileText} color={C.truth}>TEXT REPORT — {path || "report.txt"}</CardTitle>
      <pre className="font-mono text-[11.5px] leading-relaxed rounded p-3 overflow-auto max-h-[36rem] whitespace-pre" style={{ background: C.bg, border: `1px solid ${C.border}`, color: C.text }}>{text}</pre>
    </Card>
  );
}
