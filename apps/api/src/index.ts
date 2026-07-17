// apps/api/src/index.ts
import { loadEnv } from './config/env.js';
import { buildApp } from './app.js';

async function main() {
  const env = loadEnv();
  const app = await buildApp(env);

  try {
    await app.listen({ host: '0.0.0.0', port: env.PORT });
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
}

main();
