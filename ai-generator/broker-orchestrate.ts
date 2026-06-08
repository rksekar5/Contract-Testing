/**
 * Broker operations via SmartBear MCP.
 *
 * Spawns `npx @smartbear/mcp@latest` as a child process and communicates with
 * it using the MCP JSON-RPC protocol over stdio. No extra npm packages needed —
 * only Node.js built-ins are used.
 *
 * Commands:
 *   setup                              create 'production' env, save UUID → .pact-env-id
 *   publish                            publish consumer pacts to the broker
 *   record-deployment <pac> <ver>      record pacticipant version deployed to production
 *   can-i-deploy <pac> <ver>           check if pacticipant@version can deploy to production
 */

import { spawn } from "child_process";
import fs from "fs";
import path from "path";
import { execSync } from "child_process";

const PROJECT_ROOT = path.resolve(__dirname, "..");
const ENV_ID_FILE = path.join(PROJECT_ROOT, ".pact-env-id");

// ── minimal MCP JSON-RPC client ───────────────────────────────────────────────

type JsonRpcMsg = { jsonrpc: "2.0"; id?: number; method?: string; params?: unknown; result?: unknown; error?: { code: number; message: string } };

class McpClient {
  private proc: ReturnType<typeof spawn>;
  private pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
  private nextId = 1;
  private lineBuf = "";

  constructor(env: Record<string, string>) {
    this.proc = spawn("npx", ["--yes", "@smartbear/mcp@latest"], {
      env,
      stdio: ["pipe", "pipe", "pipe"],
    });

    this.proc.stdout!.on("data", (chunk: Buffer) => {
      this.lineBuf += chunk.toString("utf8");
      let nl: number;
      while ((nl = this.lineBuf.indexOf("\n")) !== -1) {
        const line = this.lineBuf.slice(0, nl).trim();
        this.lineBuf = this.lineBuf.slice(nl + 1);
        if (line) this.onLine(line);
      }
    });

    this.proc.stderr!.on("data", (chunk: Buffer) => {
      process.stderr.write(chunk);
    });

    this.proc.on("error", (err) => {
      for (const { reject } of this.pending.values()) reject(err);
      this.pending.clear();
    });
  }

  private onLine(line: string): void {
    let msg: JsonRpcMsg;
    try { msg = JSON.parse(line); } catch { return; }
    // Only handle responses (have an id but no method)
    if (msg.id !== undefined && msg.method === undefined) {
      const p = this.pending.get(msg.id);
      if (!p) return;
      this.pending.delete(msg.id);
      if (msg.error) p.reject(new Error(`MCP error ${msg.error.code}: ${msg.error.message}`));
      else p.resolve(msg.result);
    }
    // Server-initiated requests and notifications are intentionally ignored
  }

  private write(msg: JsonRpcMsg): void {
    this.proc.stdin!.write(JSON.stringify(msg) + "\n");
  }

  private rpc(method: string, params?: unknown): Promise<unknown> {
    const id = this.nextId++;
    return new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`MCP request '${method}' timed out after 60 s`));
      }, 60_000);
      this.pending.set(id, {
        resolve: (v) => { clearTimeout(timer); resolve(v); },
        reject: (e) => { clearTimeout(timer); reject(e); },
      });
      this.write({ jsonrpc: "2.0", id, method, params });
    });
  }

  async initialize(): Promise<void> {
    await this.rpc("initialize", {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "ci-broker-orchestrate", version: "1.0.0" },
    });
    // send initialized notification (no id = fire-and-forget)
    this.write({ jsonrpc: "2.0", method: "notifications/initialized", params: {} });
  }

  async callTool(name: string, args: unknown): Promise<{ content: Array<{ type: string; text?: string }>; isError?: boolean }> {
    const raw = await this.rpc("tools/call", { name, arguments: args });
    return raw as { content: Array<{ type: string; text?: string }>; isError?: boolean };
  }

  close(): Promise<void> {
    return new Promise((resolve) => {
      this.proc.stdin!.end();
      this.proc.on("close", () => resolve());
      setTimeout(() => { this.proc.kill(); resolve(); }, 5_000);
    });
  }
}

// ── helpers ───────────────────────────────────────────────────────────────────

function tryExec(cmd: string): string {
  try { return execSync(cmd, { cwd: PROJECT_ROOT, stdio: ["pipe", "pipe", "ignore"] }).toString().trim(); }
  catch { return ""; }
}

function getVersion(): string {
  return process.env.CONSUMER_VERSION ?? (tryExec("git rev-parse --short HEAD") || "1.0.0");
}

function getBranch(): string {
  if (process.env.GIT_BRANCH) return process.env.GIT_BRANCH;
  const b = tryExec("git rev-parse --abbrev-ref HEAD");
  return b && b !== "HEAD" ? b : "main";
}

function toText(result: { content: Array<{ type: string; text?: string }>; isError?: boolean }): string {
  return result.content.filter(c => c.type === "text").map(c => c.text ?? "").join("\n");
}

function extractUuid(text: string): string | null {
  const m = text.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
  return m ? m[0] : null;
}

function makeEnv(): Record<string, string> {
  const brokerUrl = process.env.PACT_BROKER_BASE_URL;
  if (!brokerUrl) throw new Error("PACT_BROKER_BASE_URL is required");
  return Object.fromEntries(
    Object.entries(process.env).filter((e): e is [string, string] => e[1] !== undefined)
  );
}

async function withMcp<T>(fn: (client: McpClient) => Promise<T>): Promise<T> {
  const client = new McpClient(makeEnv());
  await client.initialize();
  try { return await fn(client); }
  finally { await client.close(); }
}

// ── setup ─────────────────────────────────────────────────────────────────────

async function setup(): Promise<void> {
  await withMcp(async (mcp) => {
    const listRes = await mcp.callTool("contract-testing_list_environments", {});
    const listText = toText(listRes);
    console.log("Current environments:\n", listText);

    // Try JSON parse first, fall back to UUID scanning
    let uuid: string | null = null;
    try {
      const parsed = JSON.parse(listText) as Array<{ name: string; uuid: string }> | { environments?: Array<{ name: string; uuid: string }> };
      const envs = Array.isArray(parsed) ? parsed : (parsed.environments ?? []);
      const prod = envs.find(e => e.name?.toLowerCase() === "production");
      uuid = prod?.uuid ?? null;
    } catch {
      const prodLine = listText.split("\n").find(l => l.toLowerCase().includes("production"));
      if (prodLine) uuid = extractUuid(prodLine);
    }

    if (uuid) {
      fs.writeFileSync(ENV_ID_FILE, uuid, "utf8");
      console.log(`\n✅ 'production' environment already exists (${uuid})`);
      return;
    }

    // Create production environment
    const createRes = await mcp.callTool("contract-testing_create_environment", {
      name: "production",
      production: true,
      displayName: "Production",
    });
    const createText = toText(createRes);
    console.log(createText);
    if (createRes.isError) throw new Error(`create_environment failed: ${createText}`);

    try {
      const parsed = JSON.parse(createText) as { uuid?: string };
      uuid = parsed.uuid ?? extractUuid(createText);
    } catch {
      uuid = extractUuid(createText);
    }
    if (!uuid) throw new Error(`Could not extract environment UUID from: ${createText}`);

    fs.writeFileSync(ENV_ID_FILE, uuid, "utf8");
    console.log(`\n✅ Created 'production' environment (${uuid})`);
  });
}

// ── publish ───────────────────────────────────────────────────────────────────

async function publish(): Promise<void> {
  const version = getVersion();
  const branch = getBranch();
  const pactsDir = path.join(PROJECT_ROOT, "consumer", "pacts");
  const pactFiles = fs.readdirSync(pactsDir).filter(f => f.endsWith(".json"));
  if (pactFiles.length === 0) throw new Error(`No pact files found in ${pactsDir}`);

  const contracts = pactFiles.map(filename => {
    const raw = fs.readFileSync(path.join(pactsDir, filename), "utf8");
    const pact = JSON.parse(raw) as { consumer?: { name?: string }; provider?: { name?: string } };
    return {
      consumerName: pact.consumer?.name ?? "PetsWebConsumer",
      providerName: pact.provider?.name ?? "PetsProvider",
      content: Buffer.from(raw, "utf8").toString("base64"),
      contentType: "application/json" as const,
      specification: "pact" as const,
    };
  });

  console.log(`Publishing ${contracts.length} pact(s) via SmartBear MCP`);
  console.log(`  PetsWebConsumer @ ${version}  branch: ${branch}`);

  const buildUrl =
    process.env.GITHUB_SERVER_URL && process.env.GITHUB_RUN_ID
      ? `${process.env.GITHUB_SERVER_URL}/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}`
      : undefined;

  await withMcp(async (mcp) => {
    const result = await mcp.callTool("contract-testing_publish_consumer_contracts", {
      pacticipantName: "PetsWebConsumer",
      pacticipantVersionNumber: version,
      branch,
      contracts,
      ...(buildUrl && { buildUrl }),
    });
    const text = toText(result);
    console.log(text);
    if (result.isError) throw new Error(`Publish failed: ${text}`);
    console.log(`\n✅ Pacts published for PetsWebConsumer@${version}`);
  });
}

// ── record-deployment ─────────────────────────────────────────────────────────

async function recordDeployment(): Promise<void> {
  const pacticipant = process.argv[3];
  const version = process.argv[4];
  if (!pacticipant || !version) {
    throw new Error("Usage: broker-orchestrate.ts record-deployment <pacticipant> <version>");
  }
  const envId = fs.existsSync(ENV_ID_FILE)
    ? fs.readFileSync(ENV_ID_FILE, "utf8").trim()
    : null;
  if (!envId) throw new Error(`No environment UUID — run 'setup' first (expected: ${ENV_ID_FILE})`);

  console.log(`Recording deployment: ${pacticipant}@${version} → production (envId: ${envId})`);

  await withMcp(async (mcp) => {
    const result = await mcp.callTool("contract-testing_record_deployment", {
      pacticipantName: pacticipant,
      versionNumber: version,
      environmentId: envId,
    });
    const text = toText(result);
    console.log(text);
    if (result.isError) throw new Error(`record_deployment failed: ${text}`);
    console.log(`\n✅ Recorded: ${pacticipant}@${version} deployed to production`);
  });
}

// ── can-i-deploy ──────────────────────────────────────────────────────────────

async function canIDeploy(): Promise<void> {
  const pacticipant = process.argv[3] ?? "PetsWebConsumer";
  const version     = process.argv[4] ?? getVersion();
  const environment = "production";

  console.log(`\nSmartBear MCP → can-i-deploy: ${pacticipant}@${version} to ${environment}`);

  let allowed = false;

  await withMcp(async (mcp) => {
    const result = await mcp.callTool("contract-testing_can_i_deploy", {
      pacticipant,
      version,
      environment,
    });
    const text = toText(result);
    console.log(text);
    if (result.isError) throw new Error(`can-i-deploy MCP error: ${text}`);

    // Parse pact-broker's "Computer says yes/no" idiom or JSON summary
    try {
      const parsed = JSON.parse(text) as { summary?: { deployable?: boolean }; deployable?: boolean };
      allowed = (parsed.summary?.deployable ?? parsed.deployable) === true;
    } catch {
      const lower = text.toLowerCase();
      allowed =
        lower.includes("computer says yes") ||
        (lower.includes("deployable") && lower.includes("true")) ||
        (lower.includes("success") && !lower.includes("fail")) ||
        (lower.includes("can be deployed") && !lower.includes("cannot"));
    }
  });

  if (allowed) {
    console.log(`\n✅ can-i-deploy PASSED — ${pacticipant}@${version} is safe to deploy to ${environment}.`);
  } else {
    console.error(`\n❌ can-i-deploy FAILED — ${pacticipant}@${version} must NOT be deployed to ${environment}.`);
    process.exit(1);
  }
}

// ── main ──────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  if (!process.env.PACT_BROKER_BASE_URL) {
    console.log("PACT_BROKER_BASE_URL not set — skipping broker orchestration.");
    process.exit(0);
  }

  const action = process.argv[2];
  switch (action) {
    case "setup":              await setup(); break;
    case "publish":            await publish(); break;
    case "record-deployment":  await recordDeployment(); break;
    case "can-i-deploy":       await canIDeploy(); break;
    default:
      console.error(
        "Usage: broker-orchestrate.ts [setup | publish | record-deployment <pac> <ver> | can-i-deploy <pac> <ver>]"
      );
      process.exit(1);
  }
}

main().catch((err) => {
  console.error(`\nBroker orchestration failed: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
