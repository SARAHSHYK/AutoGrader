
const KEYWORDS = new Set([
  "auto", "break", "case", "char", "const", "continue", "default", "do", "double", "else", "enum",
  "extern", "float", "for", "goto", "if", "inline", "int", "long", "register", "restrict", "return",
  "short", "signed", "sizeof", "static", "struct", "switch", "typedef", "union", "unsigned", "void",
  "volatile", "while", "_Bool", "bool", "size_t",
]);

const LIBRARY = new Set([
  "main", "printf", "scanf", "fprintf", "fscanf", "sscanf", "puts", "gets", "fgets", "getchar",
  "putchar", "malloc", "calloc", "realloc", "free", "strlen", "strcpy", "strcmp", "memset", "memcpy",
  "abs", "llabs", "sqrt", "pow", "qsort", "exit", "stdin", "stdout", "stderr", "NULL", "EOF",
  "INT_MAX", "INT_MIN", "LLONG_MAX", "LLONG_MIN",
]);

export function blank(src, { commentsOnly = false } = {}) {
  let out = "";
  let i = 0;
  const n = src.length;
  while (i < n) {
    const c = src[i], d = src[i + 1];
    if (c === "/" && d === "/") {
      while (i < n && src[i] !== "\n") { out += " "; i++; }
    } else if (c === "/" && d === "*") {
      out += "  "; i += 2;
      while (i < n && !(src[i] === "*" && src[i + 1] === "/")) { out += src[i] === "\n" ? "\n" : " "; i++; }
      if (i < n) { out += "  "; i += 2; }
    } else if (c === '"' || c === "'") {
      out += c; i++;
      while (i < n && src[i] !== c && src[i] !== "\n") {
        const take = src[i] === "\\" && i + 1 < n ? 2 : 1;
        out += commentsOnly ? src.slice(i, i + take) : " ".repeat(take);
        i += take;
      }
      if (i < n && src[i] === c) { out += c; i++; }
    } else { out += c; i++; }
  }
  if (commentsOnly) return out;
  const lines = out.split("\n");
  let cont = false;
  for (let k = 0; k < lines.length; k++) {
    if (cont || /^\s*#/.test(lines[k])) {
      cont = /\\\s*$/.test(lines[k]);
      lines[k] = " ".repeat(lines[k].length);
    }
  }
  return lines.join("\n");
}

function lineIndex(text) {
  const starts = [0];
  for (let i = 0; i < text.length; i++) if (text[i] === "\n") starts.push(i + 1);
  return (pos) => {
    let lo = 0, hi = starts.length - 1;
    while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (starts[mid] <= pos) lo = mid; else hi = mid - 1; }
    return lo + 1;
  };
}

export function cyclomatic(code) {
  const count = (re) => (code.match(re) || []).length;
  return 1 + count(/\b(if|for|while|case)\b/g) + count(/&&|\|\|/g) + count(/\?/g);
}

function maxNesting(body) {
  let depth = 0, max = 0;
  for (const ch of body) {
    if (ch === "{") max = Math.max(max, ++depth);
    else if (ch === "}") depth--;
  }
  return max;
}

function callsIn(body) {
  const names = new Set();
  const re = /\b([A-Za-z_]\w*)\s*\(/g;
  let m;
  while ((m = re.exec(body))) if (!KEYWORDS.has(m[1])) names.add(m[1]);
  return [...names];
}

export function findFunctions(src) {
  const code = blank(src);
  const lineOf = lineIndex(code);
  const fns = [];
  let depth = 0, boundary = 0, open = null;
  for (let i = 0; i < code.length; i++) {
    const ch = code[i];
    if (ch === "{") {
      if (depth === 0) {
        const head = code.slice(boundary, i);
        const m = head.match(/([A-Za-z_]\w*)\s*\(([^;{}]*)\)\s*$/);
        if (m && !KEYWORDS.has(m[1]) && !/=/.test(head.slice(0, head.lastIndexOf(m[1])))) {
          open = { name: m[1], params: m[2].trim(), nameIdx: boundary + head.lastIndexOf(m[1]), bodyStart: i + 1 };
        }
      }
      depth++;
    } else if (ch === "}") {
      depth--;
      if (depth === 0) {
        if (open) {
          const body = code.slice(open.bodyStart, i);
          const startLine = lineOf(open.nameIdx), endLine = lineOf(i);
          const nloc = code.split("\n").slice(startLine - 1, endLine).filter((l) => l.trim()).length;
          fns.push({
            name: open.name, params: open.params, startLine, endLine, nloc,
            cyclomatic: cyclomatic(body), nesting: maxNesting(body), calls: callsIn(body),
          });
          open = null;
        }
        boundary = i + 1;
      }
    } else if (ch === ";" && depth === 0) {
      boundary = i + 1;
    }
  }
  return fns;
}

export function declaredNames(src) {
  const TYPE = /^\s*(?:(?:const|static|unsigned|signed|long|short|int|char|float|double|size_t|bool|_Bool|struct\s+\w+)\b\s*)+\**\s*/;
  const names = new Set();
  const add = (id) => { if (id && !KEYWORDS.has(id)) names.add(id); };
  for (const stmt of blank(src).split(/[;{}]/)) {
    const s = stmt.replace(/^\s*for\s*\(/, "");
    const m = s.match(TYPE);
    if (!m) continue;
    const rest = s.slice(m[0].length);
    if (/^[A-Za-z_]\w*\s*\(/.test(rest)) {
      const params = rest.slice(rest.indexOf("(") + 1, rest.lastIndexOf(")"));
      for (const p of splitTopLevel(params)) add((p.match(/([A-Za-z_]\w*)\s*(?:\[[^\]]*\])?\s*$/) || [])[1]);
      continue;
    }
    for (const part of splitTopLevel(rest)) add((part.match(/^\s*\**\s*([A-Za-z_]\w*)/) || [])[1]);
  }
  return [...names];
}

function splitTopLevel(text) {
  const parts = [];
  let depth = 0, cur = "";
  for (const ch of text) {
    if (ch === "(" || ch === "[") depth++;
    else if (ch === ")" || ch === "]") depth--;
    if (ch === "," && depth === 0) { parts.push(cur); cur = ""; } else cur += ch;
  }
  parts.push(cur);
  return parts;
}

export function sourceStats(src) {
  const lines = src.replace(/\r\n/g, "\n").split("\n");
  const code = blank(src.replace(/\r\n/g, "\n"), { commentsOnly: true }).split("\n");
  let commentLines = 0, codeLines = 0, blankLines = 0, longLines = 0;
  lines.forEach((l, k) => {
    if (!l.trim()) blankLines++;
    else if (!code[k].trim()) commentLines++;
    else { codeLines++; if (l.trim() !== code[k].trim()) commentLines++; }
    if (l.length > 100) longLines++;
  });
  const names = declaredNames(src);
  const LOOP_INDICES = new Set(["i", "j", "k", "n"]);
  const shortNames = names.filter((n) => n.length === 1 && !LOOP_INDICES.has(n));
  const blanked = blank(src);
  const crampedCommas = (blanked.match(/,(?=\S)/g) || []).length;
  return {
    lines: lines.length, codeLines, commentLines, blankLines, longLines,
    identifiers: names, shortIdentifiers: shortNames, crampedCommas,
    functions: findFunctions(src).length,
  };
}

export function normalizedTokens(src) {
  const code = blank(src);
  const re = /"[^"\n]*"|'[^'\n]*'|[A-Za-z_]\w*|\d[\w.]*|==|!=|<=|>=|&&|\|\||\+\+|--|->|<<|>>|[+\-*/%=<>!&|^~?:;,.(){}[\]]/g;
  return (code.match(re) || []).map((t) => {
    if (t[0] === '"') return "S";
    if (t[0] === "'") return "C";
    if (/^\d/.test(t)) return "N";
    if (/^[A-Za-z_]/.test(t)) return KEYWORDS.has(t) || LIBRARY.has(t) ? t : "ID";
    return t;
  });
}
