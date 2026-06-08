import path from "path";
import fs from "fs";
import { performance } from "perf_hooks";
import * as dotenv from "dotenv";
import { OUTPUT_RELATIVE_PATH } from "./prompt";
import { generateWithSdk } from "./sdk";
import {
  McpResult,
  remoteConfigured,
  preflightRemote,
  generateWithRemoteMcp,
} from "./mcp-remote";
import { localConfigured, preflightLocal, generateWithLocalMcp } from "./mcp-local";

dotenv.config();

const PROJECT_ROOT = path.resolve(__dirname, "..");
const OPENAPI_PATH = path.join(PROJECT_ROOT, "provider", "openapi.json");
const CLIENT_PATH = path.join(PROJECT_ROOT, "consumer", "src", "pets-client.ts");
const CACHED_PATH = path.join(PROJECT_ROOT, "consumer", "cached", "pets.consumer.pact.test.ts");
const OUTPUT_PATH = path.join(PROJECT_ROOT, OUTPUT_RELATIVE_PATH);

type Mode = "cached" | "sdk" | "mcp-remote" | "mcp-local";

const args = process.argv.slice(2);
const wantCached = args.includes("--cached");
const wantSdk = args.includes("--sdk");

function readCached(): string {
  return fs.readFileSync(CACHED_PATH, "utf8");
}

function stripFences(s: string): string {
  return s
    .replace(/^\s*```(?:typescript|ts)?\s*\n/i, "")
    .replace(/\n```\s*$/i, "")
    .trim() + "\n";
}

function countScenarios(src: string): number {
  const interactions = src.match(/uponReceiving\s*\(/g);
  if (interactions) return interactions.length;
  const its = src.match(/\bit\s*\(/g);
  return its ? its.length : 0;
}

async function produce(
  openApiJson: string,
  clientSource: string,
): Promise<{ mode: Mode; result: McpResult }> {
  // 1) Explicit cached / sdk requests.
  if (wantCached) {
    return { mode: "cached", result: { source: readCached(), tools: [] } };
  }
  if (wantSdk) {
    if (process.env.ANTHROPIC_API_KEY) {
      return { mode: "sdk", result: { source: await generateWithSdk(openApiJson, clientSource), tools: [] } };
    }
    console.warn("⚠️  --sdk requested but ANTHROPIC_API_KEY is not set — using cached test.");
    return { mode: "cached", result: { source: readCached(), tools: [] } };
  }

  // 2) Default = PactFlow MCP headline path (remote, else local).
  if (remoteConfigured()) {
    if (await preflightRemote()) {
      try {
        console.log("→ Generating via Claude Opus + PactFlow MCP (remote connector)…");
        return { mode: "mcp-remote", result: await generateWithRemoteMcp(openApiJson, clientSource) };
      } catch (e) {
        console.warn(`⚠️  Remote MCP generation failed (${msg(e)}) — falling back to SDK.`);
      }
    } else {
      console.warn("⚠️  PactFlow MCP (remote) is configured but unreachable — falling back to SDK.");
    }
  } else if (localConfigured()) {
    if (await preflightLocal()) {
      try {
        console.log("→ Generating via Claude Code agent + PactFlow MCP (local, .mcp.json)…");
        return { mode: "mcp-local", result: await generateWithLocalMcp(openApiJson, clientSource) };
      } catch (e) {
        console.warn(`⚠️  Local MCP generation failed (${msg(e)}) — falling back to SDK.`);
      }
    } else {
      console.warn("⚠️  Local PactFlow MCP configured but `claude` CLI or .mcp.json is missing — falling back to SDK.");
    }
  } else {
    console.log("ℹ️  No PactFlow MCP server configured (set PACTFLOW_MCP_URL or PACTFLOW_MCP_COMMAND).");
  }

  // 3) Silent SDK fallback.
  if (process.env.ANTHROPIC_API_KEY) {
    try {
      console.log("→ Generating via Anthropic SDK (no MCP)…");
      return { mode: "sdk", result: { source: await generateWithSdk(openApiJson, clientSource), tools: [] } };
    } catch (e) {
      console.warn(`⚠️  SDK generation failed (${msg(e)}) — using cached test.`);
    }
  } else {
    console.log("ℹ️  ANTHROPIC_API_KEY not set — using the cached known-good test.");
  }

  // 4) Final fallback that always works offline.
  return { mode: "cached", result: { source: readCached(), tools: [] } };
}

function msg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

async function main(): Promise<void> {
  const openApiJson = fs.readFileSync(OPENAPI_PATH, "utf8");
  const clientSource = fs.readFileSync(CLIENT_PATH, "utf8");

  const t0 = performance.now();
  const { mode, result } = await produce(openApiJson, clientSource);
  const seconds = ((performance.now() - t0) / 1000).toFixed(1);

  const source = mode === "cached" ? result.source : stripFences(result.source);
  fs.mkdirSync(path.dirname(OUTPUT_PATH), { recursive: true });
  fs.writeFileSync(OUTPUT_PATH, source, "utf8");

  const lines = source.split("\n").length;
  const scenarios = countScenarios(source);

  console.log("");
  console.log(`✅ Generated ${lines} lines / ${scenarios} scenarios in ${seconds}s via ${mode}`);
  if (result.tools.length > 0) {
    console.log(`   PactFlow MCP tools invoked: ${result.tools.join(", ")}`);
  }
  console.log(`   Wrote ${OUTPUT_RELATIVE_PATH}`);
  if (mode === "cached") {
    console.log("   (cached known-good test — set up PactFlow MCP or ANTHROPIC_API_KEY for live generation)");
  }
}

main().catch((e) => {
  console.error(`generation failed: ${msg(e)}`);
  process.exit(1);
});
