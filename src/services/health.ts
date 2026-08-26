import { pool } from "../db";

export async function isDatabaseHealthy(): Promise<boolean> {
  try {
    await pool.query("SELECT 1");
    return true;
  } catch (error) {
    console.error("Health check failed", error);
    return false;
  }
}
