// Create-site flow: a button-first structured form (name → type → pages → colors
// → features → stack → notes → confirm) that builds a real, runnable project
// (static HTML/CSS/JS, Node/Express, or Python/Flask) reflecting every input, ZIPs
// it, and delivers it in chat. Includes regenerate (re-run the same request) and
// tweak (re-edit any field then regenerate), per-user rate limiting, durable
// request storage with retention, admin failure alerts, and large-file handling.

import { Composer, InputFile } from "grammy";
import type { Ctx } from "../bot.js";
import { inlineButton, inlineKeyboard, registerMainMenuItem } from "../toolkit/index.js";
import {
  COLOR_SCHEMES,
  FEATURE_LIST,
  SITE_TYPES,
  generateProject,
  zipProject,
  formatBytes,
  type ColorScheme,
  type ProjectRequest,
  type SiteType,
  type Stack,
} from "../generator.js";
import { storeGet, storeSet, storeDel } from "../store.js";
import { now } from "../clock.js";
import { checkRateLimit, recordGeneration, type RateLimitConfig } from "../rate-limit.js";
import { getSettings } from "./settings.js";

const composer = new Composer<Ctx>();

// Main-menu button — the only entry point to this feature (no slash command).
registerMainMenuItem({ label: "🆕 Create site", data: "project:create", order: 10 });

const FLOW_TTL_MS = 10 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;
const TG_DOC_LIMIT = 50 * 1024 * 1024; // 50 MB sendDocument cap on the Bot API

// ── exact copy ──────────────────────────────────────────────────────────────
const ASK_NAME = "Let's set up your site.\n\nWhat should we call it? Type the project name below.";
const TYPE_PROMPT = (name: string) => `Great, "${name}"! What kind of site is it?`;
const PAGES_PROMPT = "Which pages do you want?";
const COLORS_PROMPT = "Pick a color scheme.";
const COLORS_CUSTOM_PROMPT = "Send your brand color as a hex code (e.g. #2563eb).";
const FEATURES_PROMPT = "Which features should I include? Tap to toggle, then Done.";
const STACK_PROMPT = "Which stack do you want?";
const NOTES_PROMPT = "Any extra notes for the build? Type them below, or tap Skip.";
const CANCELLED = "Cancelled. Tap 🆕 Create site to start again.";
const NOTHING_YET = "No site in progress. Tap 🆕 Create site to begin.";
const RATE_HIT = (retryInMin: number) =>
  `Hold on — you've hit the hourly limit. Try again in about ${retryInMin} min, or ask the owner to raise it in ⚙️ Settings.`;
const GEN_ERROR = "Something went wrong building your site. I've logged it — please try again in a moment.";
const TOO_BIG = (size: string) =>
  `That project came out too large to send here (${size}) — Telegram caps file delivery at 50 MB. Try fewer pages or features, then regenerate.`;
const NUDGE = "Tap a button below to continue, or Cancel to stop.";
const STALE = "That setup ended — tap 🆕 Create site to start again.";

// ── step helpers ────────────────────────────────────────────────────────────
type Step = Ctx["session"]["step"];
type Field = "name" | "type" | "pages" | "colors" | "features" | "stack" | "notes";
const FORM_FIELDS: Field[] = ["name", "type", "pages", "colors", "features", "stack", "notes"];

function flowOf(step: Step): "form" | "tweak" | null {
  if (typeof step !== "string") return null;
  if (step === "form:colors-custom" || step.startsWith("form:")) return "form";
  if (step.startsWith("tweak:")) return "tweak";
  return null;
}

function nextStep(flow: "form" | "tweak", field: Field): Step {
  if (flow === "form") {
    const idx = FORM_FIELDS.indexOf(field);
    const after = FORM_FIELDS[idx + 1];
    return after ? (`form:${after}` as Step) : "form:confirm";
  }
  return "tweak:confirm";
}

function confirmStep(flow: "form" | "tweak"): Step {
  return flow === "form" ? "form:confirm" : "tweak:confirm";
}

function enterStep(ctx: Ctx, step: Step): void {
  ctx.session.step = step;
  ctx.session.expiresAt = now() + FLOW_TTL_MS;
}

function resetFlow(ctx: Ctx): void {
  ctx.session.step = "idle";
  ctx.session.draft = undefined;
  ctx.session.expiresAt = undefined;
}

/** Send a new message, or edit the tapped button's message when this update is a
 *  callback query (keeps the chat tidy — one message per step, edited in place). */
async function sendOrEdit(ctx: Ctx, text: string, replyMarkup: ReturnType<typeof inlineKeyboard>): Promise<void> {
  if (ctx.callbackQuery) {
    await ctx.editMessageText(text, { reply_markup: replyMarkup });
  } else {
    await ctx.reply(text, { reply_markup: replyMarkup });
  }
}

const cancelKb = inlineKeyboard([[inlineButton("Cancel", "form:cancel")]]);
const backToMenuKb = inlineKeyboard([[inlineButton("⬅️ Back to menu", "menu:main")]]);

// ── choice keyboards ─────────────────────────────────────────────────────────
function typeKb() {
  const rows = SITE_TYPES.map((t) => [inlineButton(t.label, `form:type:${t.id}`)]);
  rows.push([inlineButton("Cancel", "form:cancel")]);
  return inlineKeyboard(rows);
}

const PAGE_PRESETS: { key: string; label: string; pages: string[] }[] = [
  { key: "home", label: "Home only", pages: ["Home"] },
  { key: "home-about", label: "Home + About", pages: ["Home", "About"] },
  { key: "home-about-contact", label: "Home + About + Contact", pages: ["Home", "About", "Contact"] },
  { key: "home-about-contact-blog", label: "Home + About + Contact + Blog", pages: ["Home", "About", "Contact", "Blog"] },
];
function pagesKb() {
  const rows = PAGE_PRESETS.map((p) => [inlineButton(p.label, `form:pages:${p.key}`)]);
  rows.push([inlineButton("Cancel", "form:cancel")]);
  return inlineKeyboard(rows);
}

function colorsKb() {
  const rows = COLOR_SCHEMES.map((c) => [inlineButton(c.label, `form:color:${c.id}`)]);
  rows.push([inlineButton("Cancel", "form:cancel")]);
  return inlineKeyboard(rows);
}

function featuresKb(selected: string[]) {
  const rows = FEATURE_LIST.map((f) => [
    inlineButton(`${selected.includes(f.id) ? "✅ " : ""}${f.label}`, `form:feature:${f.id}`),
  ]);
  rows.push([inlineButton("Done", "form:feature:done"), inlineButton("Cancel", "form:cancel")]);
  return inlineKeyboard(rows);
}

const STACKS: { id: Stack; label: string }[] = [
  { id: "static", label: "Static HTML/CSS/JS" },
  { id: "node-express", label: "Node / Express" },
  { id: "python-flask", label: "Python / Flask" },
];
function stackKb() {
  const rows = STACKS.map((s) => [inlineButton(s.label, `form:stack:${s.id}`)]);
  rows.push([inlineButton("Cancel", "form:cancel")]);
  return inlineKeyboard(rows);
}

function confirmKb(flow: "form" | "tweak") {
  const rows: ReturnType<typeof inlineButton>[][] = [
    [inlineButton("✅ Generate", "form:confirm:yes"), inlineButton("↩️ Start over", "form:confirm:no")],
  ];
  if (flow === "tweak") rows.push([inlineButton("⬅️ Back to menu", "menu:main")]);
  return inlineKeyboard(rows);
}

function tweakMenuKb() {
  return inlineKeyboard([
    [inlineButton("Name", "tweak:field:name")],
    [inlineButton("Type", "tweak:field:type")],
    [inlineButton("Pages", "tweak:field:pages")],
    [inlineButton("Colors", "tweak:field:colors")],
    [inlineButton("Features", "tweak:field:features")],
    [inlineButton("Stack", "tweak:field:stack")],
    [inlineButton("Notes", "tweak:field:notes")],
    [inlineButton("⬅️ Back to menu", "menu:main")],
  ]);
}

function notesPromptKb() {
  return inlineKeyboard([
    [inlineButton("Skip", "form:notes:skip")],
    [inlineButton("Cancel", "form:cancel")],
  ]);
}

// ── request → summary ──────────────────────────────────────────────────────────
function renderSummary(req: ProjectRequest): string {
  const typeLabel = SITE_TYPES.find((t) => t.id === req.type)?.label ?? req.type;
  const colorLabel =
    req.colors.scheme === "custom"
      ? `Custom (${req.colors.custom ?? "?"})`
      : COLOR_SCHEMES.find((c) => c.id === req.colors.scheme)?.label ?? req.colors.scheme;
  const stackLabel = STACKS.find((s) => s.id === req.target_stack)?.label ?? req.target_stack;
  const featLabel = req.features.length
    ? req.features.map((f) => FEATURE_LIST.find((x) => x.id === f)?.label ?? f).join(", ")
    : "none";
  return (
    `📋 Here's your project:\n\n` +
    `• Name: ${req.name}\n` +
    `• Type: ${typeLabel}\n` +
    `• Pages: ${req.pages.join(", ")}\n` +
    `• Colors: ${colorLabel}\n` +
    `• Features: ${featLabel}\n` +
    `• Stack: ${stackLabel}\n` +
    `• Notes: ${req.notes || "—"}\n\n` +
    `Looks good? Tap Generate to build and zip it.`
  );
}

function currentRequest(draft: Ctx["session"]["draft"]): ProjectRequest | null {
  if (
    !draft ||
    !draft.name ||
    !draft.type ||
    !draft.pages ||
    !draft.colors ||
    !draft.features ||
    !draft.target_stack
  ) {
    return null;
  }
  return {
    name: draft.name,
    type: draft.type,
    pages: draft.pages,
    colors: draft.colors,
    features: draft.features,
    target_stack: draft.target_stack,
    notes: draft.notes ?? "",
  };
}

// ── confirm renderer ───────────────────────────────────────────────────────────
async function goToConfirm(ctx: Ctx, flow: "form" | "tweak"): Promise<void> {
  const req = currentRequest(ctx.session.draft);
  if (!req) {
    resetFlow(ctx);
    await ctx.reply("Hmm, something's missing. Let's start over — tap 🆕 Create site.");
    return;
  }
  enterStep(ctx, confirmStep(flow));
  await sendOrEdit(ctx, renderSummary(req), confirmKb(flow));
}

// ── flow timeout sweeper ───────────────────────────────────────────────────────
composer.use(async (ctx, next) => {
  if (flowOf(ctx.session.step) && ctx.session.expiresAt && now() > ctx.session.expiresAt) {
    resetFlow(ctx);
    await ctx.reply("Your site setup timed out. Tap 🆕 Create site to start again.").catch(() => {});
  }
  return next();
});

// ── entry: Create site ────────────────────────────────────────────────────────
composer.callbackQuery("project:create", async (ctx) => {
  await ctx.answerCallbackQuery();
  ctx.session.draft = {};
  enterStep(ctx, "form:name");
  await ctx.editMessageText(ASK_NAME, { reply_markup: cancelKb });
});

// ── regenerate (re-run last request) ───────────────────────────────────────────
composer.callbackQuery("project:regenerate", async (ctx) => {
  const id = ctx.session.lastRequestId;
  if (!id) {
    await ctx.answerCallbackQuery({ text: "No previous site to regenerate." });
    return;
  }
  await ctx.answerCallbackQuery();
  const req = await storeGet<ProjectRequest>(reqKey(ctx, id));
  if (!req) {
    await ctx.reply("I couldn't find your last request. Tap 🆕 Create site to build a new one.");
    return;
  }
  await generateAndDeliver(ctx, req);
});

// ── profile consent (User Profile entity) ─────────────────────────────────────
composer.callbackQuery("profile:save:yes", async (ctx) => {
  await ctx.answerCallbackQuery();
  const id = ctx.session.lastRequestId;
  const req = id ? await storeGet<ProjectRequest>(reqKey(ctx, id)) : null;
  const userId = ownerId(ctx);
  if (req) {
    const profile: UserProfile = {
      telegram_id: userId,
      preferred_stack: req.target_stack,
      color_theme: req.colors,
      consent: true,
    };
    await storeSet(profileKey(userId), profile);
  }
  await ctx.editMessageText("Got it — I'll use your usual stack and colors next time. Tap 🆕 Create site to begin.", {
    reply_markup: backToMenuKb,
  });
});

composer.callbackQuery("profile:save:no", async (ctx) => {
  await ctx.answerCallbackQuery();
  const userId = ownerId(ctx);
  // Record the declination so we don't ask again (consent: false).
  await storeSet<UserProfile>(profileKey(userId), {
    telegram_id: userId,
    preferred_stack: "static",
    color_theme: { scheme: "blue" },
    consent: false,
  });
  await ctx.editMessageText("No problem — I won't save anything. Tap 🆕 Create site to build another.", {
    reply_markup: backToMenuKb,
  });
});

// ── tweak entry ────────────────────────────────────────────────────────────────
composer.callbackQuery("project:tweak", async (ctx) => {
  await ctx.answerCallbackQuery();
  const id = ctx.session.lastRequestId;
  const req = id ? await storeGet<ProjectRequest>(reqKey(ctx, id)) : null;
  if (!req) {
    await ctx.reply("Nothing to tweak yet. Tap 🆕 Create site to build one first.");
    return;
  }
  ctx.session.draft = { ...req };
  enterStep(ctx, "tweak:menu");
  await ctx.editMessageText("What would you like to change?", { reply_markup: tweakMenuKb() });
});

composer.callbackQuery(/^tweak:field:(\w+)$/, async (ctx) => {
  const flow = flowOf(ctx.session.step);
  if (!flow) {
    await ctx.answerCallbackQuery({ text: STALE });
    return;
  }
  await ctx.answerCallbackQuery();
  const field = ctx.match![1] as Field;
  enterStep(ctx, `tweak:${field}` as Step);
  await renderFieldPrompt(ctx, field);
});

// ── cancel ──────────────────────────────────────────────────────────────────────
composer.callbackQuery("form:cancel", async (ctx) => {
  await ctx.answerCallbackQuery();
  resetFlow(ctx);
  await ctx.editMessageText(CANCELLED, { reply_markup: backToMenuKb });
});

// ── type choice (form + tweak) ──────────────────────────────────────────────────
composer.callbackQuery(/^form:type:(landing|portfolio|blog|business)$/, async (ctx) => {
  const flow = flowOf(ctx.session.step);
  if (!flow) return ctx.answerCallbackQuery({ text: STALE });
  await ctx.answerCallbackQuery();
  if (!ctx.session.draft) ctx.session.draft = {};
  ctx.session.draft.type = ctx.match![1] as SiteType;
  enterStep(ctx, nextStep(flow, "type"));
  if (flow === "form") await ctx.editMessageText(PAGES_PROMPT, { reply_markup: pagesKb() });
  else await goToConfirm(ctx, "tweak");
});

// ── pages preset ───────────────────────────────────────────────────────────────
composer.callbackQuery(/^form:pages:(.+)$/, async (ctx) => {
  const flow = flowOf(ctx.session.step);
  if (!flow) return ctx.answerCallbackQuery({ text: STALE });
  await ctx.answerCallbackQuery();
  const preset = PAGE_PRESETS.find((p) => p.key === ctx.match![1]);
  if (!preset) return;
  if (!ctx.session.draft) ctx.session.draft = {};
  ctx.session.draft.pages = preset.pages;
  enterStep(ctx, nextStep(flow, "pages"));
  if (flow === "form") await ctx.editMessageText(COLORS_PROMPT, { reply_markup: colorsKb() });
  else await goToConfirm(ctx, "tweak");
});

// ── colors choice ──────────────────────────────────────────────────────────────
composer.callbackQuery(/^form:color:(blue|green|purple|dark|custom)$/, async (ctx) => {
  const flow = flowOf(ctx.session.step);
  if (!flow) return ctx.answerCallbackQuery({ text: STALE });
  await ctx.answerCallbackQuery();
  const scheme = ctx.match![1] as ColorScheme;
  if (!ctx.session.draft) ctx.session.draft = {};
  if (scheme === "custom") {
    enterStep(ctx, flow === "form" ? ("form:colors-custom" as Step) : ("tweak:colors" as Step));
    await ctx.editMessageText(COLORS_CUSTOM_PROMPT, { reply_markup: cancelKb });
    return;
  }
  ctx.session.draft.colors = { scheme };
  enterStep(ctx, nextStep(flow, "colors"));
  if (flow === "form") await ctx.editMessageText(FEATURES_PROMPT, { reply_markup: featuresKb(ctx.session.draft.features ?? []) });
  else await goToConfirm(ctx, "tweak");
});

// ── feature toggles ─────────────────────────────────────────────────────────────
composer.callbackQuery(/^form:feature:(responsive|dark-mode|contact-form|newsletter|gallery)$/, async (ctx) => {
  const flow = flowOf(ctx.session.step);
  if (!flow) return ctx.answerCallbackQuery({ text: STALE });
  await ctx.answerCallbackQuery();
  const id = ctx.match![1];
  if (!ctx.session.draft) ctx.session.draft = {};
  const sel = ctx.session.draft.features ?? [];
  ctx.session.draft.features = sel.includes(id) ? sel.filter((f) => f !== id) : [...sel, id];
  enterStep(ctx, flow === "tweak" ? "tweak:features" : "form:features");
  await ctx.editMessageText(FEATURES_PROMPT, { reply_markup: featuresKb(ctx.session.draft.features) });
});

composer.callbackQuery("form:feature:done", async (ctx) => {
  const flow = flowOf(ctx.session.step);
  if (!flow) return ctx.answerCallbackQuery({ text: STALE });
  await ctx.answerCallbackQuery();
  if (!ctx.session.draft) ctx.session.draft = {};
  if (!ctx.session.draft.features) ctx.session.draft.features = [];
  enterStep(ctx, nextStep(flow, "features"));
  if (flow === "form") await ctx.editMessageText(STACK_PROMPT, { reply_markup: stackKb() });
  else await goToConfirm(ctx, "tweak");
});

// ── stack choice ───────────────────────────────────────────────────────────────
composer.callbackQuery(/^form:stack:(static|node-express|python-flask)$/, async (ctx) => {
  const flow = flowOf(ctx.session.step);
  if (!flow) return ctx.answerCallbackQuery({ text: STALE });
  await ctx.answerCallbackQuery();
  if (!ctx.session.draft) ctx.session.draft = {};
  ctx.session.draft.target_stack = ctx.match![1] as Stack;
  enterStep(ctx, nextStep(flow, "stack"));
  if (flow === "form") await ctx.editMessageText(NOTES_PROMPT, { reply_markup: notesPromptKb() });
  else await goToConfirm(ctx, "tweak");
});

composer.callbackQuery("form:notes:skip", async (ctx) => {
  const flow = flowOf(ctx.session.step);
  if (!flow) return ctx.answerCallbackQuery({ text: STALE });
  await ctx.answerCallbackQuery();
  if (!ctx.session.draft) ctx.session.draft = {};
  ctx.session.draft.notes = "";
  enterStep(ctx, nextStep(flow, "notes"));
  await goToConfirm(ctx, flow);
});

// ── confirm ─────────────────────────────────────────────────────────────────────
composer.callbackQuery("form:confirm:yes", async (ctx) => {
  const flow = flowOf(ctx.session.step);
  if (!flow) return ctx.answerCallbackQuery({ text: STALE });
  await ctx.answerCallbackQuery();
  const req = currentRequest(ctx.session.draft);
  if (!req) {
    resetFlow(ctx);
    await ctx.reply(NOTHING_YET, { reply_markup: backToMenuKb });
    return;
  }
  await generateAndDeliver(ctx, req);
});

composer.callbackQuery("form:confirm:no", async (ctx) => {
  await ctx.answerCallbackQuery();
  ctx.session.draft = {};
  enterStep(ctx, "form:name");
  await ctx.editMessageText(ASK_NAME, { reply_markup: cancelKb });
});

// ── per-step prompt renderer (tweak field entry; always a callback → edit) ──────
async function renderFieldPrompt(ctx: Ctx, field: Field): Promise<void> {
  switch (field) {
    case "name":
      await ctx.editMessageText("Send the new project name.", { reply_markup: cancelKb });
      break;
    case "type":
      await ctx.editMessageText("Pick a new type.", { reply_markup: typeKb() });
      break;
    case "pages":
      await ctx.editMessageText("Pick a new page set.", { reply_markup: pagesKb() });
      break;
    case "colors":
      await ctx.editMessageText("Pick a new color scheme.", { reply_markup: colorsKb() });
      break;
    case "features":
      await ctx.editMessageText(FEATURES_PROMPT, { reply_markup: featuresKb(ctx.session.draft?.features ?? []) });
      break;
    case "stack":
      await ctx.editMessageText("Pick a new stack.", { reply_markup: stackKb() });
      break;
    case "notes":
      await ctx.editMessageText("Send the new notes, or tap Skip.", { reply_markup: notesPromptKb() });
      break;
  }
}

// ── free-form text input (name, custom color hex, notes) ────────────────────────
composer.on("message:text", async (ctx, next) => {
  const step = ctx.session.step;
  const flow = flowOf(step);
  if (!flow || !ctx.session.draft) return next();

  const text = ctx.message.text.trim();

  if (step === "form:name" || step === "tweak:name") {
    if (text.length < 1 || text.length > 60) {
      await ctx.reply("Name's a bit off — keep it between 1 and 60 characters.");
      return;
    }
    ctx.session.draft.name = text;
    if (flow === "form") {
      enterStep(ctx, nextStep("form", "name"));
      await ctx.reply(TYPE_PROMPT(text), { reply_markup: typeKb() });
    } else {
      await goToConfirm(ctx, "tweak");
    }
    return;
  }

  if (step === "form:colors-custom" || step === "tweak:colors") {
    if (!/^#?[0-9a-fA-F]{6}$/.test(text)) {
      await ctx.reply("That doesn't look like a hex color. Try something like #2563eb.");
      return;
    }
    ctx.session.draft.colors = { scheme: "custom", custom: text.startsWith("#") ? text : "#" + text };
    if (flow === "form") {
      enterStep(ctx, nextStep("form", "colors"));
      await ctx.reply(FEATURES_PROMPT, { reply_markup: featuresKb(ctx.session.draft.features ?? []) });
    } else {
      await goToConfirm(ctx, "tweak");
    }
    return;
  }

  if (step === "form:notes" || step === "tweak:notes") {
    ctx.session.draft.notes = text;
    if (flow === "form") {
      enterStep(ctx, nextStep("form", "notes"));
      await goToConfirm(ctx, "form");
    } else {
      await goToConfirm(ctx, "tweak");
    }
    return;
  }

  // Active flow but a button-driven step: nudge instead of falling through.
  await ctx.reply(NUDGE);
});

// ── generation + delivery ───────────────────────────────────────────────────────
function ownerId(ctx: Ctx): number | string {
  return ctx.from?.id ?? ctx.chat?.id ?? 0;
}
function reqKey(ctx: Ctx, id: string): string {
  return `req:${ownerId(ctx)}:${id}`;
}
function indexKey(ctx: Ctx): string {
  return `req-index:${ownerId(ctx)}`;
}

function postDeliveryKb() {
  return inlineKeyboard([
    [inlineButton("🔄 Regenerate", "project:regenerate"), inlineButton("✏️ Tweak", "project:tweak")],
    [inlineButton("🆕 New site", "project:create")],
    [inlineButton("⬅️ Back to menu", "menu:main")],
  ]);
}

interface StoredRequest extends ProjectRequest {
  _generatedAt: number;
  _expiresAt: number;
}

/** Persistent user profile (stored only with explicit consent). */
export interface UserProfile {
  telegram_id: number | string;
  preferred_stack: Stack;
  color_theme: { scheme: ColorScheme; custom?: string };
  consent: boolean;
}

function profileKey(userId: number | string): string {
  return `profile:${userId}`;
}

/** Maintain the per-user request index (explicit ids only — no keyspace scan):
 *  append the new id, drop ids whose record has expired (and delete those
 *  records). Honors the configured retention period. */
async function maintainIndex(ctx: Ctx, newId: string): Promise<void> {
  const ids = (await storeGet<string[]>(indexKey(ctx))) ?? [];
  const t = now();
  const kept: string[] = [];
  for (const id of ids) {
    const rec = await storeGet<StoredRequest>(reqKey(ctx, id));
    if (rec && rec._expiresAt > t) kept.push(id);
    else if (rec) await storeDel(reqKey(ctx, id));
  }
  kept.push(newId);
  await storeSet(indexKey(ctx), kept);
}

async function generateAndDeliver(ctx: Ctx, req: ProjectRequest): Promise<void> {
  const userId = ownerId(ctx);
  const settings = await getSettings();
  const rlCfg: RateLimitConfig = { limit: settings.rateLimitPerHour, windowMs: HOUR_MS };

  const rl = await checkRateLimit(userId, rlCfg);
  if (!rl.ok) {
    const retryInMin = rl.retryAt ? Math.max(1, Math.ceil((rl.retryAt - now()) / 60000)) : 60;
    await ctx.reply(RATE_HIT(retryInMin), { reply_markup: backToMenuKb });
    return;
  }

  try {
    const project = generateProject(req);
    const zip = zipProject(project.fileTree);
    const sizeBytes = zip.byteLength;

    if (sizeBytes > TG_DOC_LIMIT) {
      await ctx.reply(TOO_BIG(formatBytes(sizeBytes)), { reply_markup: postDeliveryKb() });
      return;
    }

    const fileBase = req.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "site";
    const fileName = `${fileBase}.zip`;
    const fileCount = Object.keys(project.fileTree).length;
    const caption =
      `${req.name} · ${STACKS.find((s) => s.id === req.target_stack)?.label}\n` +
      `${fileCount} files · ${formatBytes(sizeBytes)}`;

    const deliveryText =
      `✅ Your site is ready!\n\n` +
      `Unzip it and follow README.md to run it. Want changes? Tap ✏️ Tweak or 🔄 Regenerate.`;

    await ctx.reply(deliveryText, { reply_markup: postDeliveryKb() });
    await ctx.replyWithDocument(new InputFile(zip, fileName), { caption });

    // Persist the request so regenerate/tweak survive a restart; retain per setting.
    const id = String(now());
    ctx.session.lastRequestId = id;
    const stored: StoredRequest = {
      ...req,
      _generatedAt: now(),
      _expiresAt: now() + settings.retentionHours * HOUR_MS,
    };
    await storeSet(reqKey(ctx, id), stored);
    await maintainIndex(ctx, id);

    // Ask ONCE for explicit consent to remember this user's stack + color choice
    // (User Profile entity). Skipped if they already answered.
    const profile = await storeGet<UserProfile>(profileKey(userId));
    if (!profile) {
      const stackLabel = STACKS.find((s) => s.id === req.target_stack)?.label ?? req.target_stack;
      const colorLabel =
        req.colors.scheme === "custom" ? `custom (${req.colors.custom ?? "?"})` : req.colors.scheme;
      await ctx.reply(
        `Want me to remember your stack (${stackLabel}) and colors (${colorLabel}) for next time?`,
        {
          reply_markup: inlineKeyboard([
            [inlineButton("Yes, save", "profile:save:yes"), inlineButton("No thanks", "profile:save:no")],
          ]),
        },
      );
    }

    await recordGeneration(userId, rlCfg);
    resetFlow(ctx);
  } catch (err) {
    console.error("[project-create] generation failed", err);
    await notifyAdmin(ctx, `Site generation failed for user ${userId}: ${String(err)}`);
    await ctx.reply(GEN_ERROR, { reply_markup: backToMenuKb });
  }
}

/** Send an admin alert to the configured owner chat; tolerate a 403 (the owner
 *  never started the bot, or blocked it) without throwing. */
async function notifyAdmin(ctx: Ctx, text: string): Promise<void> {
  const settings = await getSettings();
  const envAdmin = typeof process !== "undefined" ? process.env.ADMIN_CHAT_ID : undefined;
  const owner = settings.adminChatId ?? envAdmin;
  if (!owner) return;
  try {
    await ctx.api.sendMessage(String(owner), `⚠️ ${text}`);
  } catch {
    /* a 403 (owner never started / blocked the bot) must not abort the user reply */
  }
}

export default composer;
