import type { AppConfig } from "./config.js";
import { PostgresRedisStore } from "./production-store.js";
import { InMemoryStore, type RelayStore } from "./store.js";

export async function createStore(config: AppConfig): Promise<RelayStore> {
  if (config.storeDriver === "memory") return new InMemoryStore();
  return PostgresRedisStore.connect(config.databaseUrl, config.redisUrl);
}
