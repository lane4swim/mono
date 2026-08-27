// apps/api/src/index.ts
import { loadEnv } from './config/env.js';
import { buildApp } from './app.js';

async function main() {
  const env = loadEnv();
  const app = await buildApp(env);

  try {
    // Sicherheitsreview 2026-08-27, Befund N7 — siehe HOST-Kommentar in
    // config/env.ts. War zuvor fest auf '0.0.0.0' verdrahtet.
    await app.listen({ host: env.HOST, port: env.PORT });
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
}

main();
