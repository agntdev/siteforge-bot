import type { Bot } from "grammy";

// Fake botInfo so grammY skips the getMe network call during in-process replay.
export const FAKE_BOT_INFO = {
  id: 42,
  is_bot: true,
  first_name: "TestBot",
  username: "test_bot",
  can_join_groups: true,
  can_read_all_group_messages: false,
  supports_inline_queries: false,
  can_connect_to_business: false,
  has_main_web_app: false,
} as const;

export interface Call {
  method: string;
  payload: Record<string, unknown>;
}

let seq = 0;
function nextId(): number {
  return ++seq;
}

/** Install a capture transformer that records every outgoing Bot API call and
 *  returns a plausible stub so handlers can chain (e.g. editMessageText). */
export function captureCalls(bot: Bot<any>): Call[] {
  const calls: Call[] = [];
  (bot as unknown as { botInfo: typeof FAKE_BOT_INFO }).botInfo = { ...FAKE_BOT_INFO };
  let msgId = 1000;
  bot.api.config.use(async (_prev, method, payload) => {
    const p = (payload ?? {}) as Record<string, unknown>;
    calls.push({ method, payload: p });
    let result: unknown = true;
    if (/^(send|edit|copy|forward)/.test(method)) {
      result = {
        message_id: ++msgId,
        date: 0,
        chat: { id: (p.chat_id as number) ?? 1, type: "private" },
        ...(typeof p.text === "string" ? { text: p.text } : {}),
      };
    }
    return { ok: true, result } as any;
  });
  return calls;
}

/** Build a private-chat text Update (a leading "/cmd" gets a bot_command entity). */
export function textUpdate(text: string, opts: { chatId?: number; userId?: number } = {}) {
  const id = nextId();
  const chatId = opts.chatId ?? 1;
  const userId = opts.userId ?? 1;
  const isCmd = /^\/[A-Za-z0-9_]+/.test(text);
  const m = /^\/[A-Za-z0-9_]+/.exec(text);
  return {
    update_id: id,
    message: {
      message_id: id,
      date: 0,
      chat: { id: chatId, type: "private", first_name: "Test" },
      from: { id: userId, is_bot: false, first_name: "User" },
      text,
      ...(isCmd && m ? { entities: [{ type: "bot_command", offset: 0, length: m[0].length }] } : {}),
    },
  };
}

/** Build a callback-query Update (button tap) on a plausibly-owned bot message. */
export function callbackUpdate(data: string, opts: { chatId?: number; userId?: number; messageId?: number } = {}) {
  const id = nextId();
  const chatId = opts.chatId ?? 1;
  const userId = opts.userId ?? 1;
  const messageId = opts.messageId ?? id;
  return {
    update_id: id,
    callback_query: {
      id: String(id),
      from: { id: userId, is_bot: false, first_name: "User" },
      message: {
        message_id: messageId,
        date: 0,
        chat: { id: chatId, type: "private" },
        from: { id: FAKE_BOT_INFO.id, is_bot: true, first_name: "TestBot" },
        text: "(previous)",
      },
      chat_instance: `ci-${chatId}`,
      data,
    },
  };
}
