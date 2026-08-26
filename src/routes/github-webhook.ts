import { createHmac, timingSafeEqual } from "node:crypto";
import express, { Router } from "express";
import { processGithubWebhook } from "../services/github-webhook";

const JSON_BODY_LIMIT = "100kb";

export function createGithubWebhookRouter(webhookSecret: string): Router {
  const router = Router();

  router.post(
    "/",
    express.raw({ type: "*/*", limit: JSON_BODY_LIMIT }),
    (request, response, next) => {
      const rawBody = request.body;
      const signature = request.get("X-Hub-Signature-256");

      if (
        !Buffer.isBuffer(rawBody) ||
        !isValidSignature(signature, rawBody, webhookSecret)
      ) {
        response.status(403).json({
          error: "Invalid webhook signature",
        });
        return;
      }

      next();
    },
    (request, response, next) => {
      if (!Buffer.isBuffer(request.body)) {
        response.status(400).json({
          error: "Invalid JSON body",
        });
        return;
      }

      try {
        request.body = JSON.parse(request.body.toString("utf8"));
        next();
      } catch {
        response.status(400).json({
          error: "Invalid JSON body",
        });
      }
    },
    async (request, response) => {
      const deliveryId = request.get("X-GitHub-Delivery");
      if (deliveryId === undefined || deliveryId.length === 0) {
        response.status(400).json({
          error: "X-GitHub-Delivery header is required",
        });
        return;
      }

      try {
        const event = await processGithubWebhook(deliveryId);

        response.status(201).json({
          id: event.id,
          externalRef: event.externalRef,
          createdAt: event.createdAt,
        });
      } catch (error) {
        console.error("GitHub webhook processing failed", error);
        response.status(500).json({
          error: "Unable to process webhook",
        });
      }
    },
  );

  return router;
}

function isValidSignature(
  signature: string | undefined,
  rawBody: Buffer,
  webhookSecret: string,
): boolean {
  if (signature === undefined) {
    return false;
  }

  const match = /^sha256=([0-9a-f]{64})$/i.exec(signature);
  if (match === null) {
    return false;
  }

  const expected = createHmac("sha256", webhookSecret)
    .update(rawBody)
    .digest();
  const received = Buffer.from(match[1], "hex");

  return (
    received.length === expected.length && timingSafeEqual(received, expected)
  );
}
