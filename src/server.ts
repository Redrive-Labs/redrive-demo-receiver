import { createApp } from "./app";
import { config } from "./config";
import { closeDatabase } from "./db";

const app = createApp();
const server = app.listen(config.port, "0.0.0.0", () => {
  console.log(`HTTP server listening on port ${config.port}`);
});

let isShuttingDown = false;

async function shutdown(signal: string): Promise<void> {
  if (isShuttingDown) {
    return;
  }

  isShuttingDown = true;
  console.log(`Received ${signal}; shutting down`);

  await new Promise<void>((resolve) => {
    server.close((error) => {
      if (error) {
        console.error("HTTP server shutdown failed", error);
        process.exitCode = 1;
      }
      resolve();
    });
  });

  try {
    await closeDatabase();
  } catch (error) {
    console.error("PostgreSQL pool shutdown failed", error);
    process.exitCode = 1;
  }
}

process.once("SIGINT", () => {
  void shutdown("SIGINT");
});

process.once("SIGTERM", () => {
  void shutdown("SIGTERM");
});
