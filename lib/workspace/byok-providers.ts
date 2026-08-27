/**
 * BYOK Provider Registry and Model Definitions for CoderXP Revision 2.3.
 *
 * Implements Directive §10.2 & §10.3:
 * - Multi-provider configuration for Anthropic, OpenAI, Gemini, Mistral,
 *   OpenRouter, Ollama (local + cloud), Grok (xAI), Hugging Face, and Custom.
 * - Validation probes to populate live model optgroups.
 * - Client-only execution for Ollama Local (localhost:11434).
 */

import { validateUrlForFetch } from "./ssrf-guard";

export type ByokProviderId =
  | "anthropic"
  | "openai"
  | "gemini"
  | "mistral"
  | "openrouter"
  | "ollama"
  | "xai"
  | "huggingface"
  | "custom";

export interface ByokModelDescriptor {
  id: string;
  name: string;
  contextWindow?: string;
  description?: string;
}

export interface ByokProviderDefinition {
  id: ByokProviderId;
  name: string;
  defaultBaseUrl: string;
  keyPlaceholder: string;
  keyPrefix?: string;
  helpUrl?: string;
  defaultModels: ByokModelDescriptor[];
  supportsCustomEndpoint?: boolean;
}

export const BYOK_PROVIDER_DEFS: Record<ByokProviderId, ByokProviderDefinition> = {
  anthropic: {
    id: "anthropic",
    name: "Anthropic",
    defaultBaseUrl: "https://api.anthropic.com/v1",
    keyPlaceholder: "sk-ant-...",
    keyPrefix: "sk-ant-",
    helpUrl: "https://console.anthropic.com/settings/keys",
    defaultModels: [
      { id: "claude-3-5-sonnet-latest", name: "Claude 3.5 Sonnet", contextWindow: "200k" },
      { id: "claude-3-5-haiku-latest", name: "Claude 3.5 Haiku", contextWindow: "200k" },
      { id: "claude-3-opus-latest", name: "Claude 3 Opus", contextWindow: "200k" },
    ],
  },
  openai: {
    id: "openai",
    name: "OpenAI",
    defaultBaseUrl: "https://api.openai.com/v1",
    keyPlaceholder: "sk-proj-... / sk-...",
    keyPrefix: "sk-",
    helpUrl: "https://platform.openai.com/api-keys",
    defaultModels: [
      { id: "gpt-4o", name: "GPT-4o", contextWindow: "128k" },
      { id: "gpt-4o-mini", name: "GPT-4o mini", contextWindow: "128k" },
      { id: "o1", name: "o1 Reasoning", contextWindow: "200k" },
      { id: "o3-mini", name: "o3-mini", contextWindow: "200k" },
    ],
  },
  gemini: {
    id: "gemini",
    name: "Google Gemini",
    defaultBaseUrl: "https://generativelanguage.googleapis.com/v1beta",
    keyPlaceholder: "AIza...",
    keyPrefix: "AIza",
    helpUrl: "https://aistudio.google.com/app/apikey",
    defaultModels: [
      { id: "gemini-2.0-flash", name: "Gemini 2.0 Flash", contextWindow: "1M" },
      { id: "gemini-1.5-pro", name: "Gemini 1.5 Pro", contextWindow: "2M" },
      { id: "gemini-1.5-flash", name: "Gemini 1.5 Flash", contextWindow: "1M" },
    ],
  },
  mistral: {
    id: "mistral",
    name: "Mistral AI",
    defaultBaseUrl: "https://api.mistral.ai/v1",
    keyPlaceholder: "sk-...",
    helpUrl: "https://console.mistral.ai/api-keys/",
    defaultModels: [
      { id: "mistral-large-latest", name: "Mistral Large", contextWindow: "128k" },
      { id: "codestral-latest", name: "Codestral", contextWindow: "256k" },
      { id: "mistral-small-latest", name: "Mistral Small", contextWindow: "128k" },
    ],
  },
  openrouter: {
    id: "openrouter",
    name: "OpenRouter",
    defaultBaseUrl: "https://openrouter.ai/api/v1",
    keyPlaceholder: "sk-or-...",
    keyPrefix: "sk-or-",
    helpUrl: "https://openrouter.ai/keys",
    defaultModels: [
      { id: "openrouter/auto", name: "Auto (Best for Prompt)", contextWindow: "128k" },
      { id: "anthropic/claude-3.5-sonnet", name: "Claude 3.5 Sonnet (OpenRouter)", contextWindow: "200k" },
      { id: "openai/gpt-4o", name: "GPT-4o (OpenRouter)", contextWindow: "128k" },
      { id: "deepseek/deepseek-r1", name: "DeepSeek R1 (OpenRouter)", contextWindow: "64k" },
    ],
  },
  ollama: {
    id: "ollama",
    name: "Ollama",
    defaultBaseUrl: "http://localhost:11434",
    keyPlaceholder: "Optional (for cloud/remote endpoints)",
    supportsCustomEndpoint: true,
    defaultModels: [
      { id: "llama3.3", name: "Llama 3.3", contextWindow: "128k" },
      { id: "qwen2.5-coder", name: "Qwen 2.5 Coder", contextWindow: "32k" },
      { id: "deepseek-r1", name: "DeepSeek R1", contextWindow: "64k" },
    ],
  },
  xai: {
    id: "xai",
    name: "Grok (xAI)",
    defaultBaseUrl: "https://api.x.ai/v1",
    keyPlaceholder: "xai-...",
    keyPrefix: "xai-",
    helpUrl: "https://console.x.ai/",
    defaultModels: [
      { id: "grok-2-latest", name: "Grok 2", contextWindow: "128k" },
      { id: "grok-2-vision-latest", name: "Grok 2 Vision", contextWindow: "128k" },
    ],
  },
  huggingface: {
    id: "huggingface",
    name: "Hugging Face",
    defaultBaseUrl: "https://api-inference.huggingface.co/v1",
    keyPlaceholder: "hf_...",
    keyPrefix: "hf_",
    helpUrl: "https://huggingface.co/settings/tokens",
    defaultModels: [
      { id: "deepseek-ai/DeepSeek-R1", name: "DeepSeek R1", contextWindow: "64k" },
      { id: "Qwen/Qwen2.5-Coder-32B-Instruct", name: "Qwen 2.5 Coder 32B", contextWindow: "32k" },
    ],
  },
  custom: {
    id: "custom",
    name: "Custom OpenAI-Compatible",
    defaultBaseUrl: "https://api.custom-ai.com/v1",
    keyPlaceholder: "API key...",
    supportsCustomEndpoint: true,
    defaultModels: [
      { id: "custom-model-1", name: "Custom Default Model", contextWindow: "128k" },
    ],
  },
};

export interface SavedByokConfig {
  providerId: ByokProviderId;
  encryptedKey: string;
  maskedKey: string;
  customName?: string;
  baseUrl?: string;
  mode?: "local" | "cloud";
  customModels?: ByokModelDescriptor[];
  updatedAt: number;
}

/**
 * Validates a provider API key or connection.
 */
export async function validateProviderKey(
  providerId: ByokProviderId,
  apiKey: string,
  options: { baseUrl?: string; mode?: "local" | "cloud" } = {},
): Promise<{ ok: boolean; models?: ByokModelDescriptor[]; error?: string }> {
  const def = BYOK_PROVIDER_DEFS[providerId];
  if (!def) {
    return { ok: false, error: `Unknown provider "${providerId}".` };
  }

  // Ollama Local Rule (§10.4): Browser-side call only.
  if (providerId === "ollama" && options.mode !== "cloud") {
    const localUrl = options.baseUrl || "http://localhost:11434";
    try {
      const res = await fetch(`${localUrl}/api/tags`, { method: "GET" });
      if (!res.ok) {
        return { ok: false, error: `Ollama daemon returned HTTP ${res.status}. Ensure Ollama is running.` };
      }
      const data = await res.json();
      const models = Array.isArray(data.models)
        ? data.models.map((m: any) => ({ id: m.name || m.model, name: m.name || m.model }))
        : def.defaultModels;
      return { ok: true, models: models.length > 0 ? models : def.defaultModels };
    } catch {
      return {
        ok: false,
        error: "Cannot connect to local Ollama on http://localhost:11434. Check that Ollama is running and OLLAMA_ORIGINS is configured.",
      };
    }
  }

  // Validate custom base URL through SSRF guard
  const targetBaseUrl = options.baseUrl || def.defaultBaseUrl;
  if (providerId === "custom" || options.baseUrl) {
    const ssrf = validateUrlForFetch(targetBaseUrl);
    if (!ssrf.valid) {
      return { ok: false, error: `Invalid or forbidden Base URL: ${ssrf.reason}` };
    }
  }

  if (!apiKey || apiKey.trim().length === 0) {
    return { ok: false, error: "API Key is required." };
  }

  // Key prefix validation hint
  if (def.keyPrefix && !apiKey.trim().startsWith(def.keyPrefix)) {
    return {
      ok: false,
      error: `Key should typically start with "${def.keyPrefix}" for ${def.name}.`,
    };
  }

  // Provider-specific probe endpoint
  try {
    let probeUrl = `${targetBaseUrl}/models`;
    const headers: Record<string, string> = {
      Authorization: `Bearer ${apiKey.trim()}`,
    };

    if (providerId === "anthropic") {
      probeUrl = `${targetBaseUrl}/models`;
      headers["x-api-key"] = apiKey.trim();
      headers["anthropic-version"] = "2023-06-01";
      delete headers.Authorization;
    } else if (providerId === "gemini") {
      probeUrl = `${targetBaseUrl}/models?key=${apiKey.trim()}`;
      delete headers.Authorization;
    }

    const res = await fetch(probeUrl, { method: "GET", headers });
    if (res.ok) {
      const data = await res.json().catch(() => ({}));
      let discoveredModels: ByokModelDescriptor[] = [];
      if (Array.isArray(data.data)) {
        discoveredModels = data.data.map((m: any) => ({
          id: m.id || m.name,
          name: m.id || m.name,
        }));
      } else if (Array.isArray(data.models)) {
        discoveredModels = data.models.map((m: any) => ({
          id: m.id || m.name,
          name: (m.name || m.id).replace("models/", ""),
        }));
      }
      return {
        ok: true,
        models: discoveredModels.length > 0 ? discoveredModels : def.defaultModels,
      };
    }

    if (res.status === 401 || res.status === 403) {
      return { ok: false, error: "Invalid API Key. Authentication rejected by provider." };
    }

    // If models endpoint is not supported by endpoint, accept if credentials pass format
    return { ok: true, models: def.defaultModels };
  } catch (err: any) {
    // Network or CORS issue on direct browser probe: fallback to default models if key is non-empty
    return { ok: true, models: def.defaultModels };
  }
}
