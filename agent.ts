import type {
  LLMProvider,
  NormalizedMessage,
  NormalizedToolUse,
  NormalizedToolResult,
  Usage,
} from "./providers.ts";
import { isVerbose } from "./providers.ts";
import { tools, toAPITools, executeTool } from "./tools.ts";
import { c, icon, Spinner } from "./ui.ts";

// ---------------------------------------------------------------------------
// Chat log — single source of truth for the conversation.
//
// Three actors send messages:
//   - "user"   — the human typing in the REPL
//   - "model"  — the LLM (text replies AND tool-call requests)
//   - "agent"  — this harness, which executes tools on the model's behalf
//                and feeds each tool's output back as a message
//
// Every entry is one discrete event the user can see. We number them
// globally so /quote <N> can reference any of them.
// ---------------------------------------------------------------------------

export type ChatMessage =
  | { sender: "user"; kind: "text"; text: string }
  | { sender: "model"; kind: "text"; text: string }
  | {
      sender: "model";
      kind: "tool_call";
      toolUseId: string;
      name: string;
      input: Record<string, unknown>;
      _geminiThoughtSignature?: string;
    }
  | {
      sender: "agent";
      kind: "tool_result";
      toolUseId: string;
      output: string;
    }
  // The agent's standing instructions to the model. Sent on every request
  // (as the provider's `system` field), but logically a single agent→model
  // message that seeds the conversation — so we put it in chat as #1.
  | { sender: "agent"; kind: "system"; text: string };

export type SessionUsage = Usage & { requests: number };

export function createSessionUsage(): SessionUsage {
  return {
    inputTokens: 0,
    outputTokens: 0,
    cacheCreationTokens: 0,
    cacheReadTokens: 0,
    requests: 0,
  };
}

// ---------------------------------------------------------------------------
// Display
// ---------------------------------------------------------------------------

function clipLine(s: string, max = 80): string {
  const collapsed = s.replace(/\s+/g, " ").trim();
  return collapsed.length > max ? collapsed.slice(0, max - 1) + "…" : collapsed;
}

/** Short single-line summary used by /history and /quote previews. */
export function chatPreview(m: ChatMessage, max = 80): string {
  switch (m.kind) {
    case "text":
    case "system":
      return clipLine(m.text, max);
    case "tool_call":
      return clipLine(`${m.name}(${JSON.stringify(m.input)})`, max);
    case "tool_result":
      return clipLine(m.output, max);
  }
}

const SENDER_COLOR: Record<ChatMessage["sender"], (s: string) => string> = {
  user: c.cyan,
  model: c.orange,
  agent: c.lavender,
};

/** The full content of a message as a quotable string. Tool-calls render
 *  as "name(jsonArgs)" and tool-results as their raw output. */
export function chatBody(m: ChatMessage): string {
  switch (m.kind) {
    case "text":
    case "system":
      return m.text;
    case "tool_call":
      return `${m.name}(${JSON.stringify(m.input, null, 2)})`;
    case "tool_result":
      return m.output;
  }
}

/** Live-render a new message to stdout with its #N tag. */
export function printChatMessage(m: ChatMessage, index: number): void {
  const num = c.dim(`[#${index}]`);
  const sender = SENDER_COLOR[m.sender](m.sender.padEnd(5));
  switch (m.kind) {
    case "text":
      if (m.sender === "user") {
        // Readline already echoed what the user typed; just stamp it.
        console.log(`  ${num} ${sender}`);
      } else {
        console.log(`\n${c.orange(icon.dot)} ${num} ${sender}  ${m.text}\n`);
      }
      break;
    case "tool_call":
      console.log(
        `  ${num} ${sender}  ${c.mint(icon.tool)} ${c.bold(m.name)} ${c.dim(clipLine(JSON.stringify(m.input), 72))}`
      );
      break;
    case "tool_result":
      console.log(`  ${num} ${sender}  ${c.dim("↩ " + clipLine(m.output, 80))}`);
      break;
    case "system":
      console.log(
        `  ${num} ${sender}  ${c.lavender(icon.gear)} ${c.dim("system instruction")}`
      );
      for (const line of m.text.split("\n")) {
        console.log(`        ${c.dim(c.italic(line))}`);
      }
      console.log();
      break;
  }
}

// ---------------------------------------------------------------------------
// Provider serialization
// ---------------------------------------------------------------------------

/** Convert the chat log into the alternating user/assistant turns the
 *  provider SDKs require. Consecutive model tool-calls fold into one
 *  assistant turn and consecutive agent tool-results into one user turn. */
export function chatToNormalized(chat: ChatMessage[]): NormalizedMessage[] {
  const out: NormalizedMessage[] = [];
  let i = 0;
  while (i < chat.length) {
    const m = chat[i];
    if (m.kind === "system") {
      // System instruction is sent via the provider's `system` field, not
      // as a message in the messages array.
      i++;
    } else if (m.sender === "user" && m.kind === "text") {
      out.push({ role: "user", content: m.text });
      i++;
    } else if (m.sender === "model" && m.kind === "text") {
      out.push({ role: "assistant", content: m.text });
      i++;
    } else if (m.sender === "model" && m.kind === "tool_call") {
      const calls: NormalizedToolUse[] = [];
      while (
        i < chat.length &&
        chat[i].sender === "model" &&
        chat[i].kind === "tool_call"
      ) {
        const t = chat[i] as Extract<ChatMessage, { kind: "tool_call" }>;
        const tu: NormalizedToolUse = {
          type: "tool_use",
          id: t.toolUseId,
          name: t.name,
          input: t.input,
        };
        if (t._geminiThoughtSignature)
          tu._geminiThoughtSignature = t._geminiThoughtSignature;
        calls.push(tu);
        i++;
      }
      out.push({ role: "assistant", content: calls });
    } else if (m.sender === "agent" && m.kind === "tool_result") {
      const results: NormalizedToolResult[] = [];
      while (
        i < chat.length &&
        chat[i].sender === "agent" &&
        chat[i].kind === "tool_result"
      ) {
        const r = chat[i] as Extract<ChatMessage, { kind: "tool_result" }>;
        results.push({
          type: "tool_result",
          tool_use_id: r.toolUseId,
          content: r.output,
        });
        i++;
      }
      out.push({ role: "user", content: results });
    } else {
      i++;
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Agent loop
// ---------------------------------------------------------------------------

/** Called before every tool execution. Return "allow" to run the tool,
 *  "deny" to skip it (the model is told the user refused). */
export type PermissionCheck = (
  name: string,
  input: Record<string, unknown>
) => Promise<"allow" | "deny">;

const MAX_ITERATIONS = 10;

/** Run the agent loop. Mutates `chat` in place — every model and agent
 *  message produced this turn is appended and live-printed. The system
 *  prompt is read from the first `agent.system` entry in `chat`. */
export async function runAgent(
  chat: ChatMessage[],
  provider: LLMProvider,
  permissionCheck: PermissionCheck,
  sessionUsage?: SessionUsage
): Promise<void> {
  const systemPrompt =
    chat.find(
      (m): m is Extract<ChatMessage, { kind: "system" }> => m.kind === "system"
    )?.text ?? "";
  const apiTools = toAPITools(tools);
  const spinner = new Spinner();

  for (let i = 0; i < MAX_ITERATIONS; i++) {
    if (!isVerbose()) spinner.start("thinking");
    let response;
    try {
      response = await provider.complete(
        systemPrompt,
        chatToNormalized(chat),
        apiTools
      );
    } finally {
      spinner.stop();
    }

    if (sessionUsage) {
      sessionUsage.inputTokens += response.usage.inputTokens;
      sessionUsage.outputTokens += response.usage.outputTokens;
      sessionUsage.cacheCreationTokens += response.usage.cacheCreationTokens;
      sessionUsage.cacheReadTokens += response.usage.cacheReadTokens;
      sessionUsage.requests += 1;
    }

    if (response.stopReason === "end_turn") {
      const m: ChatMessage = { sender: "model", kind: "text", text: response.text };
      chat.push(m);
      printChatMessage(m, chat.length);
      return;
    }

    if (response.stopReason === "tool_use") {
      // Sequentially: show the call, ask permission, execute or skip,
      // show the result. (Sequential — not Promise.all — so prompts
      // come one at a time instead of racing.)
      for (const tu of response.toolUses) {
        const callMsg: ChatMessage = {
          sender: "model",
          kind: "tool_call",
          toolUseId: tu.id,
          name: tu.name,
          input: tu.input,
          ...(tu._geminiThoughtSignature
            ? { _geminiThoughtSignature: tu._geminiThoughtSignature }
            : {}),
        };
        chat.push(callMsg);
        printChatMessage(callMsg, chat.length);

        const decision = await permissionCheck(tu.name, tu.input);
        const output =
          decision === "deny"
            ? "[User denied execution of this command.]"
            : await executeTool(tu.name, tu.input);

        const resultMsg: ChatMessage = {
          sender: "agent",
          kind: "tool_result",
          toolUseId: tu.id,
          output,
        };
        chat.push(resultMsg);
        printChatMessage(resultMsg, chat.length);
      }
      continue;
    }

    // stop_reason === "other" (max_tokens, content_filter, etc.)
    console.log(c.yellow(`  [agent stopped: provider stop reason "other"]`));
    return;
  }

  console.log(
    c.yellow(`  [agent stopped: reached max iterations (${MAX_ITERATIONS})]`)
  );
}
