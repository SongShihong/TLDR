# TLDR

**Too Long; Don't Read** — a minimal multi-provider LLM agent harness
with prompt caching, live token accounting, and a Claude-Code-style
terminal UI.

```
        ╭────────────────────────────────────╮
        │                                    │
        │   ✻  TLDR                          │
        │   token-saving agent harness       │
        │                                    │
        ╰────────────────────────────────────╯
```

One tiny REPL you can point at Anthropic, OpenAI, or Gemini. It speaks
tool-use, tracks tokens across the whole session, flips on Anthropic
prompt caching by default, and renders everything through a terminal UI
inspired by Claude Code.

---

## Features

- **Three providers, one interface** — Anthropic, OpenAI, Gemini
- **Prompt caching on Anthropic** — system prompt is marked
  `cache_control: ephemeral` on every request
- **Real tool use** — built-in `exec`, `read_file`, `write_file`
- **Slash commands** — `/help`, `/usage`, `/verbose`, `/clear`,
  `/model`, `/history`, `/exit`
- **Live token accounting** — input, output, cache-read,
  cache-created, and request counts for the whole session
- **Verbose mode** — `/verbose` toggles a full JSON dump of every
  request and response for when you want to see what the SDK actually
  sent
- **Themed UI** — rounded welcome banner, cyan `❯` prompt, orange `●`
  assistant replies, mint-colored tool-call previews, braille spinner
  while the model is thinking
- **Zero UI dependencies** — raw ANSI, honors `NO_COLOR`, auto-disables
  on non-TTY stdout

---

## Quick start

```sh
# Clone
git clone git@github.com:SongShihong/TLDR.git
cd TLDR

# Install
bun install          # or: npm install

# Run
bun start            # or: npx tsx index.ts
```

On first launch it walks you through picking a provider, model, and
API key, then saves the config to `~/.agent-demo.json` (mode `0600`).
Subsequent runs reuse it — type `reset` at the prompt to redo setup.

### Environment-variable shortcuts

Setting these lets the setup skip the matching question:

| Env                                     | Purpose                            |
| --------------------------------------- | ---------------------------------- |
| `PROVIDER`                              | `anthropic`, `openai`, or `gemini` |
| `ANTHROPIC_API_KEY`                     | Anthropic key                      |
| `OPENAI_API_KEY`                        | OpenAI key                         |
| `GEMINI_API_KEY` / `GOOGLE_API_KEY`     | Gemini key                         |
| `NO_COLOR`                              | Disable colored output             |

---

## Slash commands

| Command     | What it does                                               |
| ----------- | ---------------------------------------------------------- |
| `/help`     | List all slash commands                                    |
| `/usage`    | Session token usage (input, output, cache, requests)       |
| `/model`    | Show the active provider / model / base URL                |
| `/history`  | Show how many messages are held in context                 |
| `/clear`    | Wipe the conversation history (keeps config)               |
| `/verbose`  | Toggle raw request/response JSON dumps. Optional arg: `on`/`off` |
| `/exit`     | Quit. `/quit` is an alias; bare `exit` also works          |

A full reference and "how to add your own slash command" is in
[SLASH_COMMANDS.md](SLASH_COMMANDS.md).

---

## What a session looks like

```
╭────────────────────────────────╮
│                                │
│   ✻  Agent Demo                │
│   A tiny multi-provider LLM    │
│                                │
╰────────────────────────────────╯

Saved config: anthropic / claude-sonnet-4-6
Press Enter to use it, or type reset to reconfigure:

✓ Ready. Using anthropic / claude-sonnet-4-6
Type /help for slash commands, /exit to quit.

❯ list the files in this folder
⠹ thinking
  ⚒ exec {"command":"ls"}

● Here are the files in the current folder:
  README.md, SLASH_COMMANDS.md, agent.ts, index.ts, providers.ts,
  tools.ts, ui.ts, package.json, tsconfig.json.

❯ /usage

  ✻ Session token usage
  Provider           anthropic / claude-sonnet-4-6
  API requests       2
  Input tokens       1,204
  Output tokens      187
  Cache read         1,140
  Cache created      64
  Total (in+out)     1,391

❯ /exit
✻ Bye!
```

---

## Architecture

```
index.ts       REPL, config persistence, slash dispatcher, UI wiring
agent.ts       tool-use loop, session-usage accumulator, spinner
providers.ts   AnthropicProvider, OpenAIProvider, GeminiProvider
tools.ts       exec, read_file, write_file
ui.ts          colors, icons, rounded banner, spinner (no deps)
```

Every provider conforms to the same tiny interface:

```ts
interface LLMProvider {
  complete(
    systemPrompt: string,
    messages: NormalizedMessage[],
    tools: APIToolDef[],
  ): Promise<LLMResponse>;
}
```

`NormalizedMessage` and `LLMResponse` unify tool-use semantics across
the three SDKs, so `agent.ts` doesn't care which one is underneath.

Adding a new tool is one entry in `tools.ts`:

```ts
{
  name: "my_tool",
  description: "What it does",
  input_schema: { type: "object", properties: { ... }, required: [...] },
  async execute(args) { return "result"; },
}
```

Adding a new slash command is one entry in the `SLASH_COMMANDS` array
in `index.ts`. See `SLASH_COMMANDS.md` for the template.

---

## Why "TLDR"?

*Too Long; Don't Read.*

Re-sending the same system prompt and tool schema on every request
wastes tokens fast. This repo is where experiments for keeping that
bill down live — prompt caching, cache-aware usage telemetry,
one-keystroke context resets — behind a UI that stays out of the way.

---

## License

No license attached. Treat it as a personal sandbox.
