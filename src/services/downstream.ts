import { config } from "../config";
import type { CreatedEvent } from "./events";

const DOWNSTREAM_TIMEOUT_MS = 5_000;

export async function notifyDownstream(event: CreatedEvent): Promise<void> {
  const response = await fetch(config.downstreamUrl, {
    method: "POST",
    signal: AbortSignal.timeout(DOWNSTREAM_TIMEOUT_MS),
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      eventId: event.id,
      externalRef: event.externalRef,
    }),
  });

  if (response.ok) {
    return;
  }

  const details = await response.text();
  throw new Error(
    `Downstream notification rejected with HTTP ${response.status}: ${details}`,
  );
}
