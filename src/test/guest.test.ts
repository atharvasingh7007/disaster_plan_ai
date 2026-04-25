import { describe, it, expect, beforeEach } from "vitest";

/**
 * Mock localStorage for testing guest persistence
 */
const store: Record<string, string> = {};
const localStorageMock = {
  getItem: (key: string) => store[key] ?? null,
  setItem: (key: string, val: string) => { store[key] = val; },
  removeItem: (key: string) => { delete store[key]; },
  clear: () => { Object.keys(store).forEach((k) => delete store[k]); },
};
Object.defineProperty(globalThis, "localStorage", { value: localStorageMock });

// Import after mocking localStorage
import { getGuestMessages, setGuestMessages, clearGuest } from "@/lib/guest";

describe("guest.ts — localStorage guest message storage", () => {
  beforeEach(() => {
    localStorageMock.clear();
  });

  it("returns empty array when no messages stored", () => {
    expect(getGuestMessages()).toEqual([]);
  });

  it("stores and retrieves messages", () => {
    const msgs = [
      { role: "user" as const, content: "hello" },
      { role: "assistant" as const, content: "hi there" },
    ];
    setGuestMessages(msgs);
    const result = getGuestMessages();
    expect(result).toEqual(msgs);
  });

  it("caps stored messages at 40", () => {
    const msgs = Array.from({ length: 60 }, (_, i) => ({
      role: (i % 2 === 0 ? "user" : "assistant") as "user" | "assistant",
      content: `message ${i}`,
    }));
    setGuestMessages(msgs);
    const result = getGuestMessages();
    expect(result.length).toBe(40);
    // Should keep the LAST 40 messages
    expect(result[0].content).toBe("message 20");
    expect(result[39].content).toBe("message 59");
  });

  it("clearGuest removes messages", () => {
    setGuestMessages([{ role: "user", content: "test" }]);
    clearGuest();
    expect(getGuestMessages()).toEqual([]);
  });

  it("handles corrupted localStorage gracefully", () => {
    localStorageMock.setItem("dr_guest_messages", "not valid json{{");
    expect(getGuestMessages()).toEqual([]);
  });
});
