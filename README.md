# Contract Testing Demo — AI-generated consumer contracts with PactFlow MCP

Proves a shift-left story end to end:

> **Claude Opus, using PactFlow's MCP tools, generates a consumer contract from an OpenAPI spec — and contract verification then catches a breaking provider change before it reaches UI testing.**

It uses the *correct* consumer-driven contract (CDC) model:

```
OpenAPI spec ──▶ Claude Opus + PactFlow MCP ──▶ consumer test
                                                      │ run vs Pact MOCK (no live API)
                                                      ▼
                                                 pact file ──▶ provider verification
                                                                   ├─ correct provider → ✅ PASS
                                                                   └─ broken provider  → ❌ FAIL  ← the point
```

The consumer test runs against the Pact **mock** provider and emits a pact file. **Provider verification** is a separate step that replays that pact file against the real provider — that is where mismatches are caught.

## Quick start (< 5 min, no API key needed)

```bash
make install
make demo
```

`make demo` will:
1. Generate the consumer contract from `provider/openapi.json` (falls back to a cached known-good test if no PactFlow MCP / API key is set — see below).
2. Run the consumer test against the Pact mock → writes `consumer/pacts/*.json`.
3. Verify the contract against the **correct** provider → **PASS**.
4. Verify the same contract against the **broken** provider (which renames `id` → `petId`) → **FAIL**, with a contract-mismatch diff. That failure is the demo.

Individual targets: `make help`.

## Generation modes (PactFlow MCP is the headline)

`make generate` resolves a mode at runtime and **degrades gracefully** so the demo can never hard-fail:

| Order | Mode | When it runs |
|------|------|--------------|
| 1 | **PactFlow MCP — remote** | `PACTFLOW_MCP_URL` (https) is set & reachable → Anthropic API MCP connector |
| 2 | **PactFlow MCP — local/stdio** | `.mcp.json` has a real PactFlow server → `claude -p` drives the Claude Code agent |
| 3 | **Anthropic SDK** | MCP not available but `ANTHROPIC_API_KEY` is set (silent fallback) |
| 4 | **Cached** | nothing configured → ships the hand-reviewed known-good test (fully offline) |

`make generate-cached` forces mode 4; `make generate-sdk` forces mode 3.

## Set up PactFlow MCP

Your PactFlow MCP server "exists but isn't set up yet," and we haven't confirmed whether it's remote or local — so the demo runs today via the SDK/cached path and lights up MCP once you configure it. Check PactFlow/SmartBear's MCP docs and then:

- **If it's a hosted (https URL) server:** copy `ai-generator/.env.example` → `ai-generator/.env`, set `ANTHROPIC_API_KEY`, `PACTFLOW_MCP_URL`, `PACTFLOW_MCP_TOKEN`. The remote connector path activates.
- **If it's a local/stdio package:** set the real command/args in `.mcp.json` (replace the `REPLACE-ME` placeholder) and ensure the `claude` CLI is installed. The local path activates.

> ⚠️ Two things to confirm in PactFlow's docs before relying on MCP: that a usable PactFlow MCP server exists, and its real tool names. Also verify the current Anthropic [MCP-connector](https://platform.claude.com/docs/en/agents-and-tools/mcp-connector) request shape — `ai-generator/mcp-remote.ts` flags exactly where. If MCP isn't available, everything still works via the SDK/cached path; you just lose the MCP headline.

## Layout

| Path | What |
|------|------|
| `provider/` | Express pets API (the provider), OpenAPI spec, **broken variant**, Pact verifier |
| `consumer/` | API client, the generated consumer Pact test, the cached known-good test |
| `ai-generator/` | Claude Opus generation: MCP (remote/local), SDK, cached — with graceful degradation |
| `docs/` | `DEMO_SCRIPT.md`, `ARCHITECTURE.md`, `METRICS.md` |

## Requirements

- Node 20+
- Docker (optional — only for `make provider-up` / the broker profile; the pass/fail demo self-hosts the provider and needs no Docker)
- `ANTHROPIC_API_KEY` and/or PactFlow MCP (optional — `make demo` runs without them via the cached path)
