export type AnthropicContentBlock =
  | { type: "text"; text: string }
  | {
      type: "image";
      source: {
        type: "base64";
        media_type: string;
        data: string;
      };
    };

export interface AnthropicMessage {
  role: "system" | "user" | "assistant";
  content: string | AnthropicContentBlock[];
}

interface AnthropicResponse {
  content?: Array<{ type: string; text?: string }>;
  type?: string;
  error?: { type?: string; message?: string };
}

export const MODEL = "claude-opus-4-6" as const;
export const MODELS = {
  generator: MODEL,
  judge: MODEL,
} as const;

export async function callAnthropic(
  messages: AnthropicMessage[],
  apiKey: string,
  _model: string = MODEL,
  options?: { maxTokens?: number },
): Promise<string> {
  const systemParts: string[] = [];
  const chatMessages: Array<{
    role: "user" | "assistant";
    content: string | AnthropicContentBlock[];
  }> = [];

  for (const message of messages) {
    if (message.role === "system") {
      if (typeof message.content === "string") {
        systemParts.push(message.content);
      } else {
        const text = message.content
          .filter((part) => part.type === "text")
          .map((part) => (part.type === "text" ? part.text : ""))
          .join("\n");
        if (text.trim().length > 0) {
          systemParts.push(text);
        }
      }
    } else {
      chatMessages.push({
        role: message.role,
        content: message.content,
      });
    }
  }

  const body: Record<string, unknown> = {
    model: MODEL,
    max_tokens: options?.maxTokens ?? 128000,
    messages: chatMessages,
  };

  if (systemParts.length > 0) {
    body.system = systemParts.join("\n\n");
  }

  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify(body),
  });

  const data = (await response.json()) as AnthropicResponse;

  if (!response.ok || data.type === "error") {
    const errType = data.error?.type || "api_error";
    const errMsg = data.error?.message || JSON.stringify(data);
    throw new Error(`Anthropic API error: ${response.status} - ${errType}: ${errMsg}`);
  }

  const text = (data.content || [])
    .filter((part) => part.type === "text")
    .map((part) => part.text || "")
    .join("");

  if (!text) {
    throw new Error("Anthropic returned empty content");
  }

  return text;
}
