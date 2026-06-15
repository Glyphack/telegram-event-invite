declare module "cloudflare:test" {
  interface ProvidedEnv {
    DB: D1Database;
    BOT_TOKEN: string;
    AI: Ai;
    TEST_MIGRATIONS: D1Migration[];
  }
}
