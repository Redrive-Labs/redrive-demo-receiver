import { execFileSync } from "node:child_process";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createApp } from "../src/app";
import { config } from "../src/config";

const projectRoot = path.resolve(__dirname, "..");

function restoreEnvironmentValue(name: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[name];
  } else {
    process.env[name] = value;
  }
}

describe("configuration boundaries", () => {
  it("runs database migrations without a webhook secret", () => {
    const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
    const databaseOnlyEnvironment = {
      PATH: process.env.PATH ?? "",
      HOME: process.env.HOME ?? "",
      PGHOST: config.database.host,
      PGPORT: String(config.database.port),
      PGUSER: config.database.user ?? "",
      PGPASSWORD: config.database.password ?? "",
      PGDATABASE: config.database.database ?? "",
      WEBHOOK_SECRET: "",
    };

    expect(() =>
      execFileSync(npmCommand, ["run", "db:migrate", "--silent"], {
        cwd: projectRoot,
        env: databaseOnlyEnvironment,
        stdio: "pipe",
      }),
    ).not.toThrow();
  });

  it("requires a webhook secret when creating the application", () => {
    const previousSecret = process.env.WEBHOOK_SECRET;
    delete process.env.WEBHOOK_SECRET;

    try {
      expect(() => createApp()).toThrow("WEBHOOK_SECRET must be configured");
    } finally {
      restoreEnvironmentValue("WEBHOOK_SECRET", previousSecret);
    }
  });
});
