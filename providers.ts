import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";
import { GoogleGenerativeAI, type Content } from "@google/generative-ai";
import type { APIToolDef } from "./tools.ts";
import { c, icon, formatJson } from "./ui.ts";

// ---------------------------------------------------------------------------
// Normalized types (provider-agnostic)
// ---------------------------------------------------------------------------

export type NormalizedToolUse = {
  type: "tool_use";
  id: string;
  name: string;
  input: Record<string, unknown>;
  /** Gemini thinking models attach a thought signature to function calls.
   *  It must be echoed back verbatim when replaying this turn in history. */
  _geminiThoughtSignature?: string;
};

export type NormalizedToolResult = {
  type: "tool_result";
  tool_use_id: string;
  content: string;
};

export type NormalizedMessage =
  | { role: "user"; content: string | NormalizedToolResult[] }
  | { role: "assistant"; content: string | NormalizedToolUse[] };

export type Usage = {
  inputTokens: number;
  outputTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
};

export type LLMResponse = {
  stopReason: "end_turn" | "tool_use" | "other";
  text: string;
  toolUses: NormalizedToolUse[];
  usage: Usage;
};

export interface LLMProvider {
  complete(
    systemPrompt: string,
    messages: NormalizedMessage[],
    tools: APIToolDef[]
  ): Promise<LLMResponse>;
}

// ---------------------------------------------------------------------------
// Verbose (raw JSON) logging toggle — controlled by the /verbose slash command
// ---------------------------------------------------------------------------

let verbose = false;
export function setVerbose(v: boolean): void {
  verbose = v;
}
export function isVerbose(): boolean {
  return verbose;
}
function logVerbose(label: string, payload: unknown): void {
  if (!verbose) return;
  console.log();
  console.log(`${c.orange(icon.dot)} ${c.bold(label)}`);
  console.log(formatJson(payload));
  console.log();
}

// ---------------------------------------------------------------------------
// AnthropicProvider
// ---------------------------------------------------------------------------

export class AnthropicProvider implements LLMProvider {
  private client: Anthropic;
  constructor(
    apiKey: string,
    private model: string
  ) {
    this.client = new Anthropic({ apiKey });
  }

  async complete(
    systemPrompt: string,
    messages: NormalizedMessage[],
    tools: APIToolDef[]
  ): Promise<LLMResponse> {
    const sdkMessages: Anthropic.MessageParam[] = messages.map((m) => {
      if (m.role === "user") {
        if (typeof m.content === "string") {
          return { role: "user", content: m.content };
        }
        // tool results
        return {
          role: "user",
          content: m.content.map((r) => ({
            type: "tool_result" as const,
            tool_use_id: r.tool_use_id,
            content: r.content,
          })),
        };
      }
      // assistant
      if (typeof m.content === "string") {
        return { role: "assistant", content: m.content };
      }
      return {
        role: "assistant",
        content: m.content.map((tu) => ({
          type: "tool_use" as const,
          id: tu.id,
          name: tu.name,
          input: tu.input,
        })),
      };
    });

    const sdkTools: Anthropic.Tool[] = tools.map((t) => ({
      name: t.name,
      description: t.description,
      input_schema: t.input_schema as Anthropic.Tool["input_schema"],
    }));

    const request = {
      model: this.model,
      max_tokens: 4096,
      system: [
        {
          type: "text" as const,
          text: systemPrompt,
          // Prompt caching: system prompt is constant per conversation, cache it
          cache_control: { type: "ephemeral" as const },
        },
      ],
      tools: sdkTools,
      messages: sdkMessages,
    };
    logVerbose("REQUEST (anthropic)", request);

    const response = await this.client.messages.create(request);
    logVerbose("RESPONSE (anthropic)", response);

    const text = response.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("\n");

    const toolUses: NormalizedToolUse[] = response.content
      .filter((b): b is Anthropic.ToolUseBlock => b.type === "tool_use")
      .map((b) => ({
        type: "tool_use",
        id: b.id,
        name: b.name,
        input: b.input as Record<string, unknown>,
      }));

    const stopReason =
      response.stop_reason === "tool_use"
        ? "tool_use"
        : response.stop_reason === "end_turn"
          ? "end_turn"
          : "other";

    const usage: Usage = {
      inputTokens: response.usage?.input_tokens ?? 0,
      outputTokens: response.usage?.output_tokens ?? 0,
      cacheCreationTokens: response.usage?.cache_creation_input_tokens ?? 0,
      cacheReadTokens: response.usage?.cache_read_input_tokens ?? 0,
    };

    return { stopReason, text, toolUses, usage };
  }
}

// ---------------------------------------------------------------------------
// OpenAIProvider  (also works for any OpenAI-compatible endpoint)
// ---------------------------------------------------------------------------

export class OpenAIProvider implements LLMProvider {
  private client: OpenAI;
  constructor(
    apiKey: string,
    private model: string,
    baseURL?: string
  ) {
    this.client = new OpenAI({ apiKey, ...(baseURL ? { baseURL } : {}) });
  }

  async complete(
    systemPrompt: string,
    messages: NormalizedMessage[],
    tools: APIToolDef[]
  ): Promise<LLMResponse> {
    const sdkMessages: OpenAI.ChatCompletionMessageParam[] = [
      { role: "system", content: systemPrompt },
      ...messages.flatMap((m): OpenAI.ChatCompletionMessageParam[] => {
        if (m.role === "user") {
          if (typeof m.content === "string") {
            return [{ role: "user", content: m.content }];
          }
          // tool results — one message per result
          return m.content.map((r) => ({
            role: "tool" as const,
            tool_call_id: r.tool_use_id,
            content: r.content,
          }));
        }
        // assistant
        if (typeof m.content === "string") {
          return [{ role: "assistant", content: m.content }];
        }
        return [
          {
            role: "assistant",
            content: null,
            tool_calls: m.content.map((tu) => ({
              id: tu.id,
              type: "function" as const,
              function: {
                name: tu.name,
                arguments: JSON.stringify(tu.input),
              },
            })),
          },
        ];
      }),
    ];

    const sdkTools: OpenAI.ChatCompletionTool[] = tools.map((t) => ({
      type: "function",
      function: {
        name: t.name,
        description: t.description,
        parameters: t.input_schema as OpenAI.FunctionParameters,
      },
    }));

    const request = {
      model: this.model,
      max_tokens: 4096,
      tools: sdkTools,
      messages: sdkMessages,
    };
    logVerbose("REQUEST (openai)", request);

    const response = await this.client.chat.completions.create(request);
    logVerbose("RESPONSE (openai)", response);

    const choice = response.choices[0];
    const text = choice.message.content ?? "";
    const toolCalls = choice.message.tool_calls ?? [];

    const toolUses: NormalizedToolUse[] = toolCalls.map((tc) => ({
      type: "tool_use",
      id: tc.id,
      name: tc.function.name,
      input: JSON.parse(tc.function.arguments) as Record<string, unknown>,
    }));

    const stopReason =
      choice.finish_reason === "tool_calls"
        ? "tool_use"
        : choice.finish_reason === "stop"
          ? "end_turn"
          : "other";

    const usage: Usage = {
      inputTokens: response.usage?.prompt_tokens ?? 0,
      outputTokens: response.usage?.completion_tokens ?? 0,
      cacheCreationTokens: 0,
      cacheReadTokens:
        (response.usage as { prompt_tokens_details?: { cached_tokens?: number } } | undefined)
          ?.prompt_tokens_details?.cached_tokens ?? 0,
    };

    return { stopReason, text, toolUses, usage };
  }
}

// ---------------------------------------------------------------------------
// GeminiProvider
// ---------------------------------------------------------------------------

export class GeminiProvider implements LLMProvider {
  private genAI: GoogleGenerativeAI;
  constructor(
    apiKey: string,
    private model: string
  ) {
    this.genAI = new GoogleGenerativeAI(apiKey);
  }

  async complete(
    systemPrompt: string,
    messages: NormalizedMessage[],
    tools: APIToolDef[]
  ): Promise<LLMResponse> {
    const functionDeclarations = tools.map((t) => ({
      name: t.name,
      description: t.description,
      parameters: t.input_schema,
    }));

    // Use generateContent (not startChat/sendMessage) so we control the full
    // contents array. The chat SDK's sendMessage() rejects functionResponse parts
    // in user turns — generateContent sends them through without issue.
    const genModel = this.genAI.getGenerativeModel({
      model: this.model,
      systemInstruction: systemPrompt,
      tools: [{ functionDeclarations }],
    });

    // Build a lookup from synthesized tool-use id → actual function name.
    // functionResponse.name must be the real function name, not our id.
    const toolUseIdToName = new Map<string, string>();
    for (const m of messages) {
      if (m.role === "assistant" && Array.isArray(m.content)) {
        for (const tu of m.content as NormalizedToolUse[]) {
          if (tu.type === "tool_use") toolUseIdToName.set(tu.id, tu.name);
        }
      }
    }

    // Convert the full NormalizedMessage history to Gemini Content[].
    const contents: Content[] = messages.map((m) => {
      if (m.role === "user") {
        if (typeof m.content === "string") {
          return { role: "user", parts: [{ text: m.content }] };
        }
        // tool results
        return {
          role: "user",
          parts: m.content.map((r) => ({
            functionResponse: {
              name: toolUseIdToName.get(r.tool_use_id) ?? r.tool_use_id,
              response: { output: r.content },
            },
          })),
        };
      }
      // assistant / model
      if (typeof m.content === "string") {
        return { role: "model", parts: [{ text: m.content }] };
      }
      // tool calls — include thoughtSignature for thinking models
      return {
        role: "model",
        parts: m.content.map((tu) => {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const part: any = { functionCall: { name: tu.name, args: tu.input } };
          if (tu._geminiThoughtSignature) {
            part.thoughtSignature = tu._geminiThoughtSignature;
          }
          return part;
        }),
      };
    });

    const request = { contents };
    logVerbose("REQUEST (gemini)", {
      model: this.model,
      systemInstruction: systemPrompt,
      functionDeclarations,
      ...request,
    });

    const result = await genModel.generateContent(request);
    logVerbose("RESPONSE (gemini)", result.response);

    const candidate = result.response.candidates?.[0];

    const meta = result.response.usageMetadata;
    const usage: Usage = {
      inputTokens: meta?.promptTokenCount ?? 0,
      outputTokens: meta?.candidatesTokenCount ?? 0,
      cacheCreationTokens: 0,
      cacheReadTokens:
        (meta as { cachedContentTokenCount?: number } | undefined)?.cachedContentTokenCount ?? 0,
    };

    if (!candidate) {
      return { stopReason: "other", text: "", toolUses: [], usage };
    }

    const parts = candidate.content.parts ?? [];

    const text = parts
      .filter((p): p is { text: string } => "text" in p && typeof p.text === "string")
      .map((p) => p.text)
      .join("\n");

    const toolUses: NormalizedToolUse[] = parts
      .filter(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (p): p is any => "functionCall" in p
      )
      .map((p, i) => ({
        type: "tool_use" as const,
        id: `${p.functionCall.name}_${i}`,
        name: p.functionCall.name,
        input: p.functionCall.args ?? {},
        // Preserve thoughtSignature — required for thinking models when this turn
        // is later replayed in history (Gemini rejects requests that omit it).
        _geminiThoughtSignature: (p.thoughtSignature ?? p.thought_signature) as
          | string
          | undefined,
      }));

    const finishReason = candidate.finishReason;
    const stopReason =
      toolUses.length > 0
        ? "tool_use"
        : finishReason === "STOP"
          ? "end_turn"
          : "other";

    return { stopReason, text, toolUses, usage };
  }
}

// ---------------------------------------------------------------------------
// Model listing — preset-aware
// ---------------------------------------------------------------------------

import type { ProviderPreset } from "./presets.ts";

/** Returns a sorted list of model IDs available for the given preset + key. */
export async function listModels(
  preset: ProviderPreset,
  apiKey: string,
  baseURL?: string
): Promise<string[]> {
  if (preset.flavor === "anthropic") {
    const client = new Anthropic({ apiKey });
    const page = await client.models.list({ limit: 100 });
    return page.data.map((m) => m.id);
  }

  if (preset.flavor === "gemini") {
    // The @google/generative-ai SDK does not expose listModels, use REST directly
    const url = `https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}&pageSize=100`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Gemini models API returned ${res.status}`);
    const data = (await res.json()) as {
      models: Array<{ name: string; supportedGenerationMethods?: string[] }>;
    };
    return (data.models ?? [])
      .filter((m) => m.supportedGenerationMethods?.includes("generateContent"))
      .map((m) => m.name.replace(/^models\//, ""))
      .sort();
  }

  // openai / openai-compatible: use GET /models via the OpenAI SDK
  const effectiveBase = baseURL ?? preset.baseURL;
  const client = new OpenAI({ apiKey, ...(effectiveBase ? { baseURL: effectiveBase } : {}) });
  const page = await client.models.list();

  // For the canonical OpenAI endpoint, filter noise (embeddings, tts, whisper…).
  // For everyone else, return whatever the endpoint advertises.
  if (preset.id === "openai") {
    const CHAT_PREFIXES = ["gpt-", "o1", "o3", "o4", "chatgpt-"];
    return page.data
      .filter((m) => CHAT_PREFIXES.some((p) => m.id.startsWith(p)))
      .sort((a, b) => b.created - a.created)
      .map((m) => m.id);
  }
  return page.data.map((m) => m.id).sort();
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export function createProvider(
  preset: ProviderPreset,
  apiKey: string,
  model: string,
  baseURLOverride?: string
): LLMProvider {
  if (preset.flavor === "anthropic") return new AnthropicProvider(apiKey, model);
  if (preset.flavor === "gemini") return new GeminiProvider(apiKey, model);

  const url = baseURLOverride ?? preset.baseURL;
  if (preset.flavor === "openai-compatible" && !url) {
    throw new Error(
      `Preset "${preset.id}" is OpenAI-compatible but no base URL was provided.`
    );
  }
  return new OpenAIProvider(apiKey, model, url);
}
