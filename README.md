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

- Node.js 22 or newer
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

The service reads `PORT`, `PGHOST`, `PGPORT`, `PGUSER`, `PGPASSWORD`, and
`PGDATABASE`. The example values expect PostgreSQL to be available on the
local machine at port 5432. The Compose application receives its own
container-network values from `compose.yaml`.

## Run with Docker Compose

Compose starts PostgreSQL, waits for its health check, applies migrations, and
starts the application:

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

Run the tests after PostgreSQL is running and migrations have been applied:

```sh
npm test
```

Other checks:

```sh
npm run typecheck
npm run build
```
