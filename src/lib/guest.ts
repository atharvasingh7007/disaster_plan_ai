// Lightweight guest-mode session memory (no DB writes).
const GUEST_KEY = "dr_guest_messages";

export type GuestMsg = { role: "user" | "assistant"; content: string };

export function getGuestMessages(): GuestMsg[] {
  try { return JSON.parse(localStorage.getItem(GUEST_KEY) || "[]"); }
  catch { return []; }
}
export function setGuestMessages(msgs: GuestMsg[]) {
  localStorage.setItem(GUEST_KEY, JSON.stringify(msgs.slice(-40)));
}
export function clearGuest() { localStorage.removeItem(GUEST_KEY); }
