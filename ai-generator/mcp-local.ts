import path from "path";
import fs from "fs";
import { execFile } from "child_process";
import { promisify } from "util";
import { SYSTEM_PROMPT, buildUserPrompt } from "./prompt";
import type { McpResult } from "./mcp-remote";

const execFileAsync = promisify(execFile);

// HEADLINE PATH (local/stdio MCP): the Anthropic API MCP connector can only reach
// REMOTE servers, so for a local/stdio PactFlow MCP we drive the Claude Code agent
// headlessly with `claude -p`. The agent picks up the PactFlow server from the
// project-root .mcp.json and uses its tools to write the contract.
//
// ⚠️ VERIFY: that PactFlow ships a local/stdio MCP server and that .mcp.json names
// it with the correct command/args. If `claude` isn't installed or .mcp.json is
// missing, preflight returns false and the orchestrator falls back to the SDK path.

const PROJECT_ROOT = path.resolve(__dirname, "..");
const MCP_JSON = path.join(PROJECT_ROOT, ".mcp.json");

export function localConfigured(): boolean {
  if (process.env.PACTFLOW_MCP_COMMAND) return true;
  if (!fs.existsSync(MCP_JSON)) return false;
  // The shipped .mcp.json is a placeholder; don't activate the local path until a
  // real PactFlow MCP server command has been filled in.
  return !fs.readFileSync(MCP_JSON, "utf8").includes("REPLACE-ME");
}

export async function preflightLocal(): Promise<boolean> {
  if (!fs.existsSync(MCP_JSON)) return false;
  try {
    await execFileAsync("claude", ["--version"]);
    return true;
  } catch {
    return false; // claude CLI not installed / not on PATH
  }
}

export async function generateWithLocalMcp(
  openApiJson: string,
  petsClientSource: string,
): Promise<McpResult> {
  const prompt = `${SYSTEM_PROMPT}\n\n${buildUserPrompt(openApiJson, petsClientSource)}`;

  // Run from project root so Claude Code loads .mcp.json and the PactFlow MCP server.
  const { stdout } = await execFileAsync(
    "claude",
    ["-p", prompt],
    { cwd: PROJECT_ROOT, maxBuffer: 10 * 1024 * 1024 },
  );

  if (!stdout.trim()) throw new Error("local MCP (claude -p) returned no output");
  // `claude -p` plain mode doesn't surface a structured tool list; the agent's MCP
  // tool use is visible in its own transcript. Report the channel rather than guess names.
  return { source: stdout, tools: ["pactflow (via claude -p / .mcp.json)"] };
}
