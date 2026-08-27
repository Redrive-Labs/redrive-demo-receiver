CREATE TABLE business_events (
  id SERIAL PRIMARY KEY,
  external_ref TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
