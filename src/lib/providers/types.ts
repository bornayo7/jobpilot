export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface ChatRequest {
  model: string;
  messages: ChatMessage[];
  maxTokens?: number;
  temperature?: number;
  /** When set, the provider constrains output to this JSON schema and the
   *  returned text is the raw JSON string. */
  jsonSchema?: object;
}

export interface ChatOptions {
  onToken?: (token: string) => void;
  signal?: AbortSignal;
}

export interface ChatResponse {
  text: string;
  usage?: { inputTokens?: number; outputTokens?: number };
}

export type ProviderId = 'anthropic' | 'openai' | 'openrouter' | 'ollama' | 'lmstudio' | 'chrome-ai';

export interface ProviderHealth {
  ok: boolean;
  /** Actionable setup hint shown in the settings UI (e.g. OLLAMA_ORIGINS fix). */
  hint?: string;
}

export interface ChatProvider {
  id: ProviderId;
  chat(req: ChatRequest, opts?: ChatOptions): Promise<ChatResponse>;
  listModels?(): Promise<{ id: string; label: string }[]>;
  health?(): Promise<ProviderHealth>;
}

export class ProviderError extends Error {
  constructor(
    message: string,
    public readonly status?: number,
  ) {
    super(message);
    this.name = 'ProviderError';
  }
}
