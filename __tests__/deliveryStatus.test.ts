import { describe, expect, it } from "vitest";

import type { DeliveryStatus } from "@/lib/deliveryStatus";
import type { EmailDeliveryStatus } from "@/lib/emailProvider";
import type { PushDeliveryStatus } from "@/lib/pushProvider";

// Principle 22: things that must agree need one owner. Push and email status
// unions are aliases of DeliveryStatus - assignability both ways is the pin.

describe("DeliveryStatus single owner", () => {
  it("push and email statuses accept every DeliveryStatus value", () => {
    const values: DeliveryStatus[] = ["sent", "skipped", "invalid", "error"];
    const push: PushDeliveryStatus[] = values;
    const email: EmailDeliveryStatus[] = values;
    expect(push).toEqual(values);
    expect(email).toEqual(values);
  });

  it("DeliveryStatus accepts push and email values (no drift)", () => {
    const fromPush: DeliveryStatus = "sent" satisfies PushDeliveryStatus;
    const fromEmail: DeliveryStatus = "invalid" satisfies EmailDeliveryStatus;
    expect(fromPush).toBe("sent");
    expect(fromEmail).toBe("invalid");
  });
});
