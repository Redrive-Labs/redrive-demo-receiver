import { createHmac } from "node:crypto";
import { request as httpRequest } from "node:http";
import { gzipSync } from "node:zlib";
import request from "supertest";
import {
  afterAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { createApp } from "../src/app";
import { config } from "../src/config";
import { closeDatabase, pool } from "../src/db";
import { notifyDownstream } from "../src/services/downstream";
import { assertTestDatabase } from "./test-database";

const app = createApp();

function sign(body: Buffer): string {
  return `sha256=${createHmac("sha256", config.webhookSecret)
    .update(body)
    .digest("hex")}`;
}

async function readBusinessEvents(): Promise<
  Array<{ id: number; external_ref: string }>
> {
  const result = await pool.query<{
    id: number;
    external_ref: string;
  }>(
    `
      SELECT id, external_ref
      FROM business_events
      ORDER BY id
    `,
  );

  return result.rows;
}

async function readBusinessEventsFor(
  externalRef: string,
): Promise<Array<{ id: number; external_ref: string }>> {
  const result = await pool.query<{
    id: number;
    external_ref: string;
  }>(
    `
      SELECT id, external_ref
      FROM business_events
      WHERE external_ref = $1
      ORDER BY id
    `,
    [externalRef],
  );

  return result.rows;
}

beforeEach(async () => {
  assertTestDatabase(config.database.database);
  await pool.query("TRUNCATE TABLE business_events RESTART IDENTITY");
});

afterAll(async () => {
  await closeDatabase();
});

describe("GET /health", () => {
  it("reports a reachable database as healthy", async () => {
    const response = await request(app).get("/health");

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      status: "ok",
      database: "ok",
    });
  });

  it("does not report a failed database check as healthy", async () => {
    const query = vi
      .spyOn(pool, "query")
      .mockRejectedValueOnce(new Error("database unavailable"));

    try {
      const response = await request(app).get("/health");

      expect(response.status).toBe(503);
      expect(response.body).toEqual({
        status: "error",
        database: "error",
      });
    } finally {
      query.mockRestore();
    }
  });
});

describe("POST /events", () => {
  it("persists a valid event in PostgreSQL", async () => {
    const response = await request(app)
      .post("/events")
      .send({ externalRef: "example-123" });

    expect(response.status).toBe(201);
    expect(response.body).toMatchObject({
      id: expect.any(Number),
      externalRef: "example-123",
      createdAt: expect.any(String),
    });

    const persisted = await pool.query<{
      id: number;
      external_ref: string;
      created_at: Date;
    }>(
      `
        SELECT id, external_ref, created_at
        FROM business_events
        WHERE id = $1
      `,
      [response.body.id],
    );

    expect(persisted.rows).toHaveLength(1);
    expect(persisted.rows[0]).toMatchObject({
      id: response.body.id,
      external_ref: "example-123",
    });
    expect(persisted.rows[0].created_at).toBeInstanceOf(Date);
  });

  it.each([
    {},
    { externalRef: "" },
    { externalRef: "   " },
    { externalRef: 123 },
  ])("rejects invalid input %#", async (body) => {
    const response = await request(app).post("/events").send(body);

    expect(response.status).toBe(400);
    expect(response.body).toEqual({
      error:
        "externalRef must be a non-empty string of 255 characters or fewer",
    });
  });

  it("returns 400 for malformed JSON", async () => {
    const response = await request(app)
      .post("/events")
      .set("Content-Type", "application/json")
      .send('{"externalRef":');

    expect(response.status).toBe(400);
    expect(response.body).toEqual({
      error: "Invalid JSON body",
    });
  });

  it("returns 413 when the JSON body exceeds the parser limit", async () => {
    const response = await request(app)
      .post("/events")
      .set("Content-Type", "application/json")
      .send({ externalRef: "x".repeat(101 * 1024) });

    expect(response.status).toBe(413);
    expect(response.body).toEqual({
      error: "Request body too large",
    });
  });
});

describe("downstream notifications", () => {
  it("propagates the real downstream contract rejection", async () => {
    await expect(
      notifyDownstream({
        id: 1,
        externalRef: "delivery-contract-check",
        createdAt: new Date(),
      }),
    ).rejects.toThrow(
      'Downstream notification rejected with HTTP 422: {"error":"invalid_notification","message":"deliveryId is required"}',
    );
  });

  it("bounds a large non-2xx diagnostic to 4096 bytes", async () => {
    const cancelReasons: unknown[] = [];
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(Buffer.from("x".repeat(5_000), "utf8"));
        controller.enqueue(Buffer.from("tail", "utf8"));
      },
      cancel(reason) {
        cancelReasons.push(reason);
      },
    });
    const fetch = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(body, { status: 503 }));

    try {
      let error: unknown;
      try {
        await notifyDownstream({
          id: 1,
          externalRef: "diagnostic-limit-check",
          createdAt: new Date(),
        });
      } catch (caught) {
        error = caught;
      }

      expect(error).toBeInstanceOf(Error);
      const message = (error as Error).message;
      const prefix = "Downstream notification rejected with HTTP 503: ";
      expect(message).toBe(`${prefix}${"x".repeat(4_096)}`);
      expect(message).toHaveLength(prefix.length + 4_096);
      expect(cancelReasons).toHaveLength(1);
    } finally {
      fetch.mockRestore();
    }
  });

  it("aborts a downstream request that does not complete", async () => {
    const timeoutController = new AbortController();
    const timeout = vi
      .spyOn(AbortSignal, "timeout")
      .mockReturnValue(timeoutController.signal);
    const fetch = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation((_input, init) => {
        const signal = init?.signal;
        if (signal === undefined || signal === null) {
          return Promise.reject(new Error("missing abort signal"));
        }

        return new Promise<Response>((_resolve, reject) => {
          signal.addEventListener("abort", () => reject(signal.reason));
        });
      });

    try {
      const notification = notifyDownstream({
        id: 1,
        externalRef: "delivery-timeout-check",
        createdAt: new Date(),
      });
      timeoutController.abort(new Error("downstream request timed out"));

      await expect(notification).rejects.toThrow(
        "downstream request timed out",
      );
      expect(timeout).toHaveBeenCalledWith(5_000);
      expect(fetch).toHaveBeenCalledTimes(1);
    } finally {
      fetch.mockRestore();
      timeout.mockRestore();
    }
  });
});

describe("POST /webhooks/github", () => {
  it("returns 500 after committing one event", async () => {
    const body = Buffer.from(
      '{"action":"opened","repository":{"full_name":"octo/example"}}',
      "utf8",
    );
    const deliveryId = "90071992547409931234567890";

    const response = await request(app)
      .post("/webhooks/github")
      .set("Content-Type", "application/json")
      .set("X-Hub-Signature-256", sign(body))
      .set("X-GitHub-Delivery", deliveryId)
      .send(body.toString("utf8"));

    expect(response.status).toBe(500);
    expect(response.body).toEqual({
      error: "Unable to process webhook",
    });
    await expect(readBusinessEventsFor(deliveryId)).resolves.toEqual([
      {
        id: 1,
        external_ref: deliveryId,
      },
    ]);
  });

  it("maps a downstream timeout to 500 after committing the event", async () => {
    const body = Buffer.from('{"action":"opened"}', "utf8");
    const deliveryId = "delivery-timeout-webhook";
    const timeoutController = new AbortController();
    const timeout = vi
      .spyOn(AbortSignal, "timeout")
      .mockReturnValue(timeoutController.signal);
    let fetchStarted!: () => void;
    const started = new Promise<void>((resolve) => {
      fetchStarted = resolve;
    });
    const fetch = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation((_input, init) => {
        const signal = init?.signal;
        fetchStarted();
        if (signal === undefined || signal === null) {
          return Promise.reject(new Error("missing abort signal"));
        }

        return new Promise<Response>((_resolve, reject) => {
          if (signal.aborted) {
            reject(signal.reason);
            return;
          }
          signal.addEventListener("abort", () => reject(signal.reason));
        });
      });

    try {
      const pendingResponse = request(app)
        .post("/webhooks/github")
        .set("Content-Type", "application/json")
        .set("X-Hub-Signature-256", sign(body))
        .set("X-GitHub-Delivery", deliveryId)
        .send(body.toString("utf8"));
      const responsePromise = pendingResponse.then((result) => result);

      await started;
      timeoutController.abort(new Error("downstream request timed out"));
      const response = await responsePromise;

      expect(response.status).toBe(500);
      expect(response.body).toEqual({
        error: "Unable to process webhook",
      });
      expect(timeout).toHaveBeenCalledWith(5_000);
      await expect(readBusinessEventsFor(deliveryId)).resolves.toEqual([
        {
          id: 1,
          external_ref: deliveryId,
        },
      ]);
    } finally {
      fetch.mockRestore();
      timeout.mockRestore();
    }
  });

  it("commits another event when the exact delivery is replayed", async () => {
    const body = Buffer.from('{"action":"opened"}', "utf8");
    const deliveryId = "delivery-replayed-as-opaque-text-9007199254740993";
    const signature = sign(body);

    const firstResponse = await request(app)
      .post("/webhooks/github")
      .set("Content-Type", "application/json")
      .set("X-Hub-Signature-256", signature)
      .set("X-GitHub-Delivery", deliveryId)
      .send(body.toString("utf8"));

    expect(firstResponse.status).toBe(500);
    await expect(readBusinessEventsFor(deliveryId)).resolves.toHaveLength(1);

    const replayResponse = await request(app)
      .post("/webhooks/github")
      .set("Content-Type", "application/json")
      .set("X-Hub-Signature-256", signature)
      .set("X-GitHub-Delivery", deliveryId)
      .send(body.toString("utf8"));

    expect(replayResponse.status).toBe(500);
    await expect(readBusinessEventsFor(deliveryId)).resolves.toEqual([
      {
        id: 1,
        external_ref: deliveryId,
      },
      {
        id: 2,
        external_ref: deliveryId,
      },
    ]);
  });

  it("rejects an incorrect signature without mutating PostgreSQL", async () => {
    const body = Buffer.from('{"action":"opened"}', "utf8");
    const signatureBody = Buffer.from('{"action":"closed"}', "utf8");

    const response = await request(app)
      .post("/webhooks/github")
      .set("Content-Type", "application/json")
      .set("X-Hub-Signature-256", sign(signatureBody))
      .set("X-GitHub-Delivery", "delivery-incorrect")
      .send(body.toString("utf8"));

    expect(response.status).toBe(403);
    expect(response.body).toEqual({
      error: "Invalid webhook signature",
    });
    await expect(readBusinessEvents()).resolves.toEqual([]);
  });

  it("rejects a missing signature without mutating PostgreSQL", async () => {
    const body = Buffer.from('{"action":"opened"}', "utf8");

    const response = await request(app)
      .post("/webhooks/github")
      .set("Content-Type", "application/json")
      .set("X-GitHub-Delivery", "delivery-missing")
      .send(body.toString("utf8"));

    expect(response.status).toBe(403);
    expect(response.body).toEqual({
      error: "Invalid webhook signature",
    });
    await expect(readBusinessEvents()).resolves.toEqual([]);
  });

  it("rejects gzip webhook bodies before parsing or mutating PostgreSQL", async () => {
    const body = Buffer.from('{"action":"opened"}', "utf8");
    const encodedBody = gzipSync(body);
    const server = createApp().listen(0, "127.0.0.1");

    try {
      await new Promise<void>((resolve, reject) => {
        server.once("listening", () => resolve());
        server.once("error", (error) => reject(error));
      });

      const address = server.address();
      if (address === null || typeof address === "string") {
        throw new Error("Test server did not expose a TCP address");
      }

      const response = await new Promise<{
        statusCode: number | undefined;
        body: string;
      }>((resolve, reject) => {
        const clientRequest = httpRequest(
          {
            hostname: "127.0.0.1",
            port: address.port,
            path: "/webhooks/github",
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "Content-Encoding": "gzip",
              "Content-Length": encodedBody.length,
              "X-Hub-Signature-256": sign(encodedBody),
              "X-GitHub-Delivery": "delivery-encoded",
              Connection: "close",
            },
          },
          (incomingResponse) => {
            const chunks: Buffer[] = [];
            incomingResponse.on("data", (chunk: Buffer) => chunks.push(chunk));
            incomingResponse.on("end", () =>
              resolve({
                statusCode: incomingResponse.statusCode,
                body: Buffer.concat(chunks).toString("utf8"),
              }),
            );
            incomingResponse.on("error", reject);
          },
        );

        clientRequest.on("error", reject);
        clientRequest.end(encodedBody);
      });

      expect(response.statusCode).toBe(415);
      expect(JSON.parse(response.body)).toEqual({
        error: "Unsupported Content-Encoding",
      });
      await expect(readBusinessEvents()).resolves.toEqual([]);
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) {
            reject(error);
            return;
          }
          resolve();
        });
      });
    }
  });

  it("rejects a signature calculated over different bytes", async () => {
    const body = Buffer.from('{"action":"opened","number":1}', "utf8");
    const signatureBody = Buffer.from(
      '{ "action": "opened", "number": 1 }',
      "utf8",
    );

    const response = await request(app)
      .post("/webhooks/github")
      .set("Content-Type", "application/json")
      .set("X-Hub-Signature-256", sign(signatureBody))
      .set("X-GitHub-Delivery", "delivery-different-bytes")
      .send(body.toString("utf8"));

    expect(response.status).toBe(403);
    await expect(readBusinessEvents()).resolves.toEqual([]);
  });

  it("rejects a malformed signature", async () => {
    const body = Buffer.from('{"action":"opened"}', "utf8");

    const response = await request(app)
      .post("/webhooks/github")
      .set("Content-Type", "application/json")
      .set("X-Hub-Signature-256", "sha256=not-a-digest")
      .set("X-GitHub-Delivery", "delivery-malformed")
      .send(body.toString("utf8"));

    expect(response.status).toBe(403);
    await expect(readBusinessEvents()).resolves.toEqual([]);
  });

  it("keeps malformed JSON at 400 after authenticating the raw bytes", async () => {
    const body = Buffer.from('{"action":"opened"', "utf8");

    const response = await request(app)
      .post("/webhooks/github")
      .set("Content-Type", "application/json")
      .set("X-Hub-Signature-256", sign(body))
      .set("X-GitHub-Delivery", "delivery-malformed-json")
      .send(body.toString("utf8"));

    expect(response.status).toBe(400);
    expect(response.body).toEqual({
      error: "Invalid JSON body",
    });
    await expect(readBusinessEvents()).resolves.toEqual([]);
  });

  it("keeps oversized JSON at 413", async () => {
    const body = Buffer.from(
      JSON.stringify({ payload: "x".repeat(101 * 1024) }),
      "utf8",
    );

    const response = await request(app)
      .post("/webhooks/github")
      .set("Content-Type", "application/json")
      .set("X-Hub-Signature-256", sign(body))
      .set("X-GitHub-Delivery", "delivery-oversized")
      .send(body.toString("utf8"));

    expect(response.status).toBe(413);
    expect(response.body).toEqual({
      error: "Request body too large",
    });
    await expect(readBusinessEvents()).resolves.toEqual([]);
  });

  it("requires a delivery ID after authentication", async () => {
    const body = Buffer.from('{"action":"opened"}', "utf8");

    const response = await request(app)
      .post("/webhooks/github")
      .set("Content-Type", "application/json")
      .set("X-Hub-Signature-256", sign(body))
      .send(body.toString("utf8"));

    expect(response.status).toBe(400);
    expect(response.body).toEqual({
      error: "X-GitHub-Delivery header is required",
    });
    await expect(readBusinessEvents()).resolves.toEqual([]);
  });

  it("rejects correctly signed malformed UTF-8 without mutating PostgreSQL", async () => {
    const body = Buffer.concat([
      Buffer.from('{"payload":"', "utf8"),
      Buffer.from([0x80]),
      Buffer.from('"}', "utf8"),
    ]);

    const response = await request(app)
      .post("/webhooks/github")
      .set("Content-Type", "application/octet-stream")
      .set("X-Hub-Signature-256", sign(body))
      .set("X-GitHub-Delivery", "delivery-malformed-utf8")
      .send(body);

    expect(response.status).toBe(400);
    expect(response.body).toEqual({
      error: "Invalid JSON body",
    });

    await expect(readBusinessEvents()).resolves.toEqual([]);
  });
});
