import { spawnSync } from "child_process";
import { readFileSync, writeFileSync } from "fs";

export type ToolDefinition = {
  name: string;
  description: string;
  input_schema: {
    type: "object";
    properties: Record<string, { type: string; description: string }>;
    required: string[];
  };
  execute(args: Record<string, unknown>): Promise<string>;
};

// Strip execute() before sending to the API
export type APIToolDef = Omit<ToolDefinition, "execute">;
export function toAPITools(ts: ToolDefinition[]): APIToolDef[] {
  return ts.map(({ execute: _execute, ...rest }) => rest);
}

const MAX_OUTPUT = 4000;
const MAX_FILE = 8000;

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, max) + "\n[truncated]";
}

export const tools: ToolDefinition[] = [
  {
    name: "exec",
    description:
      "Run a shell command and return its output. Use for file operations, running programs, checking system state, etc.",
    input_schema: {
      type: "object",
      properties: {
        command: { type: "string", description: "Shell command to execute" },
        workdir: {
          type: "string",
          description: "Working directory (optional, defaults to current directory)",
        },
      },
      required: ["command"],
    },
    async execute(args) {
      const command = String(args.command);
      const cwd = args.workdir ? String(args.workdir) : process.cwd();
      try {
        const result = spawnSync("sh", ["-c", command], {
          cwd,
          encoding: "utf8",
          timeout: 30_000,
          maxBuffer: 1024 * 1024 * 8,
        });
        const stdout = result.stdout ?? "";
        const stderr = result.stderr ?? "";
        const combined = [
          stdout && `stdout:\n${stdout}`,
          stderr && `stderr:\n${stderr}`,
        ]
          .filter(Boolean)
          .join("\n");
        const output = combined || "(no output)";
        return `[exit ${result.status ?? "?"}]\n${truncate(output, MAX_OUTPUT)}`;
      } catch (err) {
        return `Error: ${err instanceof Error ? err.message : String(err)}`;
      }
    },
  },

  {
    name: "read_file",
    description: "Read the contents of a file and return it as text.",
    input_schema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Absolute or relative path to the file" },
      },
      required: ["path"],
    },
    async execute(args) {
      const path = String(args.path);
      try {
        const content = readFileSync(path, "utf8");
        return truncate(content, MAX_FILE);
      } catch (err) {
        return `Error: ${err instanceof Error ? err.message : String(err)}`;
      }
    },
  },

  {
    name: "write_file",
    description: "Write text content to a file, creating it if it does not exist.",
    input_schema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Absolute or relative path to write to" },
        content: { type: "string", description: "Text content to write" },
      },
      required: ["path", "content"],
    },
    async execute(args) {
      const path = String(args.path);
      const content = String(args.content);
      try {
        writeFileSync(path, content, "utf8");
        return `Written ${Buffer.byteLength(content, "utf8")} bytes to ${path}`;
      } catch (err) {
        return `Error: ${err instanceof Error ? err.message : String(err)}`;
      }
    },
  },
];

export async function executeTool(
  name: string,
  args: Record<string, unknown>
): Promise<string> {
  const tool = tools.find((t) => t.name === name);
  if (!tool) return `Error: unknown tool "${name}"`;
  try {
    return await tool.execute(args);
  } catch (err) {
    return `Error: ${err instanceof Error ? err.message : String(err)}`;
  }
}
