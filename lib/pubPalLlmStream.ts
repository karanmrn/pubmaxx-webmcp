// OpenAI Chat Completions SSE helpers for ElevenLabs Custom LLM integration.

export type OpenAiChatMessage = {
  role: string;
  content?: string | Array<{ type?: string; text?: string }> | null;
};

export type OpenAiChatCompletionRequest = {
  messages?: OpenAiChatMessage[];
  model?: string;
  stream?: boolean;
  user_id?: string;
  cityId?: unknown;
};

function messageText(content: OpenAiChatMessage["content"]): string {
  if (typeof content === "string") return content.trim();
  if (!Array.isArray(content)) return "";
  return content
    .map((part) => (typeof part?.text === "string" ? part.text : ""))
    .join(" ")
    .trim();
}

export function extractLastUserMessage(messages: OpenAiChatMessage[] | undefined): string {
  if (!messages?.length) return "";
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message?.role !== "user") continue;
    const text = messageText(message.content);
    if (text) return text.slice(0, 500);
  }
  return "";
}

export function extractAskTurns(messages: OpenAiChatMessage[] | undefined): Array<{
  role: "user" | "assistant";
  content: string;
}> {
  if (!messages?.length) return [];
  const turns: Array<{ role: "user" | "assistant"; content: string }> = [];
  for (const message of messages.slice(0, -1)) {
    if (message.role !== "user" && message.role !== "assistant") continue;
    const content = messageText(message.content);
    if (!content) continue;
    turns.push({ role: message.role, content: content.slice(0, 800) });
    if (turns.length >= 6) break;
  }
  return turns;
}

function chatCompletionChunk(input: {
  id: string;
  model: string;
  created: number;
  delta: Record<string, string>;
  finishReason: string | null;
}): string {
  return `data: ${JSON.stringify({
    id: input.id,
    object: "chat.completion.chunk",
    created: input.created,
    model: input.model,
    choices: [
      {
        index: 0,
        delta: input.delta,
        finish_reason: input.finishReason,
      },
    ],
  })}\n\n`;
}

/** Stream one grounded answer as OpenAI-compatible SSE chunks. */
export function streamOpenAiChatCompletion(
  answer: string,
  model = "pubmax-ask-grounded",
): Response {
  const id = `chatcmpl-pubpal-${Date.now()}`;
  const created = Math.floor(Date.now() / 1000);
  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(
        encoder.encode(
          chatCompletionChunk({
            id,
            model,
            created,
            delta: { role: "assistant" },
            finishReason: null,
          }),
        ),
      );
      if (answer) {
        controller.enqueue(
          encoder.encode(
            chatCompletionChunk({
              id,
              model,
              created,
              delta: { content: answer },
              finishReason: null,
            }),
          ),
        );
      }
      controller.enqueue(
        encoder.encode(
          chatCompletionChunk({
            id,
            model,
            created,
            delta: {},
            finishReason: "stop",
          }),
        ),
      );
      controller.enqueue(encoder.encode("data: [DONE]\n\n"));
      controller.close();
    },
  });

  return new Response(stream, {
    status: 200,
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-store",
      Connection: "keep-alive",
    },
  });
}
