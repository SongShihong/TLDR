// ---------------------------------------------------------------------------
// Provider presets — one entry per LLM backend OpenClaw also supports.
//
// `flavor` drives which SDK class handles the request:
//   - "anthropic" / "gemini"           — native SDKs, no baseURL
//   - "openai"                         — native OpenAI SDK, optional baseURL
//   - "openai-compatible"              — routed through OpenAI SDK, baseURL required
// ---------------------------------------------------------------------------

export type ProviderFlavor = "anthropic" | "openai" | "gemini" | "openai-compatible";

export type ProviderPreset = {
  id: string;
  label: string;
  flavor: ProviderFlavor;
  apiKeyEnv: string;
  /** Static base URL. Omit for bespoke SDKs (anthropic/gemini). */
  baseURL?: string;
  /** Hint used when we can't list models from the endpoint. */
  defaultModel: string;
  /** Endpoint is installation-specific — always ask the user. */
  requiresCustomBaseURL?: boolean;
};

export const PRESETS: ProviderPreset[] = [
  // --- Native SDKs ---
  {
    id: "anthropic",
    label: "Anthropic (Claude)",
    flavor: "anthropic",
    apiKeyEnv: "ANTHROPIC_API_KEY",
    defaultModel: "claude-sonnet-4-6",
  },
  {
    id: "openai",
    label: "OpenAI",
    flavor: "openai",
    apiKeyEnv: "OPENAI_API_KEY",
    defaultModel: "gpt-4o",
  },
  {
    id: "gemini",
    label: "Google Gemini",
    flavor: "gemini",
    apiKeyEnv: "GEMINI_API_KEY",
    defaultModel: "gemini-2.0-flash",
  },

  // --- OpenAI-compatible hosted endpoints ---
  {
    id: "groq",
    label: "Groq",
    flavor: "openai-compatible",
    apiKeyEnv: "GROQ_API_KEY",
    baseURL: "https://api.groq.com/openai/v1",
    defaultModel: "llama-3.3-70b-versatile",
  },
  {
    id: "deepseek",
    label: "DeepSeek",
    flavor: "openai-compatible",
    apiKeyEnv: "DEEPSEEK_API_KEY",
    baseURL: "https://api.deepseek.com/v1",
    defaultModel: "deepseek-chat",
  },
  {
    id: "mistral",
    label: "Mistral",
    flavor: "openai-compatible",
    apiKeyEnv: "MISTRAL_API_KEY",
    baseURL: "https://api.mistral.ai/v1",
    defaultModel: "mistral-large-latest",
  },
  {
    id: "openrouter",
    label: "OpenRouter",
    flavor: "openai-compatible",
    apiKeyEnv: "OPENROUTER_API_KEY",
    baseURL: "https://openrouter.ai/api/v1",
    defaultModel: "openai/gpt-4o",
  },
  {
    id: "xai",
    label: "xAI (Grok)",
    flavor: "openai-compatible",
    apiKeyEnv: "XAI_API_KEY",
    baseURL: "https://api.x.ai/v1",
    defaultModel: "grok-2-latest",
  },
  {
    id: "together",
    label: "Together AI",
    flavor: "openai-compatible",
    apiKeyEnv: "TOGETHER_API_KEY",
    baseURL: "https://api.together.xyz/v1",
    defaultModel: "meta-llama/Llama-3.3-70B-Instruct-Turbo",
  },
  {
    id: "perplexity",
    label: "Perplexity",
    flavor: "openai-compatible",
    apiKeyEnv: "PERPLEXITY_API_KEY",
    baseURL: "https://api.perplexity.ai",
    defaultModel: "sonar",
  },
  {
    id: "moonshot",
    label: "Moonshot (Kimi)",
    flavor: "openai-compatible",
    apiKeyEnv: "MOONSHOT_API_KEY",
    baseURL: "https://api.moonshot.ai/v1",
    defaultModel: "moonshot-v1-8k",
  },
  {
    id: "kimi-coding",
    label: "Kimi Coding",
    flavor: "openai-compatible",
    apiKeyEnv: "KIMI_API_KEY",
    baseURL: "https://api.kimi.com/coding/v1",
    defaultModel: "kimi-latest",
  },
  {
    id: "qwen",
    label: "Qwen / Alibaba DashScope",
    flavor: "openai-compatible",
    apiKeyEnv: "DASHSCOPE_API_KEY",
    baseURL: "https://dashscope-intl.aliyuncs.com/compatible-mode/v1",
    defaultModel: "qwen-max-latest",
  },
  {
    id: "zai",
    label: "Z.AI (GLM)",
    flavor: "openai-compatible",
    apiKeyEnv: "ZAI_API_KEY",
    baseURL: "https://api.z.ai/api/paas/v4",
    defaultModel: "glm-4-plus",
  },
  {
    id: "minimax",
    label: "MiniMax",
    flavor: "openai-compatible",
    apiKeyEnv: "MINIMAX_API_KEY",
    baseURL: "https://api.minimax.io/v1",
    defaultModel: "abab6.5s-chat",
  },
  {
    id: "stepfun",
    label: "StepFun",
    flavor: "openai-compatible",
    apiKeyEnv: "STEPFUN_API_KEY",
    baseURL: "https://api.stepfun.com/v1",
    defaultModel: "step-1-8k",
  },
  {
    id: "fireworks",
    label: "Fireworks AI",
    flavor: "openai-compatible",
    apiKeyEnv: "FIREWORKS_API_KEY",
    baseURL: "https://api.fireworks.ai/inference/v1",
    defaultModel: "accounts/fireworks/models/llama-v3p3-70b-instruct",
  },
  {
    id: "nvidia",
    label: "NVIDIA NIM",
    flavor: "openai-compatible",
    apiKeyEnv: "NVIDIA_API_KEY",
    baseURL: "https://integrate.api.nvidia.com/v1",
    defaultModel: "meta/llama-3.3-70b-instruct",
  },
  {
    id: "volcengine",
    label: "Volcengine (Doubao CN)",
    flavor: "openai-compatible",
    apiKeyEnv: "VOLCANO_ENGINE_API_KEY",
    baseURL: "https://ark.cn-beijing.volces.com/api/v3",
    defaultModel: "doubao-pro-32k",
  },
  {
    id: "byteplus",
    label: "BytePlus (Doubao Intl)",
    flavor: "openai-compatible",
    apiKeyEnv: "BYTEPLUS_API_KEY",
    baseURL: "https://ark.ap-southeast.bytepluses.com/api/v3",
    defaultModel: "doubao-pro-32k",
  },
  {
    id: "qianfan",
    label: "Baidu Qianfan (ERNIE)",
    flavor: "openai-compatible",
    apiKeyEnv: "QIANFAN_API_KEY",
    baseURL: "https://qianfan.baidubce.com/v2",
    defaultModel: "ernie-4.0-8k",
  },
  {
    id: "huggingface",
    label: "Hugging Face Inference",
    flavor: "openai-compatible",
    apiKeyEnv: "HF_TOKEN",
    baseURL: "https://router.huggingface.co/v1",
    defaultModel: "meta-llama/Llama-3.3-70B-Instruct",
  },
  {
    id: "venice",
    label: "Venice AI",
    flavor: "openai-compatible",
    apiKeyEnv: "VENICE_API_KEY",
    baseURL: "https://api.venice.ai/api/v1",
    defaultModel: "llama-3.3-70b",
  },
  {
    id: "xiaomi",
    label: "Xiaomi Mimo",
    flavor: "openai-compatible",
    apiKeyEnv: "XIAOMI_API_KEY",
    baseURL: "https://api.xiaomimimo.com/v1",
    defaultModel: "mimo-latest",
  },
  {
    id: "arcee",
    label: "Arcee AI",
    flavor: "openai-compatible",
    apiKeyEnv: "ARCEEAI_API_KEY",
    baseURL: "https://api.arcee.ai/api/v1",
    defaultModel: "arcee-blitz",
  },
  {
    id: "kilocode",
    label: "Kilo Code",
    flavor: "openai-compatible",
    apiKeyEnv: "KILOCODE_API_KEY",
    baseURL: "https://api.kilo.ai/api/gateway/v1",
    defaultModel: "anthropic/claude-sonnet-4",
  },

  // --- Gateways / proxies ---
  {
    id: "litellm",
    label: "LiteLLM (self-hosted proxy)",
    flavor: "openai-compatible",
    apiKeyEnv: "LITELLM_API_KEY",
    baseURL: "http://localhost:4000/v1",
    defaultModel: "gpt-4o",
  },
  {
    id: "vercel-ai-gateway",
    label: "Vercel AI Gateway",
    flavor: "openai-compatible",
    apiKeyEnv: "AI_GATEWAY_API_KEY",
    baseURL: "https://ai-gateway.vercel.sh/v1",
    defaultModel: "openai/gpt-4o",
  },
  {
    id: "cloudflare-ai-gateway",
    label: "Cloudflare AI Gateway (custom URL)",
    flavor: "openai-compatible",
    apiKeyEnv: "CLOUDFLARE_AI_GATEWAY_API_KEY",
    defaultModel: "gpt-4o",
    requiresCustomBaseURL: true,
  },

  // --- Local / self-hosted ---
  {
    id: "ollama",
    label: "Ollama (local)",
    flavor: "openai-compatible",
    apiKeyEnv: "OLLAMA_API_KEY",
    baseURL: "http://localhost:11434/v1",
    defaultModel: "llama3.2",
  },
  {
    id: "lmstudio",
    label: "LM Studio (local)",
    flavor: "openai-compatible",
    apiKeyEnv: "LM_API_TOKEN",
    baseURL: "http://localhost:1234/v1",
    defaultModel: "local-model",
  },
  {
    id: "vllm",
    label: "vLLM (self-hosted)",
    flavor: "openai-compatible",
    apiKeyEnv: "VLLM_API_KEY",
    baseURL: "http://localhost:8000/v1",
    defaultModel: "local-model",
  },
  {
    id: "sglang",
    label: "SGLang (self-hosted)",
    flavor: "openai-compatible",
    apiKeyEnv: "SGLANG_API_KEY",
    baseURL: "http://localhost:30000/v1",
    defaultModel: "local-model",
  },

  // --- Generic escape hatch ---
  {
    id: "custom",
    label: "Custom OpenAI-compatible endpoint",
    flavor: "openai-compatible",
    apiKeyEnv: "OPENAI_API_KEY",
    defaultModel: "gpt-4o",
    requiresCustomBaseURL: true,
  },
];

export function findPreset(id: string): ProviderPreset | undefined {
  const normalized = id.trim().toLowerCase();
  const aliases: Record<string, string> = {
    google: "gemini",
    claude: "anthropic",
    grok: "xai",
    kimi: "moonshot",
    alibaba: "qwen",
    dashscope: "qwen",
    glm: "zai",
    ernie: "qianfan",
    baidu: "qianfan",
    doubao: "volcengine",
    hf: "huggingface",
  };
  const target = aliases[normalized] ?? normalized;
  return PRESETS.find((p) => p.id === target);
}
