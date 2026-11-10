export interface AppConfig {
  host: string;
  port: number;
  publicBaseUrl: string;
  storeDriver: "memory" | "postgres-redis";
  databaseUrl: string;
  redisUrl: string;
  logLevel: string;
  trustProxy: boolean;
  now: () => Date;
}

export function loadConfig(overrides: Partial<AppConfig> = {}): AppConfig {
  const port = Number(process.env.PORT ?? 39002);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error("PORT must be a valid TCP port");
  }

  const storeDriver = process.env.STORE_DRIVER ?? "memory";
  if (storeDriver !== "memory" && storeDriver !== "postgres-redis") {
    throw new Error("STORE_DRIVER must be memory or postgres-redis");
  }

  const config: AppConfig = {
    host: process.env.HOST ?? "127.0.0.1",
    port,
    publicBaseUrl:
      process.env.PUBLIC_BASE_URL ?? `http://127.0.0.1:${port}`,
    storeDriver,
    databaseUrl: process.env.DATABASE_URL ?? "",
    redisUrl: process.env.REDIS_URL ?? "",
    logLevel: process.env.LOG_LEVEL ?? "info",
    trustProxy: process.env.TRUST_PROXY === "true",
    now: () => new Date(),
    ...overrides,
  };

  if (config.storeDriver === "postgres-redis") {
    if (!config.databaseUrl) throw new Error("DATABASE_URL is required");
    if (!config.redisUrl) throw new Error("REDIS_URL is required");
    if (!config.publicBaseUrl.startsWith("https://")) {
      throw new Error("PUBLIC_BASE_URL must use https in production mode");
    }
  }
  return config;
}
