# Event Receiver Service

A small TypeScript HTTP service that exposes health information and persists
ordinary business events in PostgreSQL.

## Stack

- Node.js 22
- TypeScript
- Express
- PostgreSQL 16
- `pg`
- Docker Compose
- Vitest

## Prerequisites

- Node.js >=22.12.0
- npm
- Docker Engine with the Docker Compose plugin

## Install dependencies

```sh
npm install
```

## Configuration

Copy the example configuration for local, non-Compose commands:

```sh
cp .env.example .env
```

The service reads `PORT`, `WEBHOOK_SECRET`, `DOWNSTREAM_URL`, `PGHOST`,
`PGPORT`, `PGUSER`, `PGPASSWORD`, and `PGDATABASE`. `WEBHOOK_SECRET` must match
the secret used to sign GitHub webhook requests. `DOWNSTREAM_URL` points to the
notification service endpoint. The example values expect the downstream
service to be available on the local machine at port 4000 and PostgreSQL at
port 5432. The Compose application receives its own container-network values
from `compose.yaml`.

## Run with Docker Compose

Compose starts PostgreSQL and the downstream service, waits for their health
checks, applies migrations, and starts the application:

```sh
docker compose up --build
```

The HTTP service is available at `http://localhost:3000`. Stop the services
with `Ctrl-C`, or run:

```sh
docker compose down
```

PostgreSQL data is stored in the named `postgres-data` volume.

## Run migrations

The migration command uses the configured PostgreSQL environment variables:

```sh
npm run db:migrate
```

When using Compose, migrations are run automatically before the application
starts. They can also be run in the application container:

```sh
docker compose run --rm app npm run db:migrate
```

## Run the application locally

With PostgreSQL running and `.env` configured:

```sh
npm run dev
```

For a compiled run:

```sh
npm run build
npm start
```

## HTTP endpoints

### Health

```http
GET /health
```

Returns HTTP 200 and checks PostgreSQL with a lightweight query:

```json
{
  "status": "ok",
  "database": "ok"
}
```

If PostgreSQL cannot be queried, the endpoint returns HTTP 503 and does not
report the database as healthy.

### GitHub webhook

```http
POST /webhooks/github
Content-Type: application/json
X-Hub-Signature-256: sha256=<HMAC-SHA256 hex digest>
X-GitHub-Delivery: <delivery ID>
```

The request body is verified using the exact received bytes before the
authenticated JSON payload is processed. A valid request records one
`business_events` row using the delivery ID as its opaque external reference,
then sends a notification to the downstream service. The downstream contract
expects `eventId` and `deliveryId`, while the receiver currently sends
`eventId` and `externalRef`, so the downstream responds with HTTP 422 and the
webhook returns HTTP 500. Replaying the same delivery records another row and
also returns HTTP 500.

### Create an event

```http
POST /events
Content-Type: application/json
```

Example request:

```json
{
  "externalRef": "example-123"
}
```

Successful requests return HTTP 201 with the persisted event:

```json
{
  "id": 1,
  "externalRef": "example-123",
  "createdAt": "2025-01-01T00:00:00.000Z"
}
```

## Validate the project

Run the tests after PostgreSQL and the downstream service are running and
migrations have been applied:

```sh
docker compose up -d postgres downstream
docker compose exec postgres createdb -U receiver receiver_test
PGDATABASE=receiver_test npm run db:migrate
npm test
```

Tests always target the dedicated `receiver_test` database. Their destructive
cleanup refuses to run against another database. The `createdb` command is
needed once for a fresh PostgreSQL instance.

Other checks:

```sh
npm run typecheck
npm run build
```
