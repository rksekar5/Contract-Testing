import { createApp } from "./server";

const PORT = Number(process.env.PORT ?? 3001);

createApp().listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`pets provider listening on http://localhost:${PORT} (base path /api/v1)`);
});
