# Architecture

## The pipeline

```
                    provider/openapi.json
                              │
                              ▼
         ┌──────────────────────────────────────────┐
         │  Claude Opus (claude-opus-4-8)            │
         │  + PactFlow MCP tools                     │
         │  (remote connector | local claude -p)     │
         │  → graceful fallback: SDK → cached        │
         └──────────────────────────────────────────┘
                              │  writes
                              ▼
        consumer/src/pets.consumer.pact.test.ts
                              │  `make consumer-test`
                              ▼  (runs vs Pact MOCK provider — no live API)
                    consumer/pacts/*.json   ◀── the contract artifact
                              │
                              │  `make verify` / `make verify-broken`
                              ▼
         ┌──────────────────────────────────────────┐
         │  Provider verification (Pact Verifier)     │
         │  replays the pact file vs a real HTTP      │
         │  provider, running provider-state setup    │
         └──────────────────────────────────────────┘
              │                                  │
   correct provider (src/)            broken provider (src-broken/)
        ✅ PASS                            ❌ FAIL  (id → petId)
```

## Why this is the shift-left moment

- The **consumer test** encodes what the consumer needs and runs against an in-process **mock**. It is fast and needs no running API. It produces the pact file.
- **Provider verification** is the independent check: it replays the pact file against the real provider. If the provider's response shape drifts from what consumers depend on, verification fails **here** — in CI, at the contract layer — instead of surfacing later as a broken UI/e2e test or a production incident.
- In a real pipeline the pact is published to a **broker**, and `can-i-deploy` gates releases on both sides being compatible (optional `--profile broker` in `docker-compose.yml`).

This is the contract layer of the test pyramid: narrower and faster than UI/e2e, broader than unit tests, and uniquely able to catch *cross-service* incompatibilities early.

## Provider states

Provider verification sets up state before each interaction. Because the provider runs in a
separate process (or container), the verifier's `stateHandlers` POST to a test-only hook,
`POST /_pact/provider-states`, which resets/clears the in-memory store. The `.given(...)`
strings in the consumer test and the `STATE_NAMES` in `verify/verify-provider.ts` must match.

## Generation: PactFlow MCP as the headline, with graceful degradation

`ai-generator/generate.ts` resolves the best available mode and cascades on failure:

| Mode | Mechanism | Notes |
|------|-----------|-------|
| `mcp-remote` | Anthropic Messages API **MCP connector** → hosted PactFlow MCP | for an `https://` PactFlow MCP server |
| `mcp-local` | `claude -p` + `.mcp.json` → Claude Code agent uses PactFlow's stdio MCP | the API connector can't reach stdio servers |
| `sdk` | plain `@anthropic-ai/sdk`, no MCP | silent fallback when MCP is unavailable |
| `cached` | ships the hand-reviewed known-good test | always works offline |

Model settings (Opus 4.8): adaptive thinking only; no `temperature`/`top_p`/`budget_tokens`
(they return 400). Larger outputs use streaming + `finalMessage()` to avoid HTTP timeouts.

## Why the broken variant exists

`provider/src-broken/server.ts` is identical to the real provider except one line of
`GET /pets/:id` returns the identifier as `petId` instead of `id`. That single rename is a
realistic, review-passing change that breaks consumers — and exactly what contract verification
is designed to catch. It is the demo's payoff, not an afterthought.
