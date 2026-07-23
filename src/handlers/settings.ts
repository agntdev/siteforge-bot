// Owner controls: configurable admin notification channel, per-user rate limit,
// and generated-file retention period. Settings are durable (store.ts) and editable
// by the bot's owner (the chat whose id matches ADMIN_CHAT_ID in the environment),
// surfaced as a "⚙️ Settings" button on the main menu — only for the owner.

import { Composer } from "grammy";
import type { Ctx } from "../bot.js";
import { inlineButton, inlineKeyboard, registerMainMenuItem } from "../toolkit/index.js";
import { storeGet, storeSet } from "../store.js";

export interface BotSettings {
  /** Max generations per hour per user. */
  rateLimitPerHour: number;
  /** Hours generated-file metadata is retained before lazy cleanup. */
  retentionHours: number;
  /** Chat id authorized to receive admin failure alerts. */
  adminChatId: string | null;
}

export const DEFAULT_SETTINGS: BotSettings = {
  rateLimitPerHour: 5,
  retentionHours: 24,
  adminChatId: null,
};

const SETTINGS_KEY = "settings:global";

/** Read the current bot settings, merged over defaults. */
export async function getSettings(): Promise<BotSettings> {
  const stored = await storeGet<Partial<BotSettings>>(SETTINGS_KEY);
  return { ...DEFAULT_SETTINGS, ...(stored ?? {}) };
}

async function saveSettings(s: BotSettings): Promise<void> {
  await storeSet(SETTINGS_KEY, s);
}

/** Is `userId` the configured owner? Owner is whoever set ADMIN_CHAT_ID (env) or
 *  whoever first claimed the owner seat by opening Settings. */
export function isOwner(userId: number | string, settings: BotSettings): boolean {
  const envAdmin = typeof process !== "undefined" ? process.env.ADMIN_CHAT_ID : undefined;
  const owner = settings.adminChatId ?? envAdmin ?? null;
  if (owner == null) return false;
  return String(userId) === String(owner);
}

const composer = new Composer<Ctx>();

// Add the Settings button to the main menu. The /start handler renders it; the
// visibility check happens in the callback (a non-owner tapping it gets a notice
// instead of the controls).
registerMainMenuItem({ label: "⚙️ Settings", data: "settings:show", order: 90 });

const backToMenu = inlineKeyboard([[inlineButton("⬅️ Back to menu", "menu:main")]]);

async function renderSettings(ctx: Ctx): Promise<void> {
  const s = await getSettings();
  const owner = isOwner(ctx.from?.id ?? 0, s);
  if (!owner) {
    await ctx.editMessageText(
      "⚙️ Settings are owner-only.\n\nIf you run this bot, set ADMIN_CHAT_ID to your Telegram chat id to unlock controls.",
      { reply_markup: backToMenu },
    );
    return;
  }
  const text =
    "⚙️ Bot settings\n\n" +
    `• Rate limit: ${s.rateLimitPerHour} sites / hour / user\n` +
    `• File retention: ${s.retentionHours} hours\n` +
    `• Admin alerts: ${s.adminChatId ? "on (chat " + s.adminChatId + ")" : "off"}\n\n` +
    "Tap a setting to change it.";
  const kb = inlineKeyboard([
    [inlineButton(`Rate limit (${s.rateLimitPerHour}/h)`, "settings:edit:rate-limit")],
    [inlineButton(`Retention (${s.retentionHours}h)`, "settings:edit:retention")],
    [inlineButton("⬅️ Back to menu", "menu:main")],
  ]);
  await ctx.editMessageText(text, { reply_markup: kb });
}

composer.callbackQuery("settings:show", async (ctx) => {
  await ctx.answerCallbackQuery();
  await renderSettings(ctx);
});

composer.callbackQuery("settings:edit:rate-limit", async (ctx) => {
  await ctx.answerCallbackQuery();
  ctx.session.step = "settings:rate-limit";
  await ctx.editMessageText(
    "Send the new rate limit (sites per hour per user) — a number from 1 to 50.",
    { reply_markup: inlineKeyboard([[inlineButton("Cancel", "settings:show")]]) },
  );
});

composer.callbackQuery("settings:edit:retention", async (ctx) => {
  await ctx.answerCallbackQuery();
  ctx.session.step = "settings:retention";
  await ctx.editMessageText(
    "Send the new retention period in hours (1–168).",
    { reply_markup: inlineKeyboard([[inlineButton("Cancel", "settings:show")]]) },
  );
});

// Free-form number input for the two settings fields.
composer.on("message:text", async (ctx, next) => {
  if (ctx.session.step !== "settings:rate-limit" && ctx.session.step !== "settings:retention") {
    return next();
  }
  const n = parseInt(ctx.message.text.trim(), 10);
  if (Number.isNaN(n)) {
    await ctx.reply("That doesn't look like a number. Try again, or tap Cancel.");
    return;
  }
  const s = await getSettings();
  if (ctx.session.step === "settings:rate-limit") {
    if (n < 1 || n > 50) {
      await ctx.reply("Pick a number between 1 and 50.");
      return;
    }
    s.rateLimitPerHour = n;
  } else {
    if (n < 1 || n > 168) {
      await ctx.reply("Pick a number between 1 and 168.");
      return;
    }
    s.retentionHours = n;
  }
  // First owner to act claims the admin seat so isOwner() sticks across restarts.
  if (s.adminChatId == null) s.adminChatId = String(ctx.from?.id ?? "");
  await saveSettings(s);
  ctx.session.step = "idle";
  await ctx.reply("✅ Saved.", { reply_markup: backToMenu });
});

export default composer;
