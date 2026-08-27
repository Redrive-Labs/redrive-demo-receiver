import "dotenv/config";

function readPort(name: string, fallback: number): number {
  const rawValue = process.env[name];

  if (rawValue === undefined) {
    return fallback;
  }

  const port = Number(rawValue);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`${name} must be an integer between 1 and 65535`);
  }

  return port;
}

function readRequired(name: string): string {
  const value = process.env[name];

  if (value === undefined || value.length === 0) {
    throw new Error(`${name} must be configured`);
  }

  return value;
}

export const config = {
  port: readPort("PORT", 3000),
  get webhookSecret(): string {
    return readRequired("WEBHOOK_SECRET");
  },
  downstreamUrl:
    process.env.DOWNSTREAM_URL ?? "http://localhost:4000/notifications",
  database: {
    host: process.env.PGHOST ?? "localhost",
    port: readPort("PGPORT", 5432),
    user: process.env.PGUSER,
    password: process.env.PGPASSWORD,
    database: process.env.PGDATABASE,
  },
};
