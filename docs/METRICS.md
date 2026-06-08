# Metrics

These numbers are **measured at runtime by the generator**, not hardcoded. Every `make generate`
prints a line of the form:

```
✅ Generated <lines> lines / <scenarios> scenarios in <seconds>s via <mode>
```

Capture that line from your own run and fill in the table — don't quote numbers you didn't measure.

| Metric | Source | Your run |
|--------|--------|---------|
| Generation time (s) | the `in <seconds>s` field | _____ |
| Lines of test generated | the `<lines>` field | _____ |
| Scenarios covered | the `<scenarios>` field (Pact interactions) | _____ |
| Generation mode | the `via <mode>` field (`mcp-remote` / `mcp-local` / `sdk` / `cached`) | _____ |

## On the "manual effort saved" claim

Hand-writing an equivalent Pact consumer suite (mock setup, matchers, provider states, the 404
case, request/response shaping) is commonly a **30–60 minute** task for an engineer new to the
service. Treat that as an **industry estimate for context**, not a measured figure — the only
measured number is the generation time the tool prints.

## What "good" looks like

- Generation completes in seconds (single-digit to low tens, depending on mode and effort).
- The generated test covers the critical consumer scenarios: list, get-by-id, **404**, create.
- It is a reviewable draft — the value is *removing the authoring cost*, not eliminating review.
- Downstream, provider verification turns the contract into an actual compatibility gate (the
  green/red steps in the demo).
