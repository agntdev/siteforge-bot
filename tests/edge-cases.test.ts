import { describe, it, expect, beforeEach } from "vitest";
import type { Bot } from "grammy";
import { makeBot } from "../src/harness-entry.js";
import { captureCalls, textUpdate, callbackUpdate } from "./helpers.js";
import { storeSet, storeGet } from "../src/store.js";
import { recordGeneration, resetRateLimit, checkRateLimit } from "../src/rate-limit.js";
import { DEFAULT_SETTINGS } from "../src/handlers/settings.js";
import { setClock, resetClock } from "../src/clock.js";

// Programmatic tests for the hard paths declarative BotSpec JSON can't express:
// rate-limit enforcement, owner settings editing, and the no-previous-request
// regenerate guard. These do NOT count toward the command-coverage gate (only
// tests/specs/*.json do); they exist to verify real edge behavior.

const RATE_HIT_60 =
  "Hold on — you've hit the hourly limit. Try again in about 60 min, or ask the owner to raise it in ⚙️ Settings.";

const DELIVERY =
  "✅ Your site is ready!\n\nUnzip it and follow README.md to run it. Want changes? Tap ✏️ Tweak or 🔄 Regenerate.";

async function driveFullCreateFlow(bot: Bot<any>, chatId: number, userId: number, name: string) {
  await bot.handleUpdate(callbackUpdate("project:create", { chatId, userId }));
  await bot.handleUpdate(textUpdate(name, { chatId, userId }));
  await bot.handleUpdate(callbackUpdate("form:type:landing", { chatId, userId }));
  await bot.handleUpdate(callbackUpdate("form:pages:home", { chatId, userId }));
  await bot.handleUpdate(callbackUpdate("form:color:blue", { chatId, userId }));
  await bot.handleUpdate(callbackUpdate("form:feature:done", { chatId, userId }));
  await bot.handleUpdate(callbackUpdate("form:stack:static", { chatId, userId }));
  await bot.handleUpdate(callbackUpdate("form:notes:skip", { chatId, userId }));
  await bot.handleUpdate(callbackUpdate("form:confirm:yes", { chatId, userId }));
}

describe("rate limiting", () => {
  beforeEach(async () => {
    await storeSet("settings:global", { ...DEFAULT_SETTINGS });
    await resetRateLimit(3001);
    resetClock();
  });

  it("allows under the limit and counts generations", async () => {
    await storeSet("settings:global", { ...DEFAULT_SETTINGS, rateLimitPerHour: 2 });
    const a = await checkRateLimit(3001, { limit: 2, windowMs: 60 * 60 * 1000 });
    expect(a.ok).toBe(true);
    expect(a.remaining).toBe(2);
    await recordGeneration(3001, { limit: 2, windowMs: 60 * 60 * 1000 });
    const b = await checkRateLimit(3001, { limit: 2, windowMs: 60 * 60 * 1000 });
    expect(b.ok).toBe(true);
    expect(b.remaining).toBe(1);
    await recordGeneration(3001, { limit: 2, windowMs: 60 * 60 * 1000 });
    const c = await checkRateLimit(3001, { limit: 2, windowMs: 60 * 60 * 1000 });
    expect(c.ok).toBe(false);
    expect(c.retryAt).toBeGreaterThan(0);
  });

  it("blocks a generation once the hourly limit is reached (enforcement)", async () => {
    await storeSet("settings:global", { ...DEFAULT_SETTINGS, rateLimitPerHour: 1 });
    // Pre-consume the single allowed generation for user 3001.
    await recordGeneration(3001, { limit: 1, windowMs: 60 * 60 * 1000 });

    const bot = await makeBot();
    const calls = captureCalls(bot);

    await driveFullCreateFlow(bot, 3001, 3001, "Blocked Site");

    const sentTexts = calls.filter((c) => c.method === "sendMessage").map((c) => c.payload.text as string);
    expect(sentTexts).toContain(RATE_HIT_60);
    expect(calls.some((c) => c.method === "sendDocument")).toBe(false);
  });

  it("lets the window roll over after the configured time (clock seam)", async () => {
    await storeSet("settings:global", { ...DEFAULT_SETTINGS, rateLimitPerHour: 1 });
    let fake = 1_000_000_000_000;
    setClock(() => fake);
    await recordGeneration(3001, { limit: 1, windowMs: 60 * 60 * 1000 });
    const blocked = await checkRateLimit(3001, { limit: 1, windowMs: 60 * 60 * 1000 });
    expect(blocked.ok).toBe(false);
    // Advance past the 1-hour window → allowed again.
    fake += 60 * 60 * 1000 + 1;
    const freed = await checkRateLimit(3001, { limit: 1, windowMs: 60 * 60 * 1000 });
    expect(freed.ok).toBe(true);
  });
});

describe("owner settings", () => {
  beforeEach(async () => {
    await storeSet("settings:global", { ...DEFAULT_SETTINGS, adminChatId: "3002" });
    resetClock();
  });

  it("lets the owner edit the rate limit and persists it", async () => {
    const bot = await makeBot();
    const calls = captureCalls(bot);
    await bot.handleUpdate(callbackUpdate("settings:show", { chatId: 3002, userId: 3002 }));
    await bot.handleUpdate(callbackUpdate("settings:edit:rate-limit", { chatId: 3002, userId: 3002 }));
    await bot.handleUpdate(textUpdate("3", { chatId: 3002, userId: 3002 }));

    const saved = await storeGet<{ rateLimitPerHour: number }>("settings:global");
    expect(saved?.rateLimitPerHour).toBe(3);
    const confirmed = calls.some((c) => c.method === "sendMessage" && c.payload.text === "✅ Saved.");
    expect(confirmed).toBe(true);
  });

  it("rejects non-numeric input for the rate limit", async () => {
    const bot = await makeBot();
    captureCalls(bot);
    await bot.handleUpdate(callbackUpdate("settings:show", { chatId: 3002, userId: 3002 }));
    await bot.handleUpdate(callbackUpdate("settings:edit:rate-limit", { chatId: 3002, userId: 3002 }));
    await bot.handleUpdate(textUpdate("lots", { chatId: 3002, userId: 3002 }));
    const saved = await storeGet<{ rateLimitPerHour: number }>("settings:global");
    expect(saved?.rateLimitPerHour).toBe(DEFAULT_SETTINGS.rateLimitPerHour);
  });
});

describe("regenerate guard", () => {
  it("tells the user there's nothing to regenerate yet", async () => {
    const bot = await makeBot();
    const calls = captureCalls(bot);
    await bot.handleUpdate(callbackUpdate("project:regenerate", { chatId: 3003, userId: 3003 }));
    // answerCallbackQuery carries the notice; no document or delivery message sent.
    expect(calls.some((c) => c.method === "answerCallbackQuery")).toBe(true);
    expect(calls.some((c) => c.method === "sendDocument")).toBe(false);
    expect(calls.some((c) => c.method === "sendMessage" && c.payload.text === DELIVERY)).toBe(false);
  });
});
