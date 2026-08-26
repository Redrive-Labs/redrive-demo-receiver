import { config } from "../config";
import type { CreatedEvent } from "./events";

export async function notifyDownstream(event: CreatedEvent): Promise<void> {
  const response = await fetch(config.downstreamUrl, {
    method: "POST",
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
