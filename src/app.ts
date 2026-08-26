import express, {
  type ErrorRequestHandler,
  type Express,
  type NextFunction,
  type Request,
  type Response,
} from "express";
import { config } from "./config";
import { createEventsRouter } from "./routes/events";
import { createGithubWebhookRouter } from "./routes/github-webhook";
import { createHealthRouter } from "./routes/health";

export function createApp(): Express {
  const app = express();

  app.disable("x-powered-by");
  app.use(
    "/webhooks/github",
    createGithubWebhookRouter(config.webhookSecret),
  );
  app.use(express.json({ limit: "100kb" }));
  app.use("/health", createHealthRouter());
  app.use("/events", createEventsRouter());

  app.use((_request, response) => {
    response.status(404).json({
      error: "Not found",
    });
  });

  const errorHandler: ErrorRequestHandler = (
    error: unknown,
    _request: Request,
    response: Response,
    _next: NextFunction,
  ) => {
    if (isJsonParseError(error)) {
      response.status(400).json({
        error: "Invalid JSON body",
      });
      return;
    }

    if (isPayloadTooLargeError(error)) {
      response.status(413).json({
        error: "Request body too large",
      });
      return;
    }

    console.error("Unhandled application error", error);
    response.status(500).json({
      error: "Internal server error",
    });
  };

  app.use(errorHandler);

  return app;
}

function isJsonParseError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "type" in error &&
    error.type === "entity.parse.failed"
  );
}

function isPayloadTooLargeError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "type" in error &&
    error.type === "entity.too.large"
  );
}
