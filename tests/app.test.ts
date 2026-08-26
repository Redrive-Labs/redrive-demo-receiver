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
import { closeDatabase, pool } from "../src/db";

const app = createApp();

beforeEach(async () => {
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
});
