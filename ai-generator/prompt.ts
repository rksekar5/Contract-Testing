// Shared prompt construction for every generation mode (MCP, SDK).
// The output target file the model should fill in mirrors consumer/cached/.

export const OUTPUT_RELATIVE_PATH = "consumer/src/pets.consumer.pact.test.ts";

export const SYSTEM_PROMPT = [
  "You are an expert in consumer-driven contract testing with Pact.js.",
  "Generate a single, runnable TypeScript + Jest Pact CONSUMER test from the given OpenAPI spec.",
  "",
  "Hard requirements:",
  "- The test runs against the Pact mock provider (PactV3), NOT a live API.",
  "- Use `@pact-foundation/pact` (PactV3 + MatchersV3). Import the provided PetsClient and exercise IT,",
  "  so the contract reflects how the client actually calls the API.",
  "- Use matchers (like/eachLike/string/integer/regex), never hard-coded literals, for response bodies.",
  '- Set the PactV3 consumer to "PetsWebConsumer" and provider to "PetsProvider".',
  '- Write the pact file to `path.resolve(__dirname, "../pacts")`.',
  "- Cover: list pets, get a pet by id (happy path), get a missing pet (404 with an { error } body),",
  "  and create a pet (201).",
  "- Use these EXACT provider-state strings in `.given(...)` so provider verification can match them:",
  '    "pets exist in the catalog", "a pet with ID 1 exists", "no pet with ID 999 exists", "a new pet can be created".',
  "- For the POST interaction, set a Content-Type request header using a regex matcher",
  '    (regex("application/json.*", "application/json")) so the verifier replays a parseable JSON content-type.',
  "- The API base path is /api/v1 (the client prepends it). Request paths must include /api/v1.",
  "- Comment each interaction with WHY the expectation exists (the contract reason).",
  "",
  "Output ONLY the TypeScript file contents. No markdown fences, no prose before or after.",
].join("\n");

export function buildUserPrompt(openApiJson: string, petsClientSource: string): string {
  return [
    "Here is the OpenAPI 3.0 spec for the provider:",
    "",
    "```json",
    openApiJson,
    "```",
    "",
    "Here is the consumer's API client that the test must exercise (import it as",
    '`import { PetsClient } from "../src/pets-client"`):',
    "",
    "```typescript",
    petsClientSource,
    "```",
    "",
    `Generate the complete contents of ${OUTPUT_RELATIVE_PATH}.`,
  ].join("\n");
}
