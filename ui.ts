// ---------------------------------------------------------------------------
// Tiny terminal UI kit — colors, icons, banner, spinner.
// No dependencies; ANSI codes gate on TTY + NO_COLOR env.
// ---------------------------------------------------------------------------

const supportsColor = !!process.stdout.isTTY && !process.env.NO_COLOR;

function wrap(code: string, s: string): string {
  return supportsColor ? `\x1b[${code}m${s}\x1b[0m` : s;
}

export const c = {
  bold: (s: string) => wrap("1", s),
  dim: (s: string) => wrap("2", s),
  italic: (s: string) => wrap("3", s),
  underline: (s: string) => wrap("4", s),

  red: (s: string) => wrap("31", s),
  green: (s: string) => wrap("32", s),
  yellow: (s: string) => wrap("33", s),
  blue: (s: string) => wrap("34", s),
  magenta: (s: string) => wrap("35", s),
  cyan: (s: string) => wrap("36", s),
  gray: (s: string) => wrap("90", s),

  // 256-color accents
  orange: (s: string) => wrap("38;5;208", s),
  pink: (s: string) => wrap("38;5;213", s),
  mint: (s: string) => wrap("38;5;85", s),
  lavender: (s: string) => wrap("38;5;147", s),
};

export const icon = {
  spark: "✻",
  dot: "●",
  arrow: "❯",
  check: "✓",
  cross: "✗",
  info: "ℹ",
  warn: "⚠",
  tool: "⚒",
  bullet: "•",
  gear: "⚙",
};

/** Remove ANSI escape sequences so we can measure real display width. */
function stripAnsi(s: string): string {
  return s.replace(/\x1b\[[0-9;]*m/g, "");
}

/** Rounded-corner banner — the big welcome box at startup. */
export function banner(lines: string[], accent: (s: string) => string = c.orange): string {
  const pad = 3;
  const width = Math.max(...lines.map((l) => stripAnsi(l).length)) + pad * 2;
  const top = accent("╭" + "─".repeat(width) + "╮");
  const bot = accent("╰" + "─".repeat(width) + "╯");
  const side = accent("│");
  const empty = `${side}${" ".repeat(width)}${side}`;
  const body = lines.map((l) => {
    const visible = stripAnsi(l).length;
    const padRight = " ".repeat(width - pad - visible - pad);
    return `${side}${" ".repeat(pad)}${l}${padRight}${" ".repeat(pad)}${side}`;
  });
  return [top, empty, ...body, empty, bot].join("\n");
}

// ---------------------------------------------------------------------------
// JSON pretty-printer with syntax colors. Matches JSON.stringify(v, null, 2)
// semantics (undefined/function in objects are dropped; in arrays they
// become null) and layers ANSI colors on top:
//   - keys:         cyan
//   - strings:      green
//   - numbers:      mint
//   - true/false/null: yellow
//   - braces/brackets/punctuation: dim
// ---------------------------------------------------------------------------

function formatJsonValue(
  v: unknown,
  indent: number,
  depth: number
): string | undefined {
  if (v === null) return c.yellow("null");
  if (v === undefined) return undefined;
  if (typeof v === "boolean") return c.yellow(String(v));
  if (typeof v === "number") return c.mint(Number.isFinite(v) ? String(v) : "null");
  if (typeof v === "bigint") return c.mint(String(v));
  if (typeof v === "string") return c.green(JSON.stringify(v));
  if (typeof v === "function" || typeof v === "symbol") return undefined;

  const pad = " ".repeat(depth * indent);
  const inner = " ".repeat((depth + 1) * indent);

  if (Array.isArray(v)) {
    if (v.length === 0) return c.dim("[]");
    const items = v.map((item) => {
      const rendered = formatJsonValue(item, indent, depth + 1);
      // JSON spec: undefined/function in arrays become null.
      return inner + (rendered ?? c.yellow("null"));
    });
    return c.dim("[") + "\n" + items.join(c.dim(",") + "\n") + "\n" + pad + c.dim("]");
  }

  if (typeof v === "object") {
    const items: string[] = [];
    for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
      const rendered = formatJsonValue(val, indent, depth + 1);
      if (rendered === undefined) continue; // drop like JSON.stringify does
      items.push(
        `${inner}${c.cyan(JSON.stringify(k))}${c.dim(":")} ${rendered}`
      );
    }
    if (items.length === 0) return c.dim("{}");
    return c.dim("{") + "\n" + items.join(c.dim(",") + "\n") + "\n" + pad + c.dim("}");
  }

  return undefined;
}

/** Format a value as indented, syntax-colored JSON. */
export function formatJson(value: unknown, indent = 2): string {
  const s = formatJsonValue(value, indent, 0);
  return s ?? c.dim("undefined");
}

// ---------------------------------------------------------------------------
// File-edit preview (unified-diff-style) used by the permission prompt
// when the model wants to write a file.
// ---------------------------------------------------------------------------

type DiffOp = { type: "add" | "del" | "ctx"; line: string };
type NumberedDiffOp = DiffOp & { oldLn: number; newLn: number };

/** O(m*n) LCS-based line diff. Fine for the file sizes a demo writes. */
function lineDiff(oldText: string, newText: string): DiffOp[] {
  const oldLines = oldText.split("\n");
  const newLines = newText.split("\n");
  const m = oldLines.length;
  const n = newLines.length;

  const lcs: number[][] = Array.from({ length: m + 1 }, () =>
    new Array(n + 1).fill(0)
  );
  for (let i = m - 1; i >= 0; i--) {
    for (let j = n - 1; j >= 0; j--) {
      lcs[i][j] =
        oldLines[i] === newLines[j]
          ? lcs[i + 1][j + 1] + 1
          : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
    }
  }

  const out: DiffOp[] = [];
  let i = 0;
  let j = 0;
  while (i < m && j < n) {
    if (oldLines[i] === newLines[j]) {
      out.push({ type: "ctx", line: oldLines[i] });
      i++;
      j++;
    } else if (lcs[i + 1][j] >= lcs[i][j + 1]) {
      out.push({ type: "del", line: oldLines[i++] });
    } else {
      out.push({ type: "add", line: newLines[j++] });
    }
  }
  while (i < m) out.push({ type: "del", line: oldLines[i++] });
  while (j < n) out.push({ type: "add", line: newLines[j++] });
  return out;
}

function numberDiff(diff: DiffOp[]): NumberedDiffOp[] {
  let oldLn = 1;
  let newLn = 1;
  return diff.map((d) => {
    const out: NumberedDiffOp = { ...d, oldLn: 0, newLn: 0 };
    if (d.type === "ctx") {
      out.oldLn = oldLn++;
      out.newLn = newLn++;
    } else if (d.type === "del") {
      out.oldLn = oldLn++;
    } else {
      out.newLn = newLn++;
    }
    return out;
  });
}

/** Bucket changes into hunks with `contextLines` of surrounding context. */
function makeHunks(
  diff: NumberedDiffOp[],
  contextLines: number
): NumberedDiffOp[][] {
  const changes = diff.flatMap((d, i) => (d.type !== "ctx" ? [i] : []));
  if (changes.length === 0) return [];

  const ranges: Array<[number, number]> = [];
  let start = Math.max(0, changes[0] - contextLines);
  let end = Math.min(diff.length - 1, changes[0] + contextLines);
  for (let i = 1; i < changes.length; i++) {
    const ws = Math.max(0, changes[i] - contextLines);
    const we = Math.min(diff.length - 1, changes[i] + contextLines);
    if (ws <= end + 1) {
      end = Math.max(end, we);
    } else {
      ranges.push([start, end]);
      start = ws;
      end = we;
    }
  }
  ranges.push([start, end]);
  return ranges.map(([s, e]) => diff.slice(s, e + 1));
}

const MAX_DIFF_LINES = 80;

/** Render a file edit as a colored unified-diff preview.
 *  Pass `oldText: null` for a new file (every line shown as an addition). */
export function formatFileDiff(
  path: string,
  oldText: string | null,
  newText: string
): string {
  const out: string[] = [];
  const rule = c.dim("│");

  // New file: every line is an addition.
  if (oldText === null) {
    const lines = newText.split("\n");
    const lnW = String(lines.length).length;
    out.push(
      `  ${c.bold(path)}  ${c.dim(`(new file, ${lines.length} line${lines.length === 1 ? "" : "s"})`)}`
    );
    out.push(`  ${rule}`);
    const shown = lines.slice(0, MAX_DIFF_LINES);
    for (let i = 0; i < shown.length; i++) {
      const ln = c.dim(String(i + 1).padStart(lnW));
      out.push(`  ${rule} ${c.green("+")} ${ln}  ${c.green(shown[i])}`);
    }
    if (lines.length > MAX_DIFF_LINES) {
      out.push(`  ${rule} ${c.dim(`… and ${lines.length - MAX_DIFF_LINES} more lines`)}`);
    }
    return out.join("\n");
  }

  if (oldText === newText) {
    return `  ${c.bold(path)}  ${c.dim("(no changes — file content is identical)")}`;
  }

  const diff = lineDiff(oldText, newText);
  const numbered = numberDiff(diff);
  const hunks = makeHunks(numbered, 2);

  const adds = diff.reduce((n, d) => n + (d.type === "add" ? 1 : 0), 0);
  const dels = diff.reduce((n, d) => n + (d.type === "del" ? 1 : 0), 0);
  const lnW = String(
    Math.max(...numbered.map((d) => Math.max(d.oldLn, d.newLn)))
  ).length;

  out.push(
    `  ${c.bold(path)}  ${c.green(`+${adds}`)} ${c.red(`-${dels}`)}`
  );
  out.push(`  ${rule}`);

  let displayed = 0;
  let truncated = false;
  outer: for (let h = 0; h < hunks.length; h++) {
    if (h > 0) out.push(`  ${rule} ${c.dim("…")}`);
    for (const item of hunks[h]) {
      if (displayed >= MAX_DIFF_LINES) {
        truncated = true;
        break outer;
      }
      const ln = item.type === "del" ? item.oldLn : item.newLn;
      const lnStr = c.dim(String(ln).padStart(lnW));
      if (item.type === "add") {
        out.push(`  ${rule} ${c.green("+")} ${lnStr}  ${c.green(item.line)}`);
      } else if (item.type === "del") {
        out.push(`  ${rule} ${c.red("-")} ${lnStr}  ${c.red(item.line)}`);
      } else {
        out.push(`  ${rule} ${c.dim("  " + lnStr + "  " + item.line)}`);
      }
      displayed++;
    }
  }
  if (truncated) {
    const remainingChanges = adds + dels - displayed;
    out.push(
      `  ${rule} ${c.dim(`… diff truncated (${remainingChanges} more changed lines)`)}`
    );
  }
  return out.join("\n");
}

/** Lightweight terminal spinner. Automatically no-ops on non-TTY. */
export class Spinner {
  private readonly frames = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
  private i = 0;
  private timer: NodeJS.Timeout | null = null;
  private label = "";

  start(label: string): void {
    if (!supportsColor) return;
    this.label = label;
    this.stop(); // defensive
    this.timer = setInterval(() => {
      const frame = this.frames[this.i];
      this.i = (this.i + 1) % this.frames.length;
      process.stdout.write(`\r${c.cyan(frame)} ${c.dim(this.label)}   `);
    }, 80);
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    if (supportsColor) {
      // Carriage return + erase-line so the next print starts clean.
      process.stdout.write("\r\x1b[2K");
    }
  }
}
