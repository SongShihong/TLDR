# Slash commands

The REPL supports Claude-style slash commands. Any line starting with `/` is
intercepted by the client and is **not** sent to the model.

## UI at a glance

- Startup shows a rounded-corner welcome banner.
- Your input prompt is a cyan `❯`.
- Assistant replies are prefixed with an orange `●`.
- Tool calls show as `⚒ <tool-name> <preview>` in mint + dim gray.
- While waiting for the model, a cyan braille spinner (`⠋⠙⠹…`) reads
  "thinking" — it auto-disables under `/verbose` so raw JSON isn't clobbered.
- Colors auto-disable on non-TTY stdout or when `NO_COLOR` is set.

All styling lives in `ui.ts` (no dependencies — raw ANSI escapes).

## Available commands

| Command     | What it does                                                |
| ----------- | ----------------------------------------------------------- |
| `/help`     | List all available commands.                                |
| `/exit`     | Quit the program. `/quit` is an alias. Bare `exit` also works. |
| `/usage`    | Show cumulative token usage for the current session.        |
| `/model`    | Show the active provider, model, and base URL (if any).     |
| `/history`  | List stored messages, numbered (use the number with `/quote`). |
| `/quote`    | Quote a past message: `/quote <num> <your message>`. The referenced message is unfolded into the JSON sent to the model as a `> ...` block prefixed to your new message. |
| `/clear`    | Wipe the conversation history (context reset, config kept). |
| `/verbose`  | Toggle raw request/response JSON logging. `/verbose on` or `/verbose off` forces a state; no arg flips it. Default: off (plain text only). |

## Examples

```
you> /help

Available slash commands:
  /exit     Quit the program
  /quit     Alias for /exit
  /usage    Show token usage for this session
  /clear    Clear the conversation history (context reset)
  /model    Show the current provider and model
  /history  Show how many turns are stored in the conversation history
  /help     List all slash commands

you> What is 2 + 2?
assistant> 4

you> /usage

Session token usage
  Provider:          anthropic / claude-sonnet-4-6
  API requests:      1
  Input tokens:      42
  Output tokens:     5
  Cache read:        0
  Cache created:     0
  Total (in+out):    47

you> /clear
Conversation history cleared.

you> /exit
Bye!
```

### Quoting a past message

The assistant's reply is annotated with its message number (`[#N]`). Use
`/history` to see numbers for both sides of the conversation, then
`/quote <num> <your message>` to reply with the referenced message
unfolded into the JSON sent to the model.

```
you> What's the capital of France?

● [#2] Paris.

you> /history

  #1 you        What's the capital of France?
  #2 assistant  Paris.

you> /quote 2 Tell me three facts about it.

  ✓ Quoting #2 (assistant): Paris.

# The model receives the user message:
#   [Quoting message #2 (assistant):]
#   > Paris.
#
#   Tell me three facts about it.
```


## How it works

Every line you type is intercepted before being passed to the agent.

1. `handleSlashCommand(input, ctx)` in `index.ts` checks if the line starts
   with `/`. If yes, it looks up the command in the `SLASH_COMMANDS` array
   and runs it. The line is never forwarded to the LLM.
2. If the command is unknown it prints a hint pointing at `/help`.
3. Otherwise the line is forwarded to `runAgent(...)` for a normal turn.

## Token-usage accounting

Token accounting lives inside the `SessionUsage` object created in `main()`
and is passed to `runAgent(...)`. After each provider call, `agent.ts`
reads `response.usage` (which every provider fills in) and accumulates:

- `inputTokens` / `outputTokens` — prompt and completion tokens
- `cacheReadTokens` — tokens served from a cached prompt (Anthropic /
  OpenAI's `prompt_tokens_details.cached_tokens` / Gemini's
  `cachedContentTokenCount`)
- `cacheCreationTokens` — tokens spent writing to the Anthropic prompt
  cache (0 for OpenAI and Gemini, which don't expose this)
- `requests` — number of provider round trips in the session (one user
  turn can trigger several if the model calls tools)

`/usage` formats and prints this struct.

## Adding a new slash command

Slash commands are plain entries in the `SLASH_COMMANDS` array in
`index.ts`. To add one:

```ts
{
  name: "tokens",
  description: "Print the total token count only",
  run(ctx) {
    const { inputTokens, outputTokens } = ctx.usage;
    console.log(`${inputTokens + outputTokens} tokens total`);
  },
},
```

Each command receives a `SlashContext` with the live history, session
usage, provider config, and a `quit()` helper — that's everything you
need to build a new command without touching the REPL itself.

The command's `run` function receives:

- `ctx.history` — the live `NormalizedMessage[]`. Mutate it (e.g. via
  `ctx.history.length = 0`) to rewrite context, or read it for inspection.
- `ctx.usage` — the live `SessionUsage` accumulator.
- `ctx.config` — the saved provider/model/baseURL.
- `ctx.quit()` — close the readline interface and stop the REPL.
- `args: string[]` — everything after the command name, split on whitespace.
