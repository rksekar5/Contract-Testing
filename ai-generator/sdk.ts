import Anthropic from "@anthropic-ai/sdk";
import { SYSTEM_PROMPT, buildUserPrompt } from "./prompt";

// Plain Anthropic SDK generation — the SILENT FALLBACK when PactFlow MCP is not
// configured or unreachable. No MCP tools; just the model and the spec.
//
// Model + params per current Opus guidance:
//   - claude-opus-4-8
//   - adaptive thinking (the only supported mode on 4.8)
//   - NO temperature / top_p / top_k / budget_tokens (they 400 on 4.8)
//   - stream + finalMessage to avoid HTTP timeouts on larger outputs

export async function generateWithSdk(openApiJson: string, petsClientSource: string): Promise<string> {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error("ANTHROPIC_API_KEY is not set");
  }

  const client = new Anthropic();

  const stream = client.messages.stream({
    model: "claude-opus-4-8",
    max_tokens: 16000,
    thinking: { type: "adaptive" },
    system: SYSTEM_PROMPT,
    messages: [{ role: "user", content: buildUserPrompt(openApiJson, petsClientSource) }],
  });

  const message = await stream.finalMessage();

  const text = message.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("");

  if (!text.trim()) {
    throw new Error("model returned no text content");
  }
  return text;
}
