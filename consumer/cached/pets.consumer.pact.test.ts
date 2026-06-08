import path from "path";
import { PactV3, MatchersV3 } from "@pact-foundation/pact";
import { PetsClient } from "../src/pets-client";

/**
 * Pets API — consumer contract test.
 *
 * This test runs against the Pact MOCK provider (not the real API). Running it
 * records what the consumer expects and writes a pact file to ../pacts, which
 * the provider then verifies against. Each `given(...)` is a provider state the
 * verifier sets up before replaying the interaction.
 *
 * (This is the known-good, hand-reviewed contract the AI generator emits on the
 * --cached / fallback path. The live MCP/SDK path produces an equivalent file.)
 */

const { like, eachLike, string, integer, regex } = MatchersV3;

const provider = new PactV3({
  consumer: "PetsWebConsumer",
  provider: "PetsProvider",
  dir: path.resolve(__dirname, "../pacts"),
});

describe("Pets API consumer contract", () => {
  it("lists pets in the catalog", async () => {
    // Contract: GET /pets returns an array of pets, each with id/name/species/age.
    provider
      .given("pets exist in the catalog")
      .uponReceiving("a request to list pets")
      .withRequest({ method: "GET", path: "/api/v1/pets" })
      .willRespondWith({
        status: 200,
        body: eachLike({
          id: string("1"),
          name: string("Biscuit"),
          species: string("dog"),
          age: integer(3),
        }),
      });

    await provider.executeTest(async (mockServer) => {
      const client = new PetsClient(mockServer.url);
      const pets = await client.listPets();
      // Why: consumer relies on a non-empty array of pets with a string `id`.
      expect(pets.length).toBeGreaterThan(0);
      expect(typeof pets[0].id).toBe("string");
    });
  });

  it("fetches a single pet by id", async () => {
    // Contract: GET /pets/1 returns the pet, and the id field is named `id`.
    // This is the exact field the broken provider renames to `petId`.
    provider
      .given("a pet with ID 1 exists")
      .uponReceiving("a request for pet 1")
      .withRequest({ method: "GET", path: "/api/v1/pets/1" })
      .willRespondWith({
        status: 200,
        body: like({
          id: string("1"),
          name: string("Biscuit"),
          species: string("dog"),
          age: integer(3),
        }),
      });

    await provider.executeTest(async (mockServer) => {
      const client = new PetsClient(mockServer.url);
      const pet = await client.getPet("1");
      // Why: the consumer reads `pet.id`; renaming it server-side breaks this.
      expect(pet.id).toBe("1");
    });
  });

  it("returns 404 for a pet that does not exist", async () => {
    // Contract: GET /pets/999 returns 404 with an { error } body.
    provider
      .given("no pet with ID 999 exists")
      .uponReceiving("a request for a missing pet")
      .withRequest({ method: "GET", path: "/api/v1/pets/999" })
      .willRespondWith({
        status: 404,
        body: like({ error: string("Pet 999 not found") }),
      });

    await provider.executeTest(async (mockServer) => {
      const client = new PetsClient(mockServer.url);
      // Why: the consumer must handle 404 distinctly (axios rejects on 4xx).
      await expect(client.getPet("999")).rejects.toMatchObject({
        response: { status: 404 },
      });
    });
  });

  it("creates a new pet", async () => {
    // Contract: POST /pets with { name, species, age } returns 201 + the created pet.
    provider
      .given("a new pet can be created")
      .uponReceiving("a request to create a pet")
      .withRequest({
        method: "POST",
        path: "/api/v1/pets",
        // regex keeps the consumer test tolerant of axios's charset suffix while
        // ensuring the verifier replays a JSON content-type the provider can parse.
        headers: { "Content-Type": regex("application/json.*", "application/json") },
        // Exact body: the consumer sends a known payload (top-level request-body
        // matchers aren't unwrapped the way response-body matchers are in PactV3).
        body: { name: "Pickle", species: "rabbit", age: 1 },
      })
      .willRespondWith({
        status: 201,
        body: like({
          id: string("4"),
          name: string("Pickle"),
          species: string("rabbit"),
          age: integer(1),
        }),
      });

    await provider.executeTest(async (mockServer) => {
      const client = new PetsClient(mockServer.url);
      const created = await client.createPet({ name: "Pickle", species: "rabbit", age: 1 });
      // Why: the consumer expects the server to assign a string id on creation.
      expect(typeof created.id).toBe("string");
      expect(created.name).toBe("Pickle");
    });
  });
});
