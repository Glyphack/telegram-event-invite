import { env, SELF } from "cloudflare:test";
import { describe, it, expect, beforeEach } from "vitest";
import {
  Store,
  CalendarEvent,
  formatDatetime,
  isoToCompact,
  isValidEmail,
  parseModelEvent,
  type Env,
} from "../src/index";

const testEnv = env as Env;
const store = new Store(testEnv.DB);

// --- DB tests ---

describe("user operations", () => {
  beforeEach(async () => {
    await testEnv.DB.exec("DELETE FROM users");
  });

  it("returns null for unknown user", async () => {
    expect(await store.getUser(999)).toBeNull();
  });

  it("sets and gets email", async () => {
    const user = await store.setEmail(1, "a@b.com");
    expect(user.userId).toBe(1);
    expect(user.email).toBe("a@b.com");
    expect((await store.getUser(1))?.email).toBe("a@b.com");
  });

  it("upserts email", async () => {
    await store.setEmail(1, "old@b.com");
    await store.setEmail(1, "new@b.com");
    expect((await store.getUser(1))?.email).toBe("new@b.com");
  });
});

describe("RSVP operations", () => {
  beforeEach(async () => {
    await testEnv.DB.exec("DELETE FROM rsvps");
    await testEnv.DB.exec("DELETE FROM users");
  });

  it("adds and retrieves RSVPs", async () => {
    await store.addRsvp("msg1", 10);
    await store.addRsvp("msg1", 20);
    const rsvps = await store.getRsvps("msg1");
    expect(rsvps).toHaveLength(2);
    expect(rsvps.map((r) => r.userId).sort()).toEqual([10, 20]);
  });

  it("removes RSVP", async () => {
    await store.addRsvp("msg1", 10);
    await store.addRsvp("msg1", 20);
    await store.removeRsvp("msg1", 10);
    const rsvps = await store.getRsvps("msg1");
    expect(rsvps).toHaveLength(1);
    expect(rsvps[0].userId).toBe(20);
  });

  it("returns empty for unknown message", async () => {
    expect(await store.getRsvps("nope")).toEqual([]);
  });

  it("INSERT OR REPLACE on duplicate", async () => {
    await store.addRsvp("msg1", 10);
    await store.addRsvp("msg1", 10);
    expect(await store.getRsvps("msg1")).toHaveLength(1);
  });

  it("joins rsvps with users to get emails", async () => {
    await store.setEmail(10, "a@test.com");
    await store.setEmail(20, "b@test.com");
    await store.addRsvp("msg1", 10);
    await store.addRsvp("msg1", 20);
    await store.addRsvp("msg1", 30); // no email set
    const emails = await store.getRsvpEmails("msg1");
    expect(emails.sort()).toEqual(["a@test.com", "b@test.com"]);
  });

  it("returns empty emails when no RSVPs", async () => {
    expect(await store.getRsvpEmails("none")).toEqual([]);
  });
});

// --- Callback data encoding ---

describe("callback data encoding", () => {
  it("round-trips", () => {
    const event = new CalendarEvent("Dinner", "20250101T000000", "20250101T020000");
    const encoded = event.callbackData("y", 123456789);
    const decoded = CalendarEvent.fromCallback(encoded);
    expect(decoded.action).toBe("y");
    expect(decoded.organizerId).toBe(123456789);
    expect(decoded.event.title).toBe("Dinner");
    expect(decoded.event.start).toBe("20250101T000000");
    expect(decoded.event.end).toBe("20250101T020000");
  });

  it("truncates long titles to fit 64 bytes", () => {
    const event = new CalendarEvent("A".repeat(50), "20250101T000000", "20250101T020000");
    const encoded = event.callbackData("y", 123456789);
    expect(new TextEncoder().encode(encoded).length).toBeLessThanOrEqual(64);
    const decoded = CalendarEvent.fromCallback(encoded);
    expect(decoded.action).toBe("y");
    expect(decoded.event.start).toBe("20250101T000000");
  });

  it("handles title with colons", () => {
    const event = new CalendarEvent("A:B", "19700101T000140", "19700101T000320");
    const encoded = event.callbackData("y", 1);
    const decoded = CalendarEvent.fromCallback(encoded);
    expect(decoded.event.title).toBe("A:B");
    expect(decoded.event.start).toBe("19700101T000140");
    expect(decoded.event.end).toBe("19700101T000320");
    expect(decoded.organizerId).toBe(1);
  });

  it("throws when the times alone exceed 64 bytes", () => {
    const event = new CalendarEvent("x", "20250101T000000", "20250101T020000");
    expect(() => event.callbackData("a".repeat(64), 123456789)).toThrow();
  });
});

// --- Helpers ---

describe("googleCalendarUrl", () => {
  it("builds URL with no emails", () => {
    const event = new CalendarEvent("Dinner", "20250101T190000Z", "20250101T210000Z");
    const url = event.googleCalendarUrl([]);
    expect(url).toContain("text=Dinner");
    expect(url).toContain("dates=20250101T190000/20250101T210000");
    expect(url).not.toContain("add=");
  });

  it("builds URL with one email", () => {
    const event = new CalendarEvent("Dinner", "20250101T190000Z", "20250101T210000Z");
    const url = event.googleCalendarUrl(["a@b.com"]);
    expect(url).toContain("add=a%40b.com");
  });

  it("builds URL with multiple emails", () => {
    const event = new CalendarEvent("Dinner", "20250101T190000Z", "20250101T210000Z");
    const url = event.googleCalendarUrl(["a@b.com", "c@d.com"]);
    expect(decodeURIComponent(url)).toContain("a@b.com,c@d.com");
  });
});

describe("formatDatetime", () => {
  it("formats compact datetime", () => {
    expect(formatDatetime("20250101T190000Z")).toBe("Wednesday the 1st of January 2025 19:00");
  });

  it("handles ordinal suffixes", () => {
    expect(formatDatetime("20250102T100000Z")).toContain("2nd");
    expect(formatDatetime("20250103T100000Z")).toContain("3rd");
    expect(formatDatetime("20250104T100000Z")).toContain("4th");
    expect(formatDatetime("20250121T100000Z")).toContain("21st");
    expect(formatDatetime("20250122T100000Z")).toContain("22nd");
    expect(formatDatetime("20250123T100000Z")).toContain("23rd");
  });
});

describe("event message", () => {
  it("shows no RSVPs when empty", () => {
    const event = new CalendarEvent("Dinner", "20250101T190000Z", "20250101T210000Z");
    const msg = event.message([]);
    expect(msg).toContain("No RSVPs yet");
    expect(msg).toContain("Dinner");
    expect(msg).toContain("Wednesday the 1st of January 2025 19:00");
  });

  it("shows attendee names", () => {
    const event = new CalendarEvent("Dinner", "20250101T190000Z", "20250101T210000Z");
    const msg = event.message(["Alice", "Bob"]);
    expect(msg).toContain("Alice, Bob");
    expect(msg).not.toContain("No RSVPs yet");
  });
});

describe("event keyboard", () => {
  it("creates keyboard with four buttons", () => {
    const event = new CalendarEvent("Dinner", "20250101T000000Z", "20250101T020000Z");
    const kb = event.keyboard(123);
    expect(kb).toHaveLength(2);
    expect(kb[0]).toHaveLength(2);
    expect(kb[0][0].text).toBe("I'm in");
    expect(kb[0][0].callback_data).toBeDefined();
    expect(kb[0][1].text).toBe("I'm out");
    expect(kb[1][0].text).toBe("Save to Google Calendar");
    expect(kb[1][0].url).toContain("calendar.google.com");
    expect(kb[1][1].text).toBe("Set your email");
    expect(kb[1][1].url).toBe("https://t.me/tinyinvitebot?start=set_email");
  });
});

describe("joined notice", () => {
  it("names the attendee and the event", () => {
    const event = new CalendarEvent("Dinner", "20250101T000000Z", "20250101T020000Z");
    expect(event.joinedNotice("Alice")).toBe('Alice has joined your event "Dinner". Send it out if you\'re done.');
  });

  it("builds a calendar button with the attendee emails", () => {
    const event = new CalendarEvent("Dinner", "20250101T000000Z", "20250101T020000Z");
    const button = event.calendarButton(["a@b.com"]);
    expect(button.text).toBe("Save to Google Calendar");
    expect(button.url).toContain("add=a%40b.com");
  });
});

describe("isValidEmail", () => {
  it("accepts a normal address", () => {
    expect(isValidEmail("a@b.com")).toBe(true);
  });

  it("rejects missing @ or domain", () => {
    expect(isValidEmail("not-an-email")).toBe(false);
    expect(isValidEmail("a@b")).toBe(false);
  });

  it("rejects whitespace", () => {
    expect(isValidEmail("a b@c.com")).toBe(false);
    expect(isValidEmail("")).toBe(false);
  });
});

// --- Model output parsing ---

describe("isoToCompact", () => {
  it("converts an ISO local datetime to compact", () => {
    expect(isoToCompact("2026-06-16T15:00:00")).toBe("20260616T150000");
  });

  it("defaults seconds to 00 when omitted", () => {
    expect(isoToCompact("2026-06-16T15:00")).toBe("20260616T150000");
  });

  it("tolerates surrounding whitespace", () => {
    expect(isoToCompact("  2026-12-25T09:30:00  ")).toBe("20261225T093000");
  });

  it("throws on an unparseable value", () => {
    expect(() => isoToCompact("not a date")).toThrow();
  });
});

describe("parseModelEvent", () => {
  it("extracts the event JSON from a plain response", () => {
    const parsed = parseModelEvent('{"title":"Lunch","start":"2026-06-16T12:00:00","end":"2026-06-16T13:00:00"}');
    expect(parsed.title).toBe("Lunch");
    expect(parsed.start).toBe("2026-06-16T12:00:00");
    expect(parsed.end).toBe("2026-06-16T13:00:00");
  });

  it("ignores reasoning and prose around the JSON", () => {
    const raw = '<think>the user means tomorrow noon</think>\nHere you go:\n{"title":"Climb","start":"2026-06-17T12:00:00","end":"2026-06-17T13:00:00"}';
    const parsed = parseModelEvent(raw);
    expect(parsed.title).toBe("Climb");
    expect(parsed.start).toBe("2026-06-17T12:00:00");
  });

  it("throws when no start is present", () => {
    expect(() => parseModelEvent('{"title":"x"}')).toThrow();
  });
});

// --- HTTP endpoint tests ---

describe("webhook routing", () => {
  it("returns 200 for callback_query", async () => {
    const res = await SELF.fetch("http://localhost/webhook", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        update_id: 1,
        callback_query: {
          id: "cb1",
          from: { id: 10, is_bot: false, first_name: "Test" },
          inline_message_id: "msg1",
          data: "y:Dinner:1735689600:1735696800:10",
        },
      }),
    });
    expect(res.status).toBe(200);
  });

  it("returns 200 for inline_query update", async () => {
    const res = await SELF.fetch("http://localhost/webhook", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        update_id: 2,
        inline_query: { id: "q1", from: { id: 123, is_bot: false, first_name: "Test" }, query: "", offset: "" },
      }),
    });
    expect(res.status).toBe(200);
  });

  it("returns 200 for message update", async () => {
    const res = await SELF.fetch("http://localhost/webhook", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        update_id: 3,
        message: {
          message_id: 1,
          from: { id: 123, is_bot: false, first_name: "Test" },
          chat: { id: 123, type: "private" },
          date: 1234567890,
          text: "/start",
        },
      }),
    });
    expect(res.status).toBe(200);
  });

  it("returns 404 for unknown paths", async () => {
    const res = await SELF.fetch("http://localhost/unknown");
    expect(res.status).toBe(404);
  });

  it("returns health check on GET /", async () => {
    const res = await SELF.fetch("http://localhost/");
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("Bot is running");
  });
});
