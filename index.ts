import * as readline from "readline";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { createProvider, listModels, setVerbose, isVerbose } from "./providers.ts";
import type { LLMProvider } from "./providers.ts";
import {
  runAgent,
  createSessionUsage,
  printChatMessage,
  chatPreview,
  chatBody,
} from "./agent.ts";
import type { ChatMessage, SessionUsage } from "./agent.ts";
import { c, icon, banner, formatFileDiff } from "./ui.ts";
import { PRESETS, findPreset } from "./presets.ts";
import type { ProviderPreset } from "./presets.ts";

// ---------------------------------------------------------------------------
// Config persistence
// ---------------------------------------------------------------------------

type SavedConfig = {
  provider: string;
  apiKey: string;
  model: string;
  baseURL?: string;
};

const CONFIG_PATH = path.join(os.homedir(), ".agent-demo.json");

function loadConfig(): SavedConfig | null {
  try {
    const raw = fs.readFileSync(CONFIG_PATH, "utf8");
    return JSON.parse(raw) as SavedConfig;
  } catch {
    return null;
  }
}

function saveConfig(cfg: SavedConfig): void {
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2), { mode: 0o600 });
  // writeFileSync's `mode` only applies on creation; tighten perms if file already existed.
  fs.chmodSync(CONFIG_PATH, 0o600);
}

const SYSTEM_PROMPT = `You are an autonomous agent with shell and file system access.
When the user asks you to do something, DO IT using your tools — do not explain how they could do it themselves.
Use write_file to create files, exec to run shell commands, and read_file to read files.
Complete the full task before responding. Show the actual output from your tool calls in your reply.`;

// ---------------------------------------------------------------------------
// Startup: collect provider config
// ---------------------------------------------------------------------------

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

function ask(question: string, envFallback?: string): Promise<string> {
  const envValue = envFallback ? process.env[envFallback] : undefined;
  if (envValue) {
    console.log(`${question}(using env ${envFallback})`);
    return Promise.resolve(envValue);
  }
  return new Promise((resolve) => rl.question(question, resolve));
}

/** Fetch available models for the given preset and let the user pick one. */
async function pickModel(
  preset: ProviderPreset,
  apiKey: string,
  baseURL?: string
): Promise<string> {
  const defaultModel = preset.defaultModel;

  process.stdout.write(c.dim("Fetching available models... "));
  let models: string[] = [];
  try {
    models = await listModels(preset, apiKey, baseURL);
    process.stdout.write(c.dim(`${models.length} found.\n\n`));
  } catch (err) {
    process.stdout.write(
      c.dim(`(could not fetch: ${err instanceof Error ? err.message : err})\n`)
    );
  }

  if (models.length === 0) {
    const input = await ask(`Model [default: ${c.cyan(defaultModel)}]: `);
    return input.trim() || defaultModel;
  }

  console.log(c.dim("Available models:"));
  models.forEach((m, i) => console.log(`  ${c.dim(String(i + 1).padStart(3))}. ${m}`));
  console.log();

  const input = await ask(
    `Pick a number or type a model name [default: ${c.cyan(defaultModel)}]: `
  );
  const trimmed = input.trim();
  if (!trimmed) return defaultModel;

  const idx = parseInt(trimmed, 10);
  if (!isNaN(idx) && idx >= 1 && idx <= models.length) {
    return models[idx - 1];
  }
  return trimmed;
}

/** Show the numbered provider menu and return the chosen preset. */
async function pickPreset(): Promise<ProviderPreset> {
  // Env shortcut: PROVIDER=groq skips the menu entirely.
  const envProvider = process.env["PROVIDER"];
  if (envProvider) {
    const match = findPreset(envProvider);
    if (match) {
      console.log(c.dim(`Provider: ${match.id} (from env PROVIDER)`));
      return match;
    }
    console.log(c.yellow(`Env PROVIDER="${envProvider}" did not match any preset.`));
  }

  console.log(c.dim("Available providers:"));
  const labelWidth = Math.max(...PRESETS.map((p) => p.id.length));
  PRESETS.forEach((p, i) => {
    console.log(
      `  ${c.dim(String(i + 1).padStart(3))}. ${c.cyan(p.id.padEnd(labelWidth))}  ${c.dim(p.label)}`
    );
  });
  console.log();

  while (true) {
    const input = (await ask("Pick a number or type a provider id: ")).trim();
    if (!input) continue;

    const idx = parseInt(input, 10);
    if (!isNaN(idx) && idx >= 1 && idx <= PRESETS.length) return PRESETS[idx - 1];

    const match = findPreset(input);
    if (match) return match;

    console.log(c.yellow(`No provider matching "${input}". Try again.`));
  }
}

async function collectConfig(): Promise<SavedConfig> {
  const preset = await pickPreset();

  const apiKey = (await ask(`API key: `, preset.apiKeyEnv)).trim();

  let baseURL: string | undefined;
  if (preset.requiresCustomBaseURL) {
    const input = (await ask("Base URL (required for this preset): ")).trim();
    baseURL = input || undefined;
    if (!baseURL) throw new Error(`Preset "${preset.id}" requires a base URL.`);
  } else if (preset.flavor === "openai") {
    // Stock OpenAI: allow an override for proxies (Azure, etc.)
    const input = (await ask("Base URL (blank = OpenAI default): ")).trim();
    baseURL = input || undefined;
  }

  const model = await pickModel(preset, apiKey, baseURL);
  return { provider: preset.id, apiKey, model, baseURL };
}

async function setupWithConfig(): Promise<{ provider: LLMProvider; config: SavedConfig }> {
  const saved = loadConfig();
  let cfg: SavedConfig;

  console.log();
  console.log(
    banner([
      `${c.orange(icon.spark)}  ${c.bold("Agent Demo")}`,
      c.dim("A tiny multi-provider LLM agent"),
    ])
  );
  console.log();

  if (saved) {
    console.log(
      `${c.dim("Saved config:")} ${c.cyan(saved.provider)} ${c.dim("/")} ${c.cyan(saved.model)}`
    );
    const answer = await ask(
      `${c.dim("Press Enter to use it, or type")} ${c.yellow("reset")} ${c.dim("to reconfigure:")} `
    );
    if (answer.trim().toLowerCase() === "reset") {
      cfg = await collectConfig();
      saveConfig(cfg);
      console.log(c.dim(`Config saved to ${CONFIG_PATH}`));
    } else {
      cfg = saved;
    }
  } else {
    cfg = await collectConfig();
    saveConfig(cfg);
    console.log(c.dim(`Config saved to ${CONFIG_PATH}`));
  }

  const preset = findPreset(cfg.provider);
  if (!preset) {
    throw new Error(
      `Saved config references unknown provider "${cfg.provider}". ` +
        `Delete ${CONFIG_PATH} or type "reset" at the next prompt.`
    );
  }
  const provider = createProvider(preset, cfg.apiKey, cfg.model, cfg.baseURL);
  console.log();
  console.log(
    `${c.green(icon.check)} ${c.bold("Ready.")} ${c.dim("Using")} ${c.cyan(cfg.provider)} ${c.dim("/")} ${c.cyan(cfg.model)}`
  );
  return { provider, config: cfg };
}

// ---------------------------------------------------------------------------
// Slash commands
// ---------------------------------------------------------------------------

type SlashContext = {
  chat: ChatMessage[];
  usage: SessionUsage;
  config: SavedConfig;
  /** Tool-call rule keys the user said "always allow" for this session. */
  permissions: Set<string>;
  quit: () => void;
};

// ---------------------------------------------------------------------------
// Tool permission prompts (interactive y / a / n confirmation per tool call)
// ---------------------------------------------------------------------------

/** Bucket a tool call into a "type" for the always-allow rule.
 *  - exec → first command word (so `exec ls` covers `ls -la`, `ls /tmp`, …)
 *  - everything else → just the tool name */
function ruleKey(name: string, input: Record<string, unknown>): string {
  if (name === "exec") {
    const first = String(input.command ?? "").trim().split(/\s+/)[0] ?? "";
    return `exec:${first}`;
  }
  return `tool:${name}`;
}

function ruleDescription(name: string, input: Record<string, unknown>): string {
  if (name === "exec") {
    const first = String(input.command ?? "").trim().split(/\s+/)[0] ?? "";
    return `exec ${first} …`;
  }
  return name;
}

function makeAskPermission(
  permissions: Set<string>
): (name: string, input: Record<string, unknown>) => Promise<"allow" | "deny"> {
  return async (name, input) => {
    const key = ruleKey(name, input);
    if (permissions.has(key)) return "allow";

    const desc = ruleDescription(name, input);
    console.log();
    console.log(`  ${c.yellow(icon.warn)} ${c.bold("Permission requested")}`);
    console.log(`    ${c.dim("tool: ")} ${c.cyan(name)}`);

    if (name === "write_file") {
      // Show a diff of the proposed change against the file on disk
      // (or "new file" if it doesn't exist yet) instead of a raw JSON dump.
      const filePath = String(input.path ?? "");
      const newContent = String(input.content ?? "");
      let oldContent: string | null = null;
      try {
        oldContent = fs.readFileSync(filePath, "utf8");
      } catch {
        oldContent = null;
      }
      console.log(formatFileDiff(filePath, oldContent, newContent));
    } else {
      console.log(`    ${c.dim("input:")} ${c.dim(JSON.stringify(input))}`);
    }

    console.log(
      `  ${c.dim("[")}${c.green("y")}${c.dim("] yes once   [")}${c.green("a")}${c.dim(`] always for \`${desc}\`   [`)}${c.red("n")}${c.dim("] no")}`
    );

    while (true) {
      const ans = (
        await new Promise<string>((resolve) =>
          rl.question(`  ${c.cyan(icon.arrow)} `, resolve)
        )
      )
        .trim()
        .toLowerCase();
      if (ans === "" || ans === "y" || ans === "yes") return "allow";
      if (ans === "a" || ans === "always") {
        permissions.add(key);
        console.log(
          c.dim(`  ${icon.check} Will not ask again for \`${desc}\` this session.`)
        );
        return "allow";
      }
      if (ans === "n" || ans === "no") return "deny";
      console.log(c.yellow(`  Please answer y, a, or n.`));
    }
  };
}

function senderTag(m: ChatMessage): string {
  if (m.sender === "user") return c.cyan("you      ");
  if (m.sender === "model") {
    return c.orange(m.kind === "text" ? "model    " : "model →  ");
  }
  return c.lavender(m.kind === "system" ? "agent  ⚙ " : "agent  ↩ ");
}

function quoteRoleDescription(m: ChatMessage): string {
  if (m.sender === "user") return "you";
  if (m.sender === "model") {
    return m.kind === "text" ? "model" : "model → agent tool call";
  }
  return m.kind === "system"
    ? "agent → model system instruction"
    : "agent → model tool result";
}

function seedChat(chat: ChatMessage[]): void {
  const sys: ChatMessage = { sender: "agent", kind: "system", text: SYSTEM_PROMPT };
  chat.push(sys);
  printChatMessage(sys, chat.length);
}

type SlashCommand = {
  name: string;
  description: string;
  /** Return a string to forward it to the agent as synthesized user input
   *  (used by /quote); return nothing for commands that only print locally. */
  run(ctx: SlashContext, args: string[]): void | string;
};

function formatNumber(n: number): string {
  return n.toLocaleString("en-US");
}


const SLASH_COMMANDS: SlashCommand[] = [
  {
    name: "exit",
    description: "Quit the program",
    run(ctx) {
      console.log(c.orange(`\n${icon.spark} Bye!\n`));
      ctx.quit();
    },
  },
  {
    name: "quit",
    description: "Alias for /exit",
    run(ctx) {
      console.log(c.orange(`\n${icon.spark} Bye!\n`));
      ctx.quit();
    },
  },
  {
    name: "usage",
    description: "Show token usage for this session",
    run(ctx) {
      const u = ctx.usage;
      const total = u.inputTokens + u.outputTokens;
      const row = (label: string, value: string, accent = c.cyan) =>
        `  ${c.dim(label.padEnd(18))} ${accent(value)}`;
      console.log();
      console.log(`  ${c.orange(icon.spark)} ${c.bold("Session token usage")}`);
      console.log(
        row(
          "Provider",
          `${ctx.config.provider} ${c.dim("/")} ${ctx.config.model}`,
          (s) => s
        )
      );
      console.log(row("API requests", formatNumber(u.requests)));
      console.log(row("Input tokens", formatNumber(u.inputTokens)));
      console.log(row("Output tokens", formatNumber(u.outputTokens)));
      console.log(row("Cache read", formatNumber(u.cacheReadTokens), c.mint));
      console.log(row("Cache created", formatNumber(u.cacheCreationTokens), c.mint));
      console.log(row("Total (in+out)", formatNumber(total), c.bold));
      console.log();
    },
  },
  {
    name: "clear",
    description: "Clear the chat log (context reset; re-seeds system prompt)",
    run(ctx) {
      ctx.chat.length = 0;
      console.log(c.dim(`${icon.check} Chat log cleared.\n`));
      seedChat(ctx.chat);
    },
  },
  {
    name: "model",
    description: "Show the current provider and model",
    run(ctx) {
      console.log();
      console.log(`  ${c.dim("Provider:")} ${c.cyan(ctx.config.provider)}`);
      console.log(`  ${c.dim("Model:   ")} ${c.cyan(ctx.config.model)}`);
      if (ctx.config.baseURL)
        console.log(`  ${c.dim("Base URL:")} ${c.cyan(ctx.config.baseURL)}`);
      console.log();
    },
  },
  {
    name: "history",
    description: "List every message with numbers (use #N with /quote)",
    run(ctx) {
      if (ctx.chat.length === 0) {
        console.log(c.dim("  (no messages yet)\n"));
        return;
      }
      console.log();
      const width = String(ctx.chat.length).length;
      for (let i = 0; i < ctx.chat.length; i++) {
        const m = ctx.chat[i];
        const num = c.dim(`#${String(i + 1).padStart(width)}`);
        console.log(`  ${num} ${senderTag(m)}  ${c.dim(chatPreview(m))}`);
      }
      console.log();
    },
  },
  {
    name: "quote",
    description: "Quote any past message: /quote <num> <your message>",
    run(ctx, args) {
      if (args.length < 1) {
        console.log(c.yellow("Usage: /quote <num> <your message>\n"));
        return;
      }
      const idx = parseInt(args[0], 10);
      if (isNaN(idx) || idx < 1 || idx > ctx.chat.length) {
        console.log(
          c.yellow(
            `Message #${args[0]} not found. Chat has ${ctx.chat.length} messages — try /history.\n`
          )
        );
        return;
      }
      const rest = args.slice(1).join(" ").trim();
      if (!rest) {
        console.log(c.yellow("Usage: /quote <num> <your message>\n"));
        return;
      }
      const target = ctx.chat[idx - 1];
      const role = quoteRoleDescription(target);
      const quoted = chatBody(target)
        .split("\n")
        .map((line) => `> ${line}`)
        .join("\n");
      const forwarded = `[Quoting message #${idx} (${role}):]\n${quoted}\n\n${rest}`;
      console.log(
        `  ${c.dim(`${icon.check} Quoting #${idx} (${role}): ${chatPreview(target, 60)}`)}\n`
      );
      return forwarded;
    },
  },
  {
    name: "permissions",
    description: "View or clear remembered tool-call permissions (use: /permissions [clear])",
    run(ctx, args) {
      if (args[0] === "clear") {
        const n = ctx.permissions.size;
        ctx.permissions.clear();
        console.log(c.dim(`  ${icon.check} Cleared ${n} remembered permission(s).\n`));
        return;
      }
      if (ctx.permissions.size === 0) {
        console.log(
          c.dim("  No remembered permissions — every tool call will be confirmed.\n")
        );
        return;
      }
      console.log();
      console.log(`  ${c.bold("Remembered permissions")}`);
      for (const r of ctx.permissions) {
        console.log(`    ${c.green(icon.check)} ${c.cyan(r)}`);
      }
      console.log(c.dim(`  Run ${c.cyan("/permissions clear")} to remove all.\n`));
    },
  },
  {
    name: "verbose",
    description: "Toggle raw request/response JSON logging (usage: /verbose [on|off])",
    run(_ctx, args) {
      const arg = args[0]?.toLowerCase();
      let next: boolean;
      if (arg === "on" || arg === "true" || arg === "1") next = true;
      else if (arg === "off" || arg === "false" || arg === "0") next = false;
      else next = !isVerbose(); // no arg → toggle
      setVerbose(next);
      const state = next ? c.green("ON") : c.gray("OFF");
      console.log(`  ${c.dim("Verbose JSON logging:")} ${state}\n`);
    },
  },
  {
    name: "help",
    description: "List all slash commands",
    run() {
      console.log();
      console.log(`  ${c.orange(icon.spark)} ${c.bold("Slash commands")}`);
      const pad = Math.max(...SLASH_COMMANDS.map((cmd) => cmd.name.length));
      for (const cmd of SLASH_COMMANDS) {
        console.log(`    ${c.cyan("/" + cmd.name.padEnd(pad))}  ${c.dim(cmd.description)}`);
      }
      console.log();
    },
  },
];

type SlashResult =
  | { handled: false }
  | { handled: true; forward?: string };

function handleSlashCommand(input: string, ctx: SlashContext): SlashResult {
  if (!input.startsWith("/")) return { handled: false };
  const [name, ...args] = input.slice(1).trim().split(/\s+/);
  const cmd = SLASH_COMMANDS.find((c) => c.name === name);
  if (!cmd) {
    console.log(`Unknown command: /${name}. Type /help for a list.\n`);
    return { handled: true };
  }
  const result = cmd.run(ctx, args);
  return typeof result === "string"
    ? { handled: true, forward: result }
    : { handled: true };
}

// ---------------------------------------------------------------------------
// REPL
// ---------------------------------------------------------------------------

async function main() {
  let provider: LLMProvider;
  let config: SavedConfig;
  try {
    const result = await setupWithConfig();
    provider = result.provider;
    config = result.config;
  } catch (err) {
    console.error(`Setup failed: ${err instanceof Error ? err.message : String(err)}`);
    rl.close();
    process.exit(1);
  }

  const chat: ChatMessage[] = [];
  const usage = createSessionUsage();
  const permissions = new Set<string>();
  const askPermission = makeAskPermission(permissions);
  let shouldQuit = false;

  console.log(
    c.dim(
      `Type ${c.cyan("/help")}${c.dim(" for slash commands, ")}${c.cyan("/exit")}${c.dim(" to quit.")}\n`
    )
  );

  // Seed the chat with the agent's standing system instruction so it
  // shows up as message #1 and can be /quote'd like any other message.
  seedChat(chat);

  const ctx: SlashContext = {
    chat,
    usage,
    config,
    permissions,
    quit: () => {
      shouldQuit = true;
      rl.close();
    },
  };

  const userPrompt = `${c.cyan(icon.arrow)} `;

  function prompt() {
    rl.question(userPrompt, async (input) => {
      let userInput = input.trim();

      if (!userInput) {
        prompt();
        return;
      }

      // Back-compat: bare "exit" still quits
      if (userInput === "exit") {
        console.log(c.orange(`\n${icon.spark} Bye!\n`));
        rl.close();
        return;
      }

      const slashResult = handleSlashCommand(userInput, ctx);
      if (slashResult.handled) {
        if (shouldQuit) return;
        if (!slashResult.forward) {
          prompt();
          return;
        }
        // Slash command synthesized a user message — forward it to the agent.
        userInput = slashResult.forward;
      }

      // Push and stamp the user message; runAgent then appends + stamps
      // every model and agent message it produces this turn.
      const userMsg: ChatMessage = { sender: "user", kind: "text", text: userInput };
      chat.push(userMsg);
      printChatMessage(userMsg, chat.length);

      try {
        await runAgent(chat, provider, askPermission, usage);
      } catch (err) {
        console.error(
          `\n${c.red(icon.cross)} ${c.red("Error:")} ${err instanceof Error ? err.message : String(err)}\n`
        );
      }

      prompt();
    });
  }

  prompt();
}

main();
