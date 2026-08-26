import { Router } from "express";
import { createEvent } from "../services/events";

export function createEventsRouter(): Router {
  const router = Router();

  router.post("/", async (request, response) => {
    const body = request.body;
    const externalRef =
      body !== null &&
      typeof body === "object" &&
      !Array.isArray(body) &&
      "externalRef" in body
        ? body.externalRef
        : undefined;

    if (
      typeof externalRef !== "string" ||
      externalRef.trim().length === 0 ||
      externalRef.length > 255
    ) {
      response.status(400).json({
        error:
          "externalRef must be a non-empty string of 255 characters or fewer",
      });
      return;
    }

    try {
      const event = await createEvent(externalRef.trim());

      response.status(201).json({
        id: event.id,
        externalRef: event.externalRef,
        createdAt: event.createdAt,
      });
    } catch (error) {
      console.error("Event creation failed", error);
      response.status(500).json({
        error: "Unable to create event",
      });
    }
  });

  return router;
}
