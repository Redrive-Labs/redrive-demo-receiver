import { createEvent, type CreatedEvent } from "./events";

export async function processGithubWebhook(
  deliveryId: string,
): Promise<CreatedEvent> {
  const event = await createEvent(deliveryId);
  postProcessEvent(event);

  return event;
}

function postProcessEvent(event: CreatedEvent): void {
  throw new Error(`Unable to complete processing for event ${event.id}`);
}
