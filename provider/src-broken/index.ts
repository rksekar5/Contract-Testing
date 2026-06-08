import { createApp } from "./server";

// Optional standalone runner for the broken variant (e.g. PORT=3002 tsx src-broken/index.ts).
// The verify script can also self-host this variant in-process; see verify/verify-provider.ts.
const PORT = Number(process.env.PORT ?? 3002);

createApp().listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`BROKEN pets provider listening on http://localhost:${PORT} (base path /api/v1)`);
});
