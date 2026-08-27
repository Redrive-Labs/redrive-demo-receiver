import { createEvent, type CreatedEvent } from "./events";
import { notifyDownstream } from "./downstream";

export async function processGithubWebhook(
  deliveryId: string,
): Promise<CreatedEvent> {
  const event = await createEvent(deliveryId);
  await notifyDownstream(event);

  return event;
}
