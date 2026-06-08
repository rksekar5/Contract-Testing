import Anthropic from "@anthropic-ai/sdk";
import { SYSTEM_PROMPT, buildUserPrompt } from "./prompt";

// HEADLINE PATH (remote MCP): Claude Opus connected to a hosted PactFlow MCP
// server via the Anthropic Messages API MCP connector.
//
// ⚠️ VERIFY BEFORE RELYING ON THIS:
//   - The exact MCP-connector shape (beta header + `mcp_servers` field) — see
//     https://platform.claude.com/docs/en/agents-and-tools/mcp-connector
//   - That PactFlow actually ships a REMOTE (URL) MCP server, and its real tool names.
// The request is built loosely (`as any`) so SDK type drift doesn't block tsx at
// runtime; any failure here is caught upstream and falls back to the SDK path.

export interface McpResult {
  source: string;
  tools: string[];
}

export function remoteConfigured(): boolean {
  return !!process.env.PACTFLOW_MCP_URL && /^https?:\/\//i.test(process.env.PACTFLOW_MCP_URL);
}

/** Cheap reachability + auth check before spending a generation call. */
export async function preflightRemote(): Promise<boolean> {
  const url = process.env.PACTFLOW_MCP_URL;
  if (!url) return false;
  try {
    const headers: Record<string, string> = {};
    if (process.env.PACTFLOW_MCP_TOKEN) {
      headers.Authorization = `Bearer ${process.env.PACTFLOW_MCP_TOKEN}`;
    }
    // Any HTTP response means the server is there; only network errors fail preflight.
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 4000);
    await fetch(url, { method: "GET", headers, signal: ctrl.signal });
    clearTimeout(timer);
    return true;
  } catch {
    return false;
  }
}

export async function generateWithRemoteMcp(
  openApiJson: string,
  petsClientSource: string,
): Promise<McpResult> {
  if (!process.env.ANTHROPIC_API_KEY) throw new Error("ANTHROPIC_API_KEY is not set");
  const url = process.env.PACTFLOW_MCP_URL;
  if (!url) throw new Error("PACTFLOW_MCP_URL is not set");

  const client = new Anthropic();

  const mcpServer: Record<string, unknown> = { type: "url", url, name: "pactflow" };
  if (process.env.PACTFLOW_MCP_TOKEN) mcpServer.authorization_token = process.env.PACTFLOW_MCP_TOKEN;

  const params = {
    model: "claude-opus-4-8",
    max_tokens: 16000,
    thinking: { type: "adaptive" },
    system: SYSTEM_PROMPT,
    messages: [{ role: "user", content: buildUserPrompt(openApiJson, petsClientSource) }],
    mcp_servers: [mcpServer],
    betas: ["mcp-client-2025-04-04"],
  };

  // Cast away types: the MCP-connector fields may not be in the installed SDK's types.
  const message = await (client as any).beta.messages.create(params as any);

  const blocks: any[] = message.content ?? [];
  const source = blocks
    .filter((b) => b.type === "text")
    .map((b) => b.text)
    .join("");
  const tools = blocks
    .filter((b) => b.type === "mcp_tool_use" || b.type === "tool_use")
    .map((b) => b.name as string);

  if (!source.trim()) throw new Error("remote MCP generation returned no text content");
  return { source, tools };
}
