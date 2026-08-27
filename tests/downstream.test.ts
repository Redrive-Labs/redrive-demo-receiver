import { spawn, type ChildProcess } from "node:child_process";
import { request as httpRequest } from "node:http";
import { createServer, type AddressInfo } from "node:net";
import path from "node:path";
import { once } from "node:events";
import { describe, expect, it } from "vitest";

const projectRoot = path.resolve(__dirname, "..");

async function getFreePort(): Promise<number> {
  const probe = createServer();
  await new Promise<void>((resolve, reject) => {
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", resolve);
  });

  const address = probe.address();
  if (address === null || typeof address === "string") {
    probe.close();
    throw new Error("Unable to determine a free port");
  }

  const port = (address as AddressInfo).port;
  await new Promise<void>((resolve, reject) => {
    probe.close((error) => (error === undefined ? resolve() : reject(error)));
  });
  return port;
}

function waitForListening(child: ChildProcess): Promise<void> {
  return new Promise((resolve, reject) => {
    child.stdout?.once("data", () => resolve());
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      reject(new Error(`Downstream exited before listening (${code ?? signal})`));
    });
  });
}

function requestHealth(
  port: number,
  host: string,
): Promise<{ status: number | undefined; body: string }> {
  return new Promise((resolve, reject) => {
    const request = httpRequest(
      {
        host: "127.0.0.1",
        port,
        path: "/health",
        headers: { host },
      },
      (response) => {
        let body = "";
        response.setEncoding("utf8");
        response.on("data", (chunk: string) => {
          body += chunk;
        });
        response.on("end", () => {
          resolve({ status: response.statusCode, body });
        });
      },
    );
    request.once("error", reject);
    request.end();
  });
}

async function stopChild(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) {
    return;
  }
  child.kill("SIGTERM");
  await once(child, "exit");
}

describe("downstream server", () => {
  it("returns 400 for a malformed Host and keeps serving", async () => {
    const port = await getFreePort();
    const child = spawn(process.execPath, ["downstream/server.js"], {
      cwd: projectRoot,
      env: { ...process.env, PORT: String(port) },
      stdio: ["ignore", "pipe", "pipe"],
    });

    try {
      await waitForListening(child);

      await expect(requestHealth(port, "bad:port")).resolves.toMatchObject({
        status: 400,
      });
      await expect(requestHealth(port, `127.0.0.1:${port}`)).resolves.toMatchObject({
        status: 200,
      });
    } finally {
      await stopChild(child);
    }
  });
});
