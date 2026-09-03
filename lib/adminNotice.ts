/**
 * What the moderator console says back, and how loudly.
 *
 * THE DEFECT THIS EXISTS FOR: the console decided whether a line was announced
 * by matching its own copy (`message.startsWith("Not authorised")`), so a
 * refusal worded any other way rendered as a quiet `role="status"` a screen
 * reader may never speak. A notice carries its own tone, because the code that
 * writes a line is the only code that knows whether it is a refusal.
 */

export type AdminNoticeTone = "alert" | "status";

export type AdminNotice = {
  text: string;
  tone: AdminNoticeTone;
};

/** Something went wrong, or was refused. Announced. */
export function adminAlert(text: string): AdminNotice {
  return { text, tone: "alert" };
}

/** A receipt for something that worked. Polite. */
export function adminStatus(text: string): AdminNotice {
  return { text, tone: "status" };
}
