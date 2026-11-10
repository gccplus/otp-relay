import { buildApp } from "./app.js";
import { loadConfig } from "./config.js";
import { runMigrations } from "./migrate.js";
import { createStore } from "./store-factory.js";

const config = loadConfig();
if (config.storeDriver === "postgres-redis") {
  await runMigrations(config.databaseUrl);
}
const store = await createStore(config);
const app = await buildApp({ config, store });

try {
  await app.listen({ host: config.host, port: config.port });
  const shutdown = async () => {
    await app.close();
  };
  process.once("SIGTERM", () => void shutdown());
  process.once("SIGINT", () => void shutdown());
} catch (error) {
  app.log.error(error);
  await app.close();
  process.exitCode = 1;
}
