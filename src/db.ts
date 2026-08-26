import { Pool } from "pg";
import { config } from "./config";

export const pool = new Pool(config.database);

pool.on("error", (error) => {
  console.error("Unexpected PostgreSQL pool error", error);
});

export async function closeDatabase(): Promise<void> {
  await pool.end();
}
