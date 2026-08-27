import { spawn, type ChildProcess } from "node:child_process";
import { request as httpRequest } from "node:http";
import { createServer, type AddressInfo } from "node:net";
import path from "node:path";
import { once } from "node:events";
import { describe, expect, it } from "vitest";

const projectRoot = path.resolve(__dirname, "..");
const MAX_BODY_BYTES = 100 * 1024;

type HttpResponse = { status: number | undefined; body: string };

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

function requestNotification(
  port: number,
  body: Buffer,
  chunks: Buffer[] = [body],
): Promise<HttpResponse> {
  return new Promise((resolve, reject) => {
    const request = httpRequest(
      {
        host: "127.0.0.1",
        port,
        path: "/notifications",
        method: "POST",
        headers: {
          host: `127.0.0.1:${port}`,
          "content-type": "application/json",
        },
      },
      (response) => {
        const responseChunks: Buffer[] = [];
        response.on("data", (chunk: Buffer) => {
          responseChunks.push(Buffer.from(chunk));
        });
        response.on("end", () => {
          resolve({
            status: response.statusCode,
            body: Buffer.concat(responseChunks).toString("utf8"),
          });
        });
      },
    );
    request.once("error", reject);
    for (const chunk of chunks) {
      request.write(chunk);
    }
    request.end();
  });
}

function abortNotification(port: number): Promise<void> {
  const body = Buffer.from(
    JSON.stringify({ eventId: 1, deliveryId: "opaque-delivery-id" }),
    "utf8",
  );
  const partialBody = body.subarray(0, body.byteLength - 1);

  return new Promise((resolve, reject) => {
    const request = httpRequest({
      host: "127.0.0.1",
      port,
      path: "/notifications",
      method: "POST",
      headers: {
        host: `127.0.0.1:${port}`,
        "content-type": "application/json",
        "content-length": body.byteLength,
      },
    });
    request.once("error", (error) => {
      if ((error as NodeJS.ErrnoException).code !== "ECONNRESET") {
        reject(error);
      }
    });
    request.once("close", () => resolve());
    request.write(partialBody, () => request.destroy());
  });
}

async function startDownstream(): Promise<{
  child: ChildProcess;
  port: number;
}> {
  const port = await getFreePort();
  const child = spawn(process.execPath, ["downstream/server.js"], {
    cwd: projectRoot,
    env: { ...process.env, PORT: String(port) },
    stdio: ["ignore", "pipe", "pipe"],
  });
  await waitForListening(child);
  return { child, port };
}

async function stopChild(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) {
    return;
  }
  child.kill("SIGTERM");
  await once(child, "exit");
}

describe("downstream server", () => {
  it("accepts a valid notification below the byte limit", async () => {
    const { child, port } = await startDownstream();

    try {
      const body = Buffer.from(
        JSON.stringify({ eventId: 1, deliveryId: "opaque-delivery-id" }),
        "utf8",
      );
      await expect(requestNotification(port, body)).resolves.toEqual({
        status: 202,
        body: '{"status":"accepted"}',
      });
    } finally {
      await stopChild(child);
    }
  });

  it("accepts a valid notification exactly at the byte limit", async () => {
    const { child, port } = await startDownstream();

    try {
      const withoutPadding = JSON.stringify({
        eventId: 1,
        deliveryId: "opaque-delivery-id",
        padding: "",
      });
      const paddingBytes =
        MAX_BODY_BYTES - Buffer.byteLength(withoutPadding, "utf8");
      const body = Buffer.from(
        JSON.stringify({
          eventId: 1,
          deliveryId: "opaque-delivery-id",
          padding: "x".repeat(paddingBytes),
        }),
        "utf8",
      );
      expect(body.byteLength).toBe(MAX_BODY_BYTES);

      await expect(requestNotification(port, body)).resolves.toEqual({
        status: 202,
        body: '{"status":"accepted"}',
      });
    } finally {
      await stopChild(child);
    }
  });

  it("rejects an oversized chunked body and keeps serving", async () => {
    const { child, port } = await startDownstream();

    try {
      const body = Buffer.from(
        JSON.stringify({
          eventId: 1,
          deliveryId: "opaque-delivery-id",
          padding: "x".repeat(MAX_BODY_BYTES),
        }),
        "utf8",
      );
      expect(body.byteLength).toBeGreaterThan(MAX_BODY_BYTES);

      await expect(
        requestNotification(port, body, [
          body.subarray(0, MAX_BODY_BYTES),
          body.subarray(MAX_BODY_BYTES),
        ]),
      ).resolves.toEqual({
        status: 413,
        body: JSON.stringify({
          error: "request_body_too_large",
          message: "Request body must be 100 KiB or smaller",
        }),
      });
      await expect(requestHealth(port, `127.0.0.1:${port}`)).resolves.toMatchObject({
        status: 200,
      });
    } finally {
      await stopChild(child);
    }
  });

  it("keeps serving after an aborted notification request", async () => {
    const { child, port } = await startDownstream();

    try {
      await abortNotification(port);
      await expect(requestHealth(port, `127.0.0.1:${port}`)).resolves.toMatchObject({
        status: 200,
      });
    } finally {
      await stopChild(child);
    }
  });

  it("counts multibyte request bodies by UTF-8 bytes", async () => {
    const { child, port } = await startDownstream();

    try {
      const body = Buffer.from(
        JSON.stringify({
          eventId: 1,
          deliveryId: "opaque-delivery-id",
          padding: "😀".repeat(Math.ceil(MAX_BODY_BYTES / 4)),
        }),
        "utf8",
      );
      expect(body.byteLength).toBeGreaterThan(MAX_BODY_BYTES);

      await expect(requestNotification(port, body)).resolves.toMatchObject({
        status: 413,
      });
    } finally {
      await stopChild(child);
    }
  });

  it("returns 400 for a malformed Host and keeps serving", async () => {
    const { child, port } = await startDownstream();

    try {
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
