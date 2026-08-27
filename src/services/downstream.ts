import { config } from "../config";
import type { CreatedEvent } from "./events";

const DOWNSTREAM_TIMEOUT_MS = 5_000;
const DOWNSTREAM_DIAGNOSTIC_LIMIT_BYTES = 4096;

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

  const details = await readDiagnosticBody(response);
  throw new Error(
    `Downstream notification rejected with HTTP ${response.status}: ${details}`,
  );
}

async function readDiagnosticBody(response: Response): Promise<string> {
  if (response.body === null) {
    return "";
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let bytesRead = 0;

  try {
    while (bytesRead < DOWNSTREAM_DIAGNOSTIC_LIMIT_BYTES) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }

      if (value === undefined) {
        continue;
      }

      const remaining = DOWNSTREAM_DIAGNOSTIC_LIMIT_BYTES - bytesRead;
      const retainedBytes = Math.min(value.byteLength, remaining);
      const chunk = Buffer.from(value.subarray(0, retainedBytes));
      chunks.push(chunk);
      bytesRead += chunk.byteLength;

      if (bytesRead >= DOWNSTREAM_DIAGNOSTIC_LIMIT_BYTES) {
        try {
          await reader.cancel();
        } catch {
          // Preserve the downstream status and bounded diagnostic if cancellation fails.
        }
        break;
      }
    }
  } finally {
    reader.releaseLock();
  }

  return Buffer.concat(chunks.map((chunk) => Buffer.from(chunk)), bytesRead)
    .toString("utf8");
}
