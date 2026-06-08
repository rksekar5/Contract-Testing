import path from "path";
import fs from "fs";
import http from "http";
import type { AddressInfo } from "net";
import { Verifier } from "@pact-foundation/pact";
import { createApp as createCorrectApp } from "../src/server";
import { createApp as createBrokenApp } from "../src-broken/server";

/**
 * Provider verification.
 *
 * Replays the consumer's pact file against a real HTTP provider and checks the
 * provider still satisfies every interaction in the contract. THIS is the step
 * that catches consumer/provider mismatches — the consumer test alone only
 * proves the consumer's expectations against a mock.
 *
 * Two ways to point it at a provider:
 *   - PROVIDER_BASE_URL set  -> verify an already-running provider (e.g. Docker on :3001)
 *   - otherwise              -> self-host the chosen variant in-process (deterministic,
 *                               no Docker needed). PROVIDER_VARIANT=broken picks the
 *                               broken variant so the demo can show a RED verification.
 */

const PACTS_DIR = path.resolve(__dirname, "../../consumer/pacts");

// Provider-state names — MUST match the `.given(...)` strings in the consumer test.
const STATE_NAMES = [
  "pets exist in the catalog",
  "a pet with ID 1 exists",
  "no pet with ID 999 exists",
  "a new pet can be created",
  "a new pet with missing name cannot be created"
] as const;

function pactFiles(): string[] {
  if (!fs.existsSync(PACTS_DIR)) return [];
  return fs
    .readdirSync(PACTS_DIR)
    .filter((f) => f.endsWith(".json"))
    .map((f) => path.join(PACTS_DIR, f));
}

/** Build stateHandlers that drive provider state over HTTP via the /_pact hook. */
function buildStateHandlers(baseUrl: string): Record<string, () => Promise<void>> {
  const handlers: Record<string, () => Promise<void>> = {};
  for (const state of STATE_NAMES) {
    handlers[state] = async () => {
      const res = await fetch(`${baseUrl}/_pact/provider-states`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ state }),
      });
      if (!res.ok) throw new Error(`provider-state setup failed for "${state}" (${res.status})`);
    };
  }
  return handlers;
}

async function main(): Promise<void> {
  const files = pactFiles();
  if (files.length === 0) {
    console.error(
      `No pact files found in ${PACTS_DIR}.\n` +
        `Run the consumer test first:  make generate-cached && make consumer-test`,
    );
    process.exit(1);
  }

  const variant = process.env.PROVIDER_VARIANT === "broken" ? "broken" : "correct";
  const external = process.env.PROVIDER_BASE_URL;

  let server: http.Server | undefined;
  let baseUrl: string;

  if (external) {
    baseUrl = external.replace(/\/$/, "");
    console.log(`Verifying ${variant} contract against running provider: ${baseUrl}`);
  } else {
    const app = variant === "broken" ? createBrokenApp() : createCorrectApp();
    server = await new Promise<http.Server>((resolve) => {
      const s = app.listen(0, () => resolve(s));
    });
    const { port } = server.address() as AddressInfo;
    baseUrl = `http://localhost:${port}`;
    console.log(`Self-hosting ${variant} provider at ${baseUrl} for verification`);
  }

  const brokerUrl = process.env.PACT_BROKER_BASE_URL;
  const brokerUser = process.env.PACT_BROKER_USERNAME;
  const brokerPassword = process.env.PACT_BROKER_PASSWORD;

  try {
    await new Verifier({
      provider: "PetsProvider",
      providerVersion: variant === "broken" ? "0.0.0-broken" : "1.0.0",
      providerBaseUrl: baseUrl,
      pactUrls: files,
      stateHandlers: buildStateHandlers(baseUrl),
      logLevel: "warn",
      ...(brokerUrl && {
        pactBrokerUrl: brokerUrl,
        ...(brokerUser && { pactBrokerUsername: brokerUser }),
        ...(brokerPassword && { pactBrokerPassword: brokerPassword }),
        publishVerificationResult: true,
        providerVersionBranch: process.env.GIT_BRANCH ?? "main",
      }),
    }).verifyProvider();

    console.log(`\n✅ Provider verification PASSED (${variant} provider).`);
    console.log("   The provider satisfies every interaction in the consumer contract.");
  } finally {
    if (server) await new Promise<void>((resolve) => server!.close(() => resolve()));
  }
}

main().catch((err) => {
  console.error(`\n❌ Provider verification FAILED.`);
  console.error("   The provider no longer satisfies the consumer contract — this is a real mismatch.");
  console.error(`\n${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
