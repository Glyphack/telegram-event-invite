import {
  TelegramClient,
  type TelegramMessage,
  type TelegramInlineQuery,
  type TelegramCallbackQuery,
  type TelegramChosenInlineResult,
  type TelegramUpdate,
  type InlineQueryResultArticle,
  type InlineKeyboardButton,
} from "./telegram";

const DEBUG = true;
const BOT_USERNAME = "tinyinvitebot";

export interface Env {
  DB: D1Database;
  BOT_TOKEN: string;
  AI: Ai;
}

// --- Interfaces ---

export interface User {
  userId: number;
  email: string | null;
  updatedAt: string;
}

export interface Rsvp {
  inlineMessageId: string;
  userId: number;
  createdAt: string;
}

// --- Datetime helpers ---
// Compact wall-clock format: YYYYMMDDTHHmmSS, optionally trailing Z. Everything is
// computed in UTC so the wall-clock digits round-trip untouched.

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

function stripZ(dt: string): string {
  return dt.endsWith("Z") ? dt.slice(0, -1) : dt;
}

function compactToMs(dt: string): number {
  const m = stripZ(dt).match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})$/);
  if (!m) throw new Error(`Invalid datetime: ${dt}`);
  return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5]), Number(m[6]));
}

function msToCompact(ms: number): string {
  const d = new Date(ms);
  return `${d.getUTCFullYear()}${pad2(d.getUTCMonth() + 1)}${pad2(d.getUTCDate())}T${pad2(d.getUTCHours())}${pad2(d.getUTCMinutes())}${pad2(d.getUTCSeconds())}`;
}

export function isoToCompact(iso: string): string {
  const m = iso.trim().match(/(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?/);
  if (!m) throw new Error(`Invalid datetime from model: ${iso}`);
  return `${m[1]}${m[2]}${m[3]}T${m[4]}${m[5]}${m[6] ?? "00"}`;
}

export function formatDatetime(dt: string): string {
  const d = new Date(compactToMs(dt));
  const days = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  const months = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  const day = d.getUTCDate();
  const suffix = day === 1 || day === 21 || day === 31 ? "st" : day === 2 || day === 22 ? "nd" : day === 3 || day === 23 ? "rd" : "th";
  return `${days[d.getUTCDay()]} the ${day}${suffix} of ${months[d.getUTCMonth()]} ${d.getUTCFullYear()} ${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())}`;
}

// --- Calendar event ---

export class CalendarEvent {
  constructor(
    public title: string,
    public start: string, // floating local time, YYYYMMDDTHHmmSS (no timezone)
    public end: string,
  ) {}

  static fromCallback(data: string): { action: string; event: CalendarEvent; organizerId: number } {
    const parts = data.split(":");
    const action = parts[0];
    const title = parts.slice(1, -3).join(":");
    const start = msToCompact(Number(parts[parts.length - 3]) * 1000);
    const end = msToCompact(Number(parts[parts.length - 2]) * 1000);
    const organizerId = Number(parts[parts.length - 1]);
    return { action, event: new CalendarEvent(title, start, end), organizerId };
  }

  // callback_data is capped at 64 bytes by Telegram. Epoch seconds keep the times
  // compact and the title is trimmed until the whole payload fits.
  callbackData(action: string, organizerId: number): string {
    const start = compactToMs(this.start) / 1000;
    const end = compactToMs(this.end) / 1000;
    const encoder = new TextEncoder();
    let title = this.title;
    const build = () => `${action}:${title}:${start}:${end}:${organizerId}`;
    let encoded = build();
    while (encoder.encode(encoded).length > 64) {
      if (title === "") throw new Error("callback data exceeds 64 bytes");
      title = title.slice(0, -1);
      encoded = build();
    }
    return encoded;
  }

  googleCalendarUrl(emails: string[]): string {
    const dates = `${stripZ(this.start)}/${stripZ(this.end)}`;
    let url = `https://calendar.google.com/calendar/render?action=TEMPLATE&text=${encodeURIComponent(this.title)}&dates=${dates}`;
    if (emails.length > 0) url += `&add=${encodeURIComponent(emails.join(","))}`;
    return url;
  }

  dateRange(): string {
    return `${formatDatetime(this.start)} — ${formatDatetime(this.end)}`;
  }

  message(attendeeNames: string[]): string {
    const attendeeLine = attendeeNames.length > 0 ? attendeeNames.join(", ") : "No RSVPs yet";
    return `📅 ${this.title}\n${this.dateRange()}\n\nAttendees: ${attendeeLine}`;
  }

  keyboard(organizerId: number, emails: string[] = []): InlineKeyboardButton[][] {
    return [
      [
        { text: "I'm in", callback_data: this.callbackData("y", organizerId) },
        { text: "Not my ownership", callback_data: this.callbackData("n", organizerId) },
      ],
      [
        { text: "Save to Google Calendar", url: this.googleCalendarUrl(emails) },
        { text: "Set your email", url: `https://t.me/${BOT_USERNAME}?start=set_email` },
      ],
    ];
  }
}

// --- Store ---

export class Store {
  constructor(private db: D1Database) {}

  async getUser(userId: number): Promise<User | null> {
    const row = await this.db
      .prepare("SELECT user_id, email, updated_at FROM users WHERE user_id = ?")
      .bind(userId)
      .first<{ user_id: number; email: string | null; updated_at: string }>();
    if (!row) return null;
    return { userId: row.user_id, email: row.email, updatedAt: row.updated_at };
  }

  async setEmail(userId: number, email: string): Promise<User> {
    await this.db
      .prepare(
        `INSERT INTO users (user_id, email, updated_at)
         VALUES (?, ?, datetime('now'))
         ON CONFLICT (user_id) DO UPDATE SET
           email = excluded.email,
           updated_at = datetime('now')`
      )
      .bind(userId, email)
      .run();
    return (await this.getUser(userId))!;
  }

  async addRsvp(inlineMessageId: string, userId: number): Promise<Rsvp> {
    await this.db
      .prepare(
        `INSERT OR REPLACE INTO rsvps (inline_message_id, user_id, created_at)
         VALUES (?, ?, datetime('now'))`
      )
      .bind(inlineMessageId, userId)
      .run();
    return { inlineMessageId, userId, createdAt: new Date().toISOString() };
  }

  async removeRsvp(inlineMessageId: string, userId: number): Promise<void> {
    await this.db
      .prepare("DELETE FROM rsvps WHERE inline_message_id = ? AND user_id = ?")
      .bind(inlineMessageId, userId)
      .run();
  }

  async getRsvps(inlineMessageId: string): Promise<Rsvp[]> {
    const { results } = await this.db
      .prepare("SELECT inline_message_id, user_id, created_at FROM rsvps WHERE inline_message_id = ? ORDER BY created_at")
      .bind(inlineMessageId)
      .all<{ inline_message_id: string; user_id: number; created_at: string }>();
    return results.map((r) => ({ inlineMessageId: r.inline_message_id, userId: r.user_id, createdAt: r.created_at }));
  }

  async getRsvpEmails(inlineMessageId: string): Promise<string[]> {
    const { results } = await this.db
      .prepare(
        `SELECT u.email FROM rsvps r
         JOIN users u ON r.user_id = u.user_id
         WHERE r.inline_message_id = ? AND u.email IS NOT NULL`
      )
      .bind(inlineMessageId)
      .all<{ email: string }>();
    return results.map((r) => r.email);
  }
}

// --- AI parsing ---

const EVENT_MODEL = "@cf/google/gemma-4-26b-a4b-it";

type RunChatModel = (model: string, inputs: ChatCompletionsMessagesInput) => Promise<ChatCompletionsOutput>;

interface ParsedEvent {
  title: string;
  start: string;
  end: string;
}

function buildSystemPrompt(reference: Date): string {
  const today = new Intl.DateTimeFormat("en-US", { weekday: "long", year: "numeric", month: "long", day: "numeric", timeZone: "UTC" }).format(reference);
  return `You turn the user's text into a calendar event. Today is ${today}.

Work out the actual calendar date the user means, then return it as a concrete date and time.

Return ONLY a JSON object with these fields and nothing else:
- "title": a short event title taken from the text.
- "start": the start as a local datetime in the format YYYY-MM-DDTHH:MM:SS (24-hour, no timezone).
- "end": the end in the same format.

Rules:
- Resolve relative dates like "tomorrow", "next monday", or "in 3 days" into the real date using today's date above.
- Use the exact clock time the user said. Never convert time zones.
- If the user gives no time, use 12:00:00.
- If the user gives no end time, make "end" one hour after "start".

No prose, no explanation, only the JSON object.`;
}

export function parseModelEvent(raw: unknown): ParsedEvent {
  const text = typeof raw === "string" ? raw : JSON.stringify(raw);
  const json = text.replace(/<think>[\s\S]*?<\/think>/g, "").match(/\{[\s\S]*\}/)?.[0];
  if (!json) throw new Error("model returned no JSON");
  const obj = JSON.parse(json) as Record<string, unknown>;
  if (typeof obj.start !== "string") throw new Error("model returned no start time");
  return {
    title: typeof obj.title === "string" ? obj.title : "",
    start: obj.start,
    end: typeof obj.end === "string" ? obj.end : "",
  };
}

async function extractEvent(ai: Ai, query: string, reference: Date): Promise<ParsedEvent> {
  const input: ChatCompletionsMessagesInput = {
    messages: [
      { role: "system", content: buildSystemPrompt(reference) },
      { role: "user", content: query },
    ],
    temperature: 0,
    chat_template_kwargs: { enable_thinking: false },
  };

  const run = async (): Promise<ParsedEvent> => {
    const response = await (ai.run as unknown as RunChatModel)(EVENT_MODEL, input);
    return parseModelEvent(response.choices[0]?.message.content);
  };

  try {
    return await run();
  } catch {
    return run();
  }
}

async function parseEventWithAI(ai: Ai, query: string): Promise<CalendarEvent> {
  const reference = new Date();
  const parsed = await extractEvent(ai, query, reference);
  const start = isoToCompact(parsed.start);
  let end: string;
  try {
    end = isoToCompact(parsed.end);
  } catch {
    end = msToCompact(compactToMs(start) + 60 * 60_000);
  }
  return new CalendarEvent(parsed.title.trim() || "Event", start, end);
}

// --- RSVP helpers ---

async function rsvpNames(telegram: TelegramClient, rsvps: Rsvp[], organizerId: number): Promise<string[]> {
  const ordered = [
    ...rsvps.filter((r) => r.userId === organizerId),
    ...rsvps.filter((r) => r.userId !== organizerId),
  ];
  return Promise.all(
    ordered.map(async (r) => {
      try {
        const chat = await telegram.getChat(r.userId);
        return chat.first_name ?? "Unknown";
      } catch {
        return "Unknown";
      }
    })
  );
}

async function refreshEventMessage(
  telegram: TelegramClient,
  store: Store,
  inlineMessageId: string,
  event: CalendarEvent,
  organizerId: number,
): Promise<void> {
  const rsvps = await store.getRsvps(inlineMessageId);
  if (!rsvps.some((r) => r.userId === organizerId)) {
    await store.addRsvp(inlineMessageId, organizerId);
    rsvps.push({ inlineMessageId, userId: organizerId, createdAt: new Date().toISOString() });
  }
  const [names, emails] = await Promise.all([
    rsvpNames(telegram, rsvps, organizerId),
    store.getRsvpEmails(inlineMessageId),
  ]);
  await telegram.editMessageText(inlineMessageId, event.message(names), { inline_keyboard: event.keyboard(organizerId, emails) });
}

// --- Bot logic ---

const EMAIL_PROMPT = "Reply to this message with your email address (e.g. you@example.com).";

export function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function isEmailPromptReply(message: TelegramMessage): boolean {
  const replied = message.reply_to_message;
  return replied?.from?.is_bot === true && replied.text === EMAIL_PROMPT;
}

async function promptForEmail(telegram: TelegramClient, chatId: number): Promise<void> {
  await telegram.sendMessage(chatId, EMAIL_PROMPT, {
    force_reply: true,
    input_field_placeholder: "you@example.com",
  });
}

async function saveEmail(telegram: TelegramClient, store: Store, chatId: number, userId: number, email: string): Promise<void> {
  if (!isValidEmail(email)) {
    await telegram.sendMessage(chatId, "That doesn't look like an email. Try again: /set_email user@example.com");
    return;
  }
  await store.setEmail(userId, email);
  await telegram.sendMessage(chatId, `Email set to ${email}`);
}

async function handleMessage(message: TelegramMessage, telegram: TelegramClient, store: Store): Promise<void> {
  const chatId = message.chat.id;
  const userId = message.from?.id ?? chatId;
  const text = message.text?.trim() ?? "";

  if (!text) return;

  if (isEmailPromptReply(message)) {
    await saveEmail(telegram, store, chatId, userId, text);
    return;
  }

  if (!text.startsWith("/")) return;

  const spaceIndex = text.indexOf(" ");
  const command = (spaceIndex === -1 ? text : text.substring(0, spaceIndex)).replace(/@.*$/, "");
  const args = spaceIndex === -1 ? "" : text.substring(spaceIndex + 1).trim();

  switch (command) {
    case "/start":
      if (args === "set_email") {
        await promptForEmail(telegram, chatId);
        return;
      }
      await telegram.sendMessage(
        chatId,
        `Welcome! I create calendar events and group invites.\nSet your email first: /set_email your@email.com\nThen type @${BOT_USERNAME} in any chat to create events!`,
      );
      break;

    case "/set_email": {
      if (!args) {
        await promptForEmail(telegram, chatId);
        return;
      }
      await saveEmail(telegram, store, chatId, userId, args);
      break;
    }

    case "/get_email": {
      const email = (await store.getUser(userId))?.email ?? null;
      await telegram.sendMessage(chatId, email ? `Your email: ${email}` : "No email set. Use /set_email");
      break;
    }

    default:
      await telegram.sendMessage(chatId, "Unknown command. Try /start");
  }
}

async function handleInlineQuery(query: TelegramInlineQuery, telegram: TelegramClient, ai: Ai): Promise<void> {
  if (!query.query.trim()) {
    await telegram.answerInlineQuery(query.id, []);
    return;
  }

  try {
    const event = await parseEventWithAI(ai, query.query);

    const result: InlineQueryResultArticle = {
      type: "article",
      id: crypto.randomUUID(),
      title: event.title,
      description: event.dateRange(),
      input_message_content: {
        message_text: event.message([query.from.first_name ?? "Unknown"]),
      },
      reply_markup: {
        inline_keyboard: event.keyboard(query.from.id),
      },
    };

    await telegram.answerInlineQuery(query.id, [result]);
  } catch (err) {
    if (DEBUG) {
      const msg = err instanceof Error ? err.message : String(err);
      await telegram.answerInlineQuery(query.id, [
        {
          type: "article",
          id: crypto.randomUUID(),
          title: "Error",
          description: msg,
          input_message_content: { message_text: `Error: ${msg}` },
        },
      ]);
      return;
    }
    await telegram.answerInlineQuery(query.id, []);
  }
}

async function handleChosenInlineResult(result: TelegramChosenInlineResult, store: Store): Promise<void> {
  if (!result.inline_message_id) return;
  await store.addRsvp(result.inline_message_id, result.from.id);
}

async function handleCallbackQuery(callbackQuery: TelegramCallbackQuery, telegram: TelegramClient, store: Store): Promise<void> {
  const { id: queryId, from, inline_message_id: inlineMessageId, data } = callbackQuery;

  if (!inlineMessageId || !data) {
    await telegram.answerCallbackQuery(queryId, "Something went wrong.", true);
    return;
  }

  const { action, event, organizerId } = CalendarEvent.fromCallback(data);

  if (action === "y") {
    const user = await store.getUser(from.id);
    if (!user?.email) {
      await telegram.answerCallbackQuery(queryId, "Please set your email first! Tap \"Set email\" below to DM me.", true);
      return;
    }
    await store.addRsvp(inlineMessageId, from.id);
    await refreshEventMessage(telegram, store, inlineMessageId, event, organizerId);
    await telegram.answerCallbackQuery(queryId, "You're in!");
    return;
  }

  if (action === "n") {
    await store.removeRsvp(inlineMessageId, from.id);
    await refreshEventMessage(telegram, store, inlineMessageId, event, organizerId);
    await telegram.answerCallbackQuery(queryId, "You're out");
    return;
  }

  await telegram.answerCallbackQuery(queryId, "Unknown action.", true);
}

// --- Worker entry point ---

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === "POST" && url.pathname === "/webhook") {
      const update: TelegramUpdate = await request.json();
      const telegram = new TelegramClient(env.BOT_TOKEN);
      const store = new Store(env.DB);

      if (update.callback_query) {
        ctx.waitUntil(handleCallbackQuery(update.callback_query, telegram, store));
      } else if (update.chosen_inline_result) {
        ctx.waitUntil(handleChosenInlineResult(update.chosen_inline_result, store));
      } else if (update.inline_query) {
        ctx.waitUntil(handleInlineQuery(update.inline_query, telegram, env.AI));
      } else if (update.message) {
        ctx.waitUntil(handleMessage(update.message, telegram, store));
      }
      return new Response("OK", { status: 200 });
    }

    if (request.method === "GET" && url.pathname === "/") {
      return new Response("Bot is running");
    }

    return new Response("Not Found", { status: 404 });
  },
} satisfies ExportedHandler<Env>;
