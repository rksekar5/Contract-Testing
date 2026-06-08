import express, { Express, Request, Response } from "express";
import { PetStore, validateCreate } from "../src/pets";

/**
 * BROKEN provider variant.
 *
 * Byte-for-byte the same as src/server.ts EXCEPT for one line in
 * `GET /api/v1/pets/:id`: it returns the identifier as `petId` instead of `id`.
 *
 * That single field rename is exactly the kind of "harmless looking" API change
 * that slips through code review and breaks consumers. Provider verification
 * replays the consumer's pact file against this variant and fails loudly —
 * which is the whole point of the demo.
 */
export function createApp(): Express {
  const app = express();
  app.use(express.json());

  const store = new PetStore();

  app.get("/health", (_req: Request, res: Response) => {
    res.json({ status: "ok" });
  });

  app.post("/_pact/provider-states", (req: Request, res: Response) => {
    const state: string = req.body?.state ?? "";
    if (/no pets/i.test(state)) {
      store.clear();
    } else {
      store.reset();
    }
    res.json({ ok: true, state });
  });

  app.get("/api/v1/pets", (_req: Request, res: Response) => {
    res.json(store.list());
  });

  app.get("/api/v1/pets/:id", (req: Request, res: Response) => {
    const pet = store.get(req.params.id);
    if (!pet) {
      res.status(404).json({ error: `Pet ${req.params.id} not found` });
      return;
    }
    // ⬇️ THE BREAKING CHANGE: `petId` instead of `id`.
    res.json({ petId: pet.id, name: pet.name, species: pet.species, age: pet.age });
  });

  app.post("/api/v1/pets", (req: Request, res: Response) => {
    const result = validateCreate(req.body ?? {});
    if (!result.ok) {
      res.status(400).json({ error: result.error });
      return;
    }
    res.status(201).json(store.create(result.value));
  });

  return app;
}
