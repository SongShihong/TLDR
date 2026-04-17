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
