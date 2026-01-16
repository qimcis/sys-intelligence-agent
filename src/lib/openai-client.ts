export interface OpenAIMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface OpenAIResponse {
  choices: Array<{
    message: {
      content: string | null;
    };
  }>;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
    completion_tokens_details?: {
      reasoning_tokens: number;
    };
  };
}

export const MODELS = {
  generator: "gpt-5-nano-2025-08-07",
  judge: "gpt-5-mini-2025-08-07",
} as const;

export async function callOpenAI(
  messages: OpenAIMessage[],
  apiKey: string,
  model: string = MODELS.generator,
): Promise<string> {
  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages,
      max_completion_tokens: 128000,
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`OpenAI API error: ${response.status} - ${error}`);
  }

  const data = (await response.json()) as OpenAIResponse;
  const content = data.choices[0]?.message?.content;

  // GPT-5 models may return null content with reasoning tokens
  if (content === null || content === undefined) {
    const usage = data.usage;
    throw new Error(
      `OpenAI returned empty content. Usage: ${JSON.stringify(usage)}. ` +
        `This may indicate the model spent all tokens on reasoning. ` +
        `Try increasing max_completion_tokens or simplifying the prompt.`,
    );
  }

  return content;
}
