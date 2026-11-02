import type { Channel, Prisma } from "@prisma/client";
import type { DbClient } from "../db";

export type NotificationTemplate =
  | "OTP_SENT"
  | "ORDER_SUBMITTED"
  | "ORDER_APPROVED"
  | "ORDER_REJECTED"
  | "REUPLOAD_REQUESTED"
  | "CONSENT_REQUESTED"
  | "ORDER_PACKED"
  | "OUT_FOR_DELIVERY"
  | "ORDER_DELIVERED"
  | "REFILL_DUE";

/** Adapter boundary for SMS/WhatsApp. Only mock adapters exist in this prototype. */
export interface NotificationAdapter {
  readonly channel: Channel;
  send(message: { userId: string; template: NotificationTemplate }): Promise<{ status: string }>;
}

class MockAdapter implements NotificationAdapter {
  constructor(readonly channel: Channel) {}
  async send() {
    // Nothing leaves the system: the log row below is the only effect.
    return { status: this.channel === "IN_APP" ? "IN_APP" : "MOCK_SENT" };
  }
}

const adapters: Record<Channel, NotificationAdapter> = {
  IN_APP: new MockAdapter("IN_APP"),
  SMS: new MockAdapter("SMS"),
  WHATSAPP: new MockAdapter("WHATSAPP"),
};

/** Metadata must stay non-sensitive: order numbers and template variables, never medicine or health data. */
export async function notify(
  client: DbClient,
  userId: string,
  template: NotificationTemplate,
  metadata: Prisma.InputJsonValue,
  channel: Channel = "SMS",
) {
  const { status } = await adapters[channel].send({ userId, template });
  await client.notificationLog.create({ data: { userId, channel, template, status, metadata } });
}
