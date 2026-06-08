// In-memory pets data + handler logic, shared by the real and "broken" providers.
// Realistic adoption-shelter domain so the contract reads like a real service.

export interface Pet {
  id: string;
  name: string;
  species: string;
  age: number;
}

// Seed data. Cloned on each reset so provider-state setup is deterministic.
const SEED: Pet[] = [
  { id: "1", name: "Biscuit", species: "dog", age: 3 },
  { id: "2", name: "Mittens", species: "cat", age: 5 },
  { id: "3", name: "Pickle", species: "rabbit", age: 1 },
];

export class PetStore {
  private pets: Pet[] = [];
  private nextId = 1;

  constructor() {
    this.reset();
  }

  /** Restore the store to its seed state. Used by provider-state setup during verification. */
  reset(): void {
    this.pets = SEED.map((p) => ({ ...p }));
    this.nextId = this.pets.length + 1;
  }

  /** Empty the store. Used by the "no pets exist" provider state. */
  clear(): void {
    this.pets = [];
  }

  list(): Pet[] {
    return this.pets.map((p) => ({ ...p }));
  }

  get(id: string): Pet | undefined {
    const found = this.pets.find((p) => p.id === id);
    return found ? { ...found } : undefined;
  }

  create(input: { name: string; species: string; age: number }): Pet {
    const pet: Pet = { id: String(this.nextId++), ...input };
    this.pets.push(pet);
    return { ...pet };
  }
}

export interface CreatePetBody {
  name?: unknown;
  species?: unknown;
  age?: unknown;
}

/** Validate a POST /pets body. Returns the typed input or an error message. */
export function validateCreate(
  body: CreatePetBody,
): { ok: true; value: { name: string; species: string; age: number } } | { ok: false; error: string } {
  const { name, species, age } = body;
  if (typeof name !== "string" || name.trim() === "") {
    return { ok: false, error: "name is required and must be a non-empty string" };
  }
  if (typeof species !== "string" || species.trim() === "") {
    return { ok: false, error: "species is required and must be a non-empty string" };
  }
  if (typeof age !== "number" || !Number.isFinite(age) || age < 0) {
    return { ok: false, error: "age is required and must be a non-negative number" };
  }
  return { ok: true, value: { name, species, age } };
}
