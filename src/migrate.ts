import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { closeDatabase, pool } from "./db";

const MIGRATION_LOCK_KEY = 2026001;

async function runMigrations(): Promise<void> {
  const migrationsDirectory = path.resolve(__dirname, "..", "migrations");
  const client = await pool.connect();
  let lockAcquired = false;

  try {
    await client.query("SELECT pg_advisory_lock($1::bigint)", [
      MIGRATION_LOCK_KEY,
    ]);
    lockAcquired = true;

    const migrationFiles = (await readdir(migrationsDirectory))
      .filter((fileName) => fileName.endsWith(".sql"))
      .sort();

    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        filename TEXT PRIMARY KEY,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    for (const fileName of migrationFiles) {
      const applied = await client.query(
        "SELECT 1 FROM schema_migrations WHERE filename = $1",
        [fileName],
      );

      if (applied.rowCount !== 0) {
        continue;
      }

      const sql = await readFile(
        path.join(migrationsDirectory, fileName),
        "utf8",
      );

      await client.query("BEGIN");
      try {
        await client.query(sql);
        await client.query(
          "INSERT INTO schema_migrations (filename) VALUES ($1)",
          [fileName],
        );
        await client.query("COMMIT");
        console.log(`Applied migration ${fileName}`);
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      }
    }
  } finally {
    try {
      if (lockAcquired) {
        await client.query("SELECT pg_advisory_unlock($1::bigint)", [
          MIGRATION_LOCK_KEY,
        ]);
      }
    } finally {
      client.release();
    }
  }
}

async function main(): Promise<void> {
  try {
    await runMigrations();
  } catch (error) {
    console.error("Database migration failed", error);
    process.exitCode = 1;
  } finally {
    await closeDatabase();
  }
}

void main();
