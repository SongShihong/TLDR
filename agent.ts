import type { LLMProvider, NormalizedMessage, NormalizedToolUse, Usage } from "./providers.ts";
import { isVerbose } from "./providers.ts";
import { tools, toAPITools, executeTool } from "./tools.ts";
import { c, icon, Spinner } from "./ui.ts";

export type { NormalizedMessage };

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

const MAX_ITERATIONS = 10;

export async function runAgent(
  userMessage: string,
  history: NormalizedMessage[],
  provider: LLMProvider,
  systemPrompt: string,
  sessionUsage?: SessionUsage
): Promise<string> {
  const messages: NormalizedMessage[] = [
    ...history,
    { role: "user", content: userMessage },
  ];

  const apiTools = toAPITools(tools);
  const spinner = new Spinner();

  for (let i = 0; i < MAX_ITERATIONS; i++) {
    // Skip the animation while verbose JSON logging is on — it would clash
    // with the raw payload dumps the providers print.
    if (!isVerbose()) spinner.start("thinking");
    let response;
    try {
      response = await provider.complete(systemPrompt, messages, apiTools);
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
      messages.push({ role: "assistant", content: response.text });
      return response.text;
    }

    if (response.stopReason === "tool_use") {
      // Append the assistant turn (tool calls)
      messages.push({
        role: "assistant",
        content: response.toolUses as NormalizedToolUse[],
      });

      // Execute all tool calls and collect results
      const toolResults = await Promise.all(
        response.toolUses.map(async (tu) => {
          const preview = JSON.stringify(tu.input).slice(0, 72);
          process.stdout.write(
            `  ${c.mint(icon.tool)} ${c.bold(tu.name)} ${c.dim(preview)}\n`
          );
          const output = await executeTool(tu.name, tu.input);
          return {
            type: "tool_result" as const,
            tool_use_id: tu.id,
            content: output,
          };
        })
      );

      // Append tool results as a user turn
      messages.push({ role: "user", content: toolResults });
      // Loop back to call the LLM again with the results in context
      continue;
    }

    // stop_reason === "other" (max_tokens, content_filter, etc.)
    break;
  }

  return "[Agent stopped: reached max iterations or unexpected stop reason]";
}
