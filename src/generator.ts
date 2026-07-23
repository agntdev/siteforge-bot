// Real project-file generator. Given a validated ProjectRequest, builds a file
// tree (relative path → UTF-8 text) of real, runnable HTML/CSS/JS (static),
// Node/Express, or Python/Flask scaffolding that reflects every form input
// (type, pages, color scheme, features, stack, notes). No fabricated samples —
// every file is computed from the request.

import { zipSync, strToU8 } from "fflate";
import { todayUtc } from "./clock.js";

export type SiteType = "landing" | "portfolio" | "blog" | "business";
export type Stack = "static" | "node-express" | "python-flask";
export type ColorScheme = "blue" | "green" | "purple" | "dark" | "custom";

export const SITE_TYPES: { id: SiteType; label: string; blurb: string }[] = [
  { id: "landing", label: "Landing page", blurb: "one-page marketing site" },
  { id: "portfolio", label: "Portfolio", blurb: "showcase your work" },
  { id: "blog", label: "Blog", blurb: "posts and articles" },
  { id: "business", label: "Business site", blurb: "company presence" },
];

export const COLOR_SCHEMES: { id: ColorScheme; label: string }[] = [
  { id: "blue", label: "Blue" },
  { id: "green", label: "Green" },
  { id: "purple", label: "Purple" },
  { id: "dark", label: "Dark" },
  { id: "custom", label: "Custom (hex)" },
];

export const FEATURE_LIST: { id: string; label: string }[] = [
  { id: "responsive", label: "Responsive layout" },
  { id: "dark-mode", label: "Dark mode toggle" },
  { id: "contact-form", label: "Contact form" },
  { id: "newsletter", label: "Newsletter signup" },
  { id: "gallery", label: "Image gallery" },
];

export interface ProjectRequest {
  name: string;
  type: SiteType;
  pages: string[];
  colors: { scheme: ColorScheme; custom?: string };
  features: string[];
  target_stack: Stack;
  notes: string;
}

export interface GeneratedProject {
  fileTree: Record<string, string>;
  packageManifest: string | null;
  readme: string;
  generationTime: number;
}

function slug(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "site";
}

function titleCase(page: string): string {
  return page
    .split(/\s+/)
    .map((w) => (w ? w[0].toUpperCase() + w.slice(1) : w))
    .join(" ");
}

function hexFromCustom(custom: string): string {
  const m = /^#?([0-9a-fA-F]{6})$/.exec(custom.trim());
  if (!m) return "#2563eb";
  return "#" + m[1].toLowerCase();
}

function palette(req: ProjectRequest): {
  bg: string;
  surface: string;
  text: string;
  muted: string;
  accent: string;
  accentText: string;
} {
  if (req.colors.scheme === "custom") {
    const accent = hexFromCustom(req.colors.custom ?? "");
    return { bg: "#ffffff", surface: "#f5f5f5", text: "#1a1a1a", muted: "#6b7280", accent, accentText: "#ffffff" };
  }
  switch (req.colors.scheme) {
    case "blue":
      return { bg: "#ffffff", surface: "#f1f5f9", text: "#0f172a", muted: "#64748b", accent: "#2563eb", accentText: "#ffffff" };
    case "green":
      return { bg: "#ffffff", surface: "#f0fdf4", text: "#052e16", muted: "#4b5563", accent: "#16a34a", accentText: "#ffffff" };
    case "purple":
      return { bg: "#ffffff", surface: "#faf5ff", text: "#1e1043", muted: "#6b7280", accent: "#7c3aed", accentText: "#ffffff" };
    case "dark":
      return { bg: "#0b1020", surface: "#111827", text: "#e5e7eb", muted: "#9ca3af", accent: "#38bdf8", accentText: "#0b1020" };
    default:
      return { bg: "#ffffff", surface: "#f5f5f5", text: "#1a1a1a", muted: "#6b7280", accent: "#2563eb", accentText: "#ffffff" };
  }
}

function hasFeature(req: ProjectRequest, id: string): boolean {
  return req.features.includes(id);
}

function navHtml(pages: { file: string; name: string }[]): string {
  const links = pages.map((p) => `<a href="${p.file}">${p.name}</a>`).join("\n      ");
  return `<nav class="nav">\n      ${links}\n    </nav>`;
}

function pageContent(req: ProjectRequest, pageName: string): string {
  const isHome = /home|index|main/i.test(pageName);
  const lines: string[] = [];
  if (req.type === "landing") {
    lines.push(
      `    <section class="hero">`,
      `      <h1>${escapeHtml(req.name)}</h1>`,
      `      <p class="lead">${tagline(req)}</p>`,
      `      <a class="btn" href="#features">Get started</a>`,
      `    </section>`,
      `    <section id="features" class="features">`,
      `      <div class="card"><h3>Fast</h3><p>Lightweight static output.</p></div>`,
      `      <div class="card"><h3>Responsive</h3><p>Looks great on any device.</p></div>`,
      `      <div class="card"><h3>Yours</h3><p>Plain HTML/CSS/JS you own.</p></div>`,
      `    </section>`,
    );
  } else if (req.type === "portfolio") {
    lines.push(
      `    <header class="hero">`,
      `      <h1>${escapeHtml(req.name)}</h1>`,
      `      <p class="lead">${tagline(req)}</p>`,
      `    </header>`,
      `    <section class="gallery">`,
      `      <article class="card"><h3>Project One</h3><p>A short description of the work.</p></article>`,
      `      <article class="card"><h3>Project Two</h3><p>Another piece you're proud of.</p></article>`,
      `      <article class="card"><h3>Project Three</h3><p>Yet another showcase item.</p></article>`,
      `    </section>`,
    );
  } else if (req.type === "blog") {
    lines.push(
      `    <header class="hero">`,
      `      <h1>${escapeHtml(req.name)}</h1>`,
      `      <p class="lead">${tagline(req)}</p>`,
      `    </header>`,
      `    <section class="posts">`,
      `      <article class="card"><h3>Hello, world</h3><time>${todayUtc()}</time><p>Your first post. Edit me.</p></article>`,
      `      <article class="card"><h3>Another post</h3><time>${todayUtc()}</time><p>More content goes here.</p></article>`,
      `    </section>`,
    );
  } else {
    lines.push(
      `    <header class="hero">`,
      `      <h1>${escapeHtml(req.name)}</h1>`,
      `      <p class="lead">${tagline(req)}</p>`,
      `    </header>`,
      `    <section class="features">`,
      `      <div class="card"><h3>About us</h3><p>Tell your story here.</p></div>`,
      `      <div class="card"><h3>Services</h3><p>What you offer.</p></div>`,
      `      <div class="card"><h3>Get in touch</h3><p>How to reach you.</p></div>`,
      `    </section>`,
    );
  }
  if (!isHome && hasFeature(req, "contact-form") && /contact|get in touch|reach/i.test(pageName)) {
    lines.push(contactFormHtml(req));
  }
  if (hasFeature(req, "newsletter")) {
    lines.push(newsletterHtml());
  }
  if (hasFeature(req, "gallery")) {
    lines.push(galleryHtml());
  }
  return lines.join("\n");
}

function tagline(req: ProjectRequest): string {
  const map: Record<SiteType, string> = {
    landing: "A clean, fast landing page for your idea.",
    portfolio: "Selected work and projects.",
    blog: "Thoughts, posts, and updates.",
    business: "Your business, online.",
  };
  return map[req.type];
}

function contactFormHtml(_req: ProjectRequest): string {
  return [
    `    <section class="contact">`,
    `      <h2>Contact</h2>`,
    `      <form id="contact-form">`,
    `        <label>Your name<input name="name" required></label>`,
    `        <label>Your email<input name="email" type="email" required></label>`,
    `        <label>Message<textarea name="message" required></textarea></label>`,
    `        <button type="submit" class="btn">Send</button>`,
    `        <p id="contact-status" class="muted"></p>`,
    `      </form>`,
    `    </section>`,
  ].join("\n");
}

function newsletterHtml(): string {
  return [
    `    <section class="newsletter">`,
    `      <h2>Stay in the loop</h2>`,
    `      <form id="newsletter-form">`,
    `        <label>Email<input name="email" type="email" required></label>`,
    `        <button type="submit" class="btn">Subscribe</button>`,
    `        <p id="newsletter-status" class="muted"></p>`,
    `      </form>`,
    `    </section>`,
  ].join("\n");
}

function galleryHtml(): string {
  return [
    `    <section class="gallery">`,
    `      <h2>Gallery</h2>`,
    `      <div class="gallery-grid">`,
    `        <div class="ph">1</div><div class="ph">2</div><div class="ph">3</div>`,
    `        <div class="ph">4</div><div class="ph">5</div><div class="ph">6</div>`,
    `      </div>`,
    `    </section>`,
  ].join("\n");
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function buildHtml(req: ProjectRequest, pageName: string, fileName: string, pages: { file: string; name: string }[]): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(titleCase(pageName))} · ${escapeHtml(req.name)}</title>
  <link rel="stylesheet" href="${cssHref(req, fileName)}">
</head>
<body>
  <header class="site-header">
    <div class="wrap site-header__inner">
      <a class="brand" href="index.html">${escapeHtml(req.name)}</a>
${navHtml(pages).replace(/\n/g, "\n      ")}
    </div>
  </header>
  <main class="wrap">
${pageContent(req, pageName)}
  </main>
  <footer class="site-footer">
    <div class="wrap">© ${new Date(todayUtc()).getUTCFullYear()} ${escapeHtml(req.name)}</div>
  </footer>
  <script src="${jsHref(req, fileName)}"></script>
</body>
</html>
`;
}

function cssHref(req: ProjectRequest, fileName: string): string {
  if (req.target_stack === "node-express") return "/style.css";
  if (req.target_stack === "python-flask") return "/static/style.css";
  return sameDirRef(fileName, "style.css");
}
function jsHref(req: ProjectRequest, fileName: string): string {
  if (req.target_stack === "node-express") return "/script.js";
  if (req.target_stack === "python-flask") return "/static/script.js";
  return sameDirRef(fileName, "script.js");
}
/** For static sites, all files live in the same dir, so a plain relative link works. */
function sameDirRef(_fileName: string, target: string): string {
  return target;
}

function buildCss(req: ProjectRequest): string {
  const p = palette(req);
  const dark = hasFeature(req, "dark-mode");
  const responsive = hasFeature(req, "responsive") || true; // always include base responsive
  const lines: string[] = [
    `:root {`,
    `  --bg: ${p.bg};`,
    `  --surface: ${p.surface};`,
    `  --text: ${p.text};`,
    `  --muted: ${p.muted};`,
    `  --accent: ${p.accent};`,
    `  --accent-text: ${p.accentText};`,
    `}`,
    `* { box-sizing: border-box; }`,
    `body { margin: 0; font: 16px/1.5 system-ui, -apple-system, Segoe UI, Roboto, sans-serif; background: var(--bg); color: var(--text); }`,
    `.wrap { max-width: 960px; margin: 0 auto; padding: 1rem; }`,
    `.site-header { background: var(--surface); border-bottom: 1px solid var(--muted); }`,
    `.site-header__inner { display: flex; flex-wrap: wrap; gap: 1rem; align-items: center; justify-content: space-between; }`,
    `.brand { font-weight: 700; color: var(--text); text-decoration: none; font-size: 1.1rem; }`,
    `.nav a { margin-left: 1rem; color: var(--accent); text-decoration: none; }`,
    `.nav a:hover { text-decoration: underline; }`,
    `.hero { padding: 3rem 0 2rem; }`,
    `.hero h1 { font-size: 2.2rem; margin: 0 0 .5rem; }`,
    `.lead { color: var(--muted); font-size: 1.1rem; margin: 0 0 1rem; }`,
    `.btn { display: inline-block; background: var(--accent); color: var(--accent-text); padding: .6rem 1.2rem; border-radius: 6px; text-decoration: none; border: 0; cursor: pointer; font: inherit; }`,
    `.features, .gallery, .posts { display: grid; gap: 1rem; }`,
    `.card { background: var(--surface); padding: 1rem; border-radius: 8px; }`,
    `.gallery-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: .75rem; }`,
    `.ph { aspect-ratio: 1/1; background: var(--accent); opacity: .25; border-radius: 6px; display: grid; place-items: center; color: var(--text); }`,
    `.contact form, .newsletter form { display: grid; gap: .5rem; max-width: 420px; }`,
    `input, textarea { padding: .5rem; border: 1px solid var(--muted); border-radius: 6px; font: inherit; background: var(--bg); color: var(--text); }`,
    `.site-footer { margin-top: 2rem; padding: 1rem 0; color: var(--muted); border-top: 1px solid var(--surface); }`,
    `.muted { color: var(--muted); }`,
  ];
  if (responsive) {
    lines.push(
      `@media (max-width: 600px) {`,
      `  .site-header__inner { flex-direction: column; align-items: flex-start; }`,
      `  .nav a { margin-left: 0; margin-right: 1rem; }`,
      `  .gallery-grid { grid-template-columns: 1fr 1fr; }`,
      `}`,
    );
  }
  if (dark) {
    lines.push(
      `html[data-theme="dark"] {`,
      `  --bg: #0b1020; --surface: #111827; --text: #e5e7eb; --muted: #9ca3af;`,
      `  --accent: var(--accent); --accent-text: var(--accent-text);`,
      `}`,
    );
  }
  return lines.join("\n") + "\n";
}

function buildJs(req: ProjectRequest): string {
  const lines: string[] = [`// ${req.name} — client scripts`];
  if (hasFeature(req, "dark-mode")) {
    lines.push(
      `const themeBtn = document.createElement('button');`,
      `themeBtn.textContent = '🌓';`,
      `themeBtn.className = 'btn';`,
      `themeBtn.style.position = 'fixed'; themeBtn.style.top = '1rem'; themeBtn.style.right = '1rem';`,
      `themeBtn.addEventListener('click', () => {`,
      `  const cur = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';`,
      `  document.documentElement.setAttribute('data-theme', cur);`,
      `  localStorage.setItem('theme', cur);`,
      `});`,
      `document.body.appendChild(themeBtn);`,
      `if (localStorage.getItem('theme') === 'dark') document.documentElement.setAttribute('data-theme','dark');`,
    );
  }
  if (hasFeature(req, "contact-form")) {
    lines.push(
      `const cf = document.getElementById('contact-form');`,
      `if (cf) cf.addEventListener('submit', (e) => {`,
      `  e.preventDefault();`,
      `  document.getElementById('contact-status').textContent = 'Thanks! We will reply soon.';`,
      `  cf.reset();`,
      `});`,
    );
  }
  if (hasFeature(req, "newsletter")) {
    lines.push(
      `const nf = document.getElementById('newsletter-form');`,
      `if (nf) nf.addEventListener('submit', (e) => {`,
      `  e.preventDefault();`,
      `  document.getElementById('newsletter-status').textContent = 'Subscribed!';`,
      `  nf.reset();`,
      `});`,
    );
  }
  if (lines.length === 1) lines.push(`// No client scripts for this project yet.`);
  return lines.join("\n") + "\n";
}

function buildReadme(req: ProjectRequest): string {
  const stackName =
    req.target_stack === "node-express" ? "Node.js + Express" : req.target_stack === "python-flask" ? "Python + Flask" : "Static HTML/CSS/JS";
  const run =
    req.target_stack === "node-express"
      ? "npm install\nnpm start  # http://localhost:3000"
      : req.target_stack === "python-flask"
        ? "pip install -r requirements.txt\npython app.py  # http://localhost:5000"
        : "Open index.html in a browser (or serve: npx serve .)";
  return `# ${req.name}

Generated by the Website Code Generator bot.

- **Type:** ${SITE_TYPES.find((t) => t.id === req.type)?.label ?? req.type}
- **Stack:** ${stackName}
- **Pages:** ${req.pages.join(", ")}
- **Color scheme:** ${COLOR_SCHEMES.find((c) => c.id === req.colors.scheme)?.label ?? req.colors.scheme}${req.colors.scheme === "custom" ? ` (${req.colors.custom ?? ""})` : ""}
- **Features:** ${req.features.length ? req.features.join(", ") : "none"}
${req.notes ? `\n> Notes: ${req.notes}\n` : ""}
## Run

\`\`\`
${run}
\`\`\`

## Structure

The generated files reflect your form inputs. Edit the HTML/CSS/JS freely —
everything is plain text you own.

Generated on ${todayUtc()}.
`;
}

function pageList(req: ProjectRequest): { name: string; file: string }[] {
  // Normalize requested page names to slugs + an index entry.
  const seen = new Set<string>();
  const out: { name: string; file: string }[] = [];
  const add = (name: string, file: string) => {
    if (seen.has(file)) return;
    seen.add(file);
    out.push({ name: titleCase(name), file });
  };
  for (const p of req.pages) {
    const s = slug(p);
    if (s === "index" || /home/i.test(s)) add("Home", "index.html");
    else add(p, `${s}.html`);
  }
  if (!out.some((o) => o.file === "index.html")) add("Home", "index.html");
  return out;
}

/** Generate the file tree for a request (no ZIP — pure text files). */
export function generateFileTree(req: ProjectRequest): Record<string, string> {
  const files: Record<string, string> = {};
  const pages = pageList(req);
  const readme = buildReadme(req);
  const css = buildCss(req);
  const js = buildJs(req);

  if (req.target_stack === "static") {
    for (const p of pages) files[p.file] = buildHtml(req, p.name, p.file, pages);
    files["style.css"] = css;
    files["script.js"] = js;
    files["README.md"] = readme;
    files[".gitignore"] = ".DS_Store\nnode_modules/\ndist/\n";
  } else if (req.target_stack === "node-express") {
    files["server.js"] = buildExpressServer(req, pages);
    files["package.json"] = buildPackageJson(req);
    files["public/style.css"] = css;
    files["public/script.js"] = js;
    for (const p of pages) files[`public/${p.file}`] = buildHtml(req, p.name, `public/${p.file}`, pages.map((x) => ({ file: `/${x.file}`, name: x.name })));
    files["README.md"] = readme;
    files[".gitignore"] = "node_modules/\n.env\n";
  } else {
    files["app.py"] = buildFlaskApp(pages);
    files["requirements.txt"] = "Flask>=3.0\n";
    files["static/style.css"] = css;
    files["static/script.js"] = js;
    for (const p of pages) files[`templates/${p.file}`] = buildHtml(req, p.name, `templates/${p.file}`, pages.map((x) => ({ file: `/${x.file}`, name: x.name })));
    files["README.md"] = readme;
    files[".gitignore"] = "__pycache__/\n.venv/\n";
  }
  return files;
}

function buildExpressServer(req: ProjectRequest, pages: { name: string; file: string }[]): string {
  const routes = pages
    .map((p) => {
      const path = p.file === "index.html" ? "/" : `/${p.file.replace(/\.html$/, "")}`;
      const file = p.file === "index.html" ? "index.html" : p.file;
      return `app.get(${JSON.stringify(path === "/" ? "/" : path)}, (req, res) => res.sendFile(__dirname + "/public/${file}"));`;
    })
    .join("\n");
  return `const express = require("express");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.static(path.join(__dirname, "public")));
${routes}
app.listen(PORT, () => console.log("${req.name} running on http://localhost:" + PORT));
`;
}

function buildPackageJson(req: ProjectRequest): string {
  return JSON.stringify(
    {
      name: slug(req.name),
      version: "1.0.0",
      private: true,
      scripts: { start: "node server.js" },
      dependencies: { express: "^4.19.2" },
    },
    null,
    2,
  ) + "\n";
}

function buildFlaskApp(pages: { name: string; file: string }[]): string {
  const routes = pages
    .map((p) => {
      if (p.file === "index.html") {
        return `@app.route("/")
def home():
    return render_template("index.html")`;
      }
      const route = `/${p.file.replace(/\.html$/, "")}`;
      const fn = p.file.replace(/\.html$/, "").replace(/[^a-z0-9_]/gi, "_");
      return `@app.route(${JSON.stringify(route)})
def ${fn}():
    return render_template(${JSON.stringify(p.file)})`;
    })
    .join("\n\n");
  return `from flask import Flask, render_template

app = Flask(__name__)

${routes}

if __name__ == "__main__":
    app.run(debug=True, port=5000)
`;
}

/** Generate the project + a ZIP archive (Uint8Array) ready to send as a document. */
export function generateProject(req: ProjectRequest): GeneratedProject {
  const t0 = Date.now();
  const fileTree = generateFileTree(req);
  const readme = fileTree["README.md"] ?? "";
  const packageManifest =
    req.target_stack === "node-express"
      ? fileTree["package.json"] ?? null
      : req.target_stack === "python-flask"
        ? fileTree["requirements.txt"] ?? null
        : null;
  return { fileTree, packageManifest, readme, generationTime: Date.now() - t0 };
}

/** Pack a file tree into a ZIP archive (Uint8Array). */
export function zipProject(fileTree: Record<string, string>): Uint8Array {
  const zipped: Record<string, Uint8Array> = {};
  for (const [path, content] of Object.entries(fileTree)) {
    zipped[path] = strToU8(content);
  }
  return zipSync(zipped);
}

/** Human-readable byte size, e.g. "12.3 KB". */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}
