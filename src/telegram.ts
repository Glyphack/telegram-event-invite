export interface TelegramUser {
  id: number;
  is_bot: boolean;
  first_name: string;
  last_name?: string;
  username?: string;
}

export interface TelegramChat {
  id: number;
  type: "private" | "group" | "supergroup" | "channel";
  first_name?: string;
  username?: string;
}

export interface TelegramMessage {
  message_id: number;
  from?: TelegramUser;
  chat: TelegramChat;
  date: number;
  text?: string;
  reply_to_message?: TelegramMessage;
}

export interface TelegramInlineQuery {
  id: string;
  from: TelegramUser;
  query: string;
  offset: string;
}

export interface TelegramCallbackQuery {
  id: string;
  from: TelegramUser;
  inline_message_id?: string;
  data?: string;
}

export interface TelegramChosenInlineResult {
  result_id: string;
  from: TelegramUser;
  inline_message_id?: string;
  query: string;
}

export interface TelegramUpdate {
  update_id: number;
  message?: TelegramMessage;
  inline_query?: TelegramInlineQuery;
  callback_query?: TelegramCallbackQuery;
  chosen_inline_result?: TelegramChosenInlineResult;
}

export interface InlineKeyboardButton {
  text: string;
  url?: string;
  callback_data?: string;
}

export interface ForceReply {
  force_reply: true;
  input_field_placeholder?: string;
  selective?: boolean;
}

export type ReplyMarkup = ForceReply | { inline_keyboard: InlineKeyboardButton[][] };

export interface InlineQueryResultArticle {
  type: "article";
  id: string;
  title: string;
  description?: string;
  input_message_content: { message_text: string };
  reply_markup?: { inline_keyboard: InlineKeyboardButton[][] };
}

const API_BASE = "https://api.telegram.org/bot";

export class TelegramClient {
  constructor(private token: string) {}

  async sendMessage(chatId: number, text: string, replyMarkup?: ReplyMarkup): Promise<void> {
    await fetch(`${API_BASE}${this.token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text, reply_markup: replyMarkup }),
    });
  }

  async answerInlineQuery(inlineQueryId: string, results: InlineQueryResultArticle[]): Promise<void> {
    await fetch(`${API_BASE}${this.token}/answerInlineQuery`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ inline_query_id: inlineQueryId, results, cache_time: 0, is_personal: true }),
    });
  }

  async answerCallbackQuery(callbackQueryId: string, text?: string, showAlert?: boolean): Promise<void> {
    await fetch(`${API_BASE}${this.token}/answerCallbackQuery`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ callback_query_id: callbackQueryId, text, show_alert: showAlert }),
    });
  }

  async editMessageText(
    inlineMessageId: string,
    text: string,
    replyMarkup?: { inline_keyboard: InlineKeyboardButton[][] },
  ): Promise<void> {
    await fetch(`${API_BASE}${this.token}/editMessageText`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ inline_message_id: inlineMessageId, text, reply_markup: replyMarkup }),
    });
  }

  async getChat(userId: number): Promise<TelegramChat> {
    const res = await fetch(`${API_BASE}${this.token}/getChat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: userId }),
    });
    const data = (await res.json()) as { result: TelegramChat };
    return data.result;
  }

  async setWebhook(webhookUrl: string): Promise<Response> {
    return fetch(`${API_BASE}${this.token}/setWebhook`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: webhookUrl }),
    });
  }
}
