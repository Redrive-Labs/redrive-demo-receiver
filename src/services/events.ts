import { pool } from "../db";

interface BusinessEventRow {
  id: number;
  external_ref: string;
  created_at: Date;
}

export interface CreatedEvent {
  id: number;
  externalRef: string;
  createdAt: Date;
}

export async function createEvent(externalRef: string): Promise<CreatedEvent> {
  const result = await pool.query<BusinessEventRow>(
    `
      INSERT INTO business_events (external_ref)
      VALUES ($1)
      RETURNING id, external_ref, created_at
    `,
    [externalRef],
  );
  const event = result.rows[0];

  return {
    id: event.id,
    externalRef: event.external_ref,
    createdAt: event.created_at,
  };
}
