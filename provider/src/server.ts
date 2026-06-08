import express, { Express, Request, Response } from "express";
import { PetStore, validateCreate } from "./pets";

/**
 * App factory for the pets provider.
 *
 * Routes live under /api/v1. The same factory is reused by:
 *   - src/index.ts            (the real provider, what the demo verifies first)
 *   - verify/verify-provider  (provider-state setup hits the test hook below)
 *
 * The "broken" variant (src-broken/server.ts) re-implements this with ONE
 * deliberate change so contract verification fails — see that file.
 */
export function createApp(): Express {
  const app = express();
  app.use(express.json());

  const store = new PetStore();

  app.get("/health", (_req: Request, res: Response) => {
    res.json({ status: "ok" });
  });

  // --- Pact provider-state test hook -------------------------------------
  // Provider verification runs in a separate process (and in Docker), so the
  // verifier's stateHandlers can't mutate this in-memory store directly. They
  // POST here instead. Clearly namespaced under /_pact so it reads as a test
  // affordance, not part of the real API surface.
  app.post("/_pact/provider-states", (req: Request, res: Response) => {
    const state: string = req.body?.state ?? "";
    if (/no pets/i.test(state)) {
      store.clear();
    } else {
      store.reset();
    }
    res.json({ ok: true, state });
  });

  // --- Real API ----------------------------------------------------------
  app.get("/api/v1/pets", (_req: Request, res: Response) => {
    res.json(store.list());
  });

  app.get("/api/v1/pets/:id", (req: Request, res: Response) => {
    const pet = store.get(req.params.id);
    if (!pet) {
      res.status(404).json({ error: `Pet ${req.params.id} not found` });
      return;
    }
    res.json(pet);
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
