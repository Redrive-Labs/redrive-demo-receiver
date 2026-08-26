# AGENTS.md

## Why this file exists

This repository is worked on by coding agents as well as humans.

The goal is to keep the application conventional, independently runnable, and
easy to reason about.

## Engineering rules

Prefer:

- straightforward TypeScript;
- explicit control flow;
- normal PostgreSQL migrations;
- ordinary Docker Compose;
- clear HTTP boundaries;
- deterministic integration tests.

Avoid:

- unnecessary abstractions;
- large frameworks without concrete need;
- hidden machine-specific setup;
- test-only runtime branches;
- undocumented environment requirements.

## Development environment

Keep these synchronized with actual behavior:

- `README.md`;
- `package.json` scripts;
- `compose.yaml`;
- `.env.example`;
- migrations;
- health checks.

A fresh developer should be able to understand how to run the service from the
repository itself.

## Webhook behavior

Webhook authentication must happen before protected business mutation.

Provider delivery identifiers should remain strings.

Tests should verify behavior from durable PostgreSQL state rather than only
process-local counters.

## External HTTP behavior

Outgoing HTTP integrations should be represented through normal application
code.

Do not hide side effects behind special demo or test branches.

Controlled local dependencies may be used by development and integration tests.

## Scope

Keep this repository a small ordinary webhook receiver.

Do not turn it into:

- a webhook framework;
- an agent runtime;
- a recovery platform;
- a multi-service architecture without need.

## Completion

For each task:

- implement only the assigned behavior;
- add relevant tests;
- run the appropriate validation;
- report exact results and remaining limitations.
