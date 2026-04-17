import * as readline from "readline";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { createProvider, listModels, setVerbose, isVerbose } from "./providers.ts";
import type { LLMProvider } from "./providers.ts";
import { runAgent, createSessionUsage } from "./agent.ts";
import type { NormalizedMessage, SessionUsage } from "./agent.ts";
import { c, icon, banner } from "./ui.ts";
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
  history: NormalizedMessage[];
  usage: SessionUsage;
  config: SavedConfig;
  quit: () => void;
};

type SlashCommand = {
  name: string;
  description: string;
  run(ctx: SlashContext, args: string[]): void;
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
    description: "Clear the conversation history (context reset)",
    run(ctx) {
      ctx.history.length = 0;
      console.log(c.dim(`${icon.check} Conversation history cleared.\n`));
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
    description: "Show how many turns are stored in the conversation history",
    run(ctx) {
      console.log(
        `  ${c.dim("History has")} ${c.cyan(String(ctx.history.length))} ${c.dim("messages.")}\n`
      );
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

/** Returns true if the input was handled as a slash command. */
function handleSlashCommand(input: string, ctx: SlashContext): boolean {
  if (!input.startsWith("/")) return false;
  const [name, ...args] = input.slice(1).trim().split(/\s+/);
  const cmd = SLASH_COMMANDS.find((c) => c.name === name);
  if (!cmd) {
    console.log(`Unknown command: /${name}. Type /help for a list.\n`);
    return true;
  }
  cmd.run(ctx, args);
  return true;
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

  const history: NormalizedMessage[] = [];
  const usage = createSessionUsage();
  let shouldQuit = false;

  console.log(
    c.dim(
      `Type ${c.cyan("/help")}${c.dim(" for slash commands, ")}${c.cyan("/exit")}${c.dim(" to quit.")}\n`
    )
  );

  const ctx: SlashContext = {
    history,
    usage,
    config,
    quit: () => {
      shouldQuit = true;
      rl.close();
    },
  };

  const userPrompt = `${c.cyan(icon.arrow)} `;

  function prompt() {
    rl.question(userPrompt, async (input) => {
      const trimmed = input.trim();

      if (!trimmed) {
        prompt();
        return;
      }

      // Back-compat: bare "exit" still quits
      if (trimmed === "exit") {
        console.log(c.orange(`\n${icon.spark} Bye!\n`));
        rl.close();
        return;
      }

      if (handleSlashCommand(trimmed, ctx)) {
        if (shouldQuit) return;
        prompt();
        return;
      }

      try {
        const reply = await runAgent(trimmed, history, provider, SYSTEM_PROMPT, usage);

        // Persist both sides for multi-turn context
        history.push({ role: "user", content: trimmed });
        history.push({ role: "assistant", content: reply });

        console.log(`\n${c.orange(icon.dot)} ${reply}\n`);
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
