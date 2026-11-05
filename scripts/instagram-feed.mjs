// Pulls Amazon's latest Instagram posts and writes them into index.html.
// Runs in GitHub Actions (.github/workflows/instagram-feed.yml).
// Needs: IG_ACCESS (Instagram API with Instagram Login token) and the "sharp" package.
import { readFile, writeFile, mkdir, readdir, unlink, access } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const PAGE = path.join(ROOT, "index.html");
const IMG_DIR = path.join(ROOT, "img", "ig");
const TOKEN = process.env.IG_ACCESS;
// "IG..." tokens come from Instagram Login (graph.instagram.com, /me works).
// "EAA..." tokens come from Meta's Unified Login (graph.facebook.com, needs the Instagram account ID).
const IG_LOGIN_TOKEN = String(TOKEN || "").startsWith("IG");
const IG_USER_ID = process.env.IG_USER_ID || "17841473158483651"; // @amazonthedog__
const API = process.env.IG_API_BASE || (IG_LOGIN_TOKEN ? "https://graph.instagram.com" : "https://graph.facebook.com/v23.0");
const MEDIA_PATH = IG_LOGIN_TOKEN ? "me/media" : `${IG_USER_ID}/media`;
const COUNT = Number(process.env.IG_COUNT || 9);
const PROFILE = "https://www.instagram.com/amazonthedog__";
const START = "<!-- IG-FEED:START -->";
const END = "<!-- IG-FEED:END -->";

if (!TOKEN) { console.error("IG_ACCESS is not set"); process.exit(1); }

const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const exists = (p) => access(p).then(() => true, () => false);

function snippet(caption, max) {
  const text = (caption || "").replace(/#[\p{L}\p{N}_]+/gu, "").replace(/\s+/g, " ").trim();
  if (text.length <= max) return text;
  return text.slice(0, max).replace(/\s+\S*$/, "") + "…";
}

async function getPosts() {
  const fields = "id,caption,media_type,media_url,thumbnail_url,permalink,timestamp";
  const url = `${API}/${MEDIA_PATH}?fields=${fields}&limit=25&access_token=${encodeURIComponent(TOKEN)}`;
  const res = await fetch(url);
  const body = await res.json().catch(() => ({}));
  if (!res.ok || body.error) {
    throw new Error(`Instagram API ${res.status}: ${body.error?.message || "unknown error"}`);
  }
  return (body.data || [])
    .map((p) => ({ ...p, image: p.media_type === "VIDEO" ? p.thumbnail_url : p.media_url }))
    .filter((p) => p.image && p.permalink)
    .slice(0, COUNT);
}

async function saveImages(post) {
  const small = path.join(IMG_DIR, `${post.id}-400.webp`);
  const large = path.join(IMG_DIR, `${post.id}-800.webp`);
  if ((await exists(small)) && (await exists(large))) return;
  const res = await fetch(post.image);
  if (!res.ok) throw new Error(`Image download failed for ${post.id}: ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  await sharp(buf).rotate().resize(800, 800, { fit: "cover" }).webp({ quality: 78 }).toFile(large);
  await sharp(buf).rotate().resize(400, 400, { fit: "cover" }).webp({ quality: 74 }).toFile(small);
}

const ICON_REEL = '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M8 5.5v13l11-6.5z"/></svg>';
const ICON_ALBUM = '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M8 3h11a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2zM3 8v11a2 2 0 0 0 2 2h11v-2H5V8z"/></svg>';

function tile(post) {
  const date = new Date(post.timestamp);
  const when = date.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "America/New_York" });
  const kind = post.media_type === "VIDEO" ? "Reel" : post.media_type === "CAROUSEL_ALBUM" ? "Photos" : "Photo";
  const text = snippet(post.caption, 110);
  const alt = text ? `${kind} from Amazon the Dog: ${snippet(post.caption, 140)}` : `${kind} from Amazon the Dog`;
  const badge = post.media_type === "VIDEO" ? `<span class="ig-badge">${ICON_REEL}</span>`
    : post.media_type === "CAROUSEL_ALBUM" ? `<span class="ig-badge">${ICON_ALBUM}</span>` : "";
  return `        <a class="ig-tile" href="${esc(post.permalink)}" target="_blank" rel="noopener">
          <img src="img/ig/${post.id}-400.webp" srcset="img/ig/${post.id}-400.webp 400w, img/ig/${post.id}-800.webp 800w" sizes="(max-width: 880px) 33vw, 370px" width="800" height="800" alt="${esc(alt)}" loading="lazy" decoding="async">
          ${badge}<span class="ig-cap"><time datetime="${esc(post.timestamp)}">${esc(when)}</time>${text ? `<span>${esc(text)}</span>` : ""}</span>
        </a>`;
}

function section(posts) {
  if (!posts.length) return "";
  return `
  <section class="section ig-feed" id="instagram" style="padding-top: 0;" aria-labelledby="ig-title">
    <div class="wrap">
      <div class="head">
        <div style="display:grid; gap:12px;">
          <p class="eyebrow">Fresh from Instagram</p>
          <h2 class="h2" id="ig-title">The latest catches.</h2>
        </div>
        <a class="ig-handle" href="${PROFILE}" target="_blank" rel="noopener">@amazonthedog__</a>
      </div>
      <div class="ig-grid">
${posts.map(tile).join("\n")}
      </div>
      <div class="ig-foot">
        <a class="btn btn-ig" href="${PROFILE}" target="_blank" rel="noopener">Join the conversation on Instagram</a>
      </div>
    </div>
  </section>
  `;
}

const posts = await getPosts();
await mkdir(IMG_DIR, { recursive: true });
for (const p of posts) await saveImages(p);

const keep = new Set(posts.flatMap((p) => [`${p.id}-400.webp`, `${p.id}-800.webp`]));
for (const f of await readdir(IMG_DIR)) if (!keep.has(f) && f.endsWith(".webp")) await unlink(path.join(IMG_DIR, f));

const html = await readFile(PAGE, "utf8");
const a = html.indexOf(START), b = html.indexOf(END);
if (a < 0 || b < a) throw new Error("IG-FEED markers not found in index.html");
const next = html.slice(0, a + START.length) + section(posts) + html.slice(b);
if (next !== html) await writeFile(PAGE, next);
console.log(`Instagram feed: ${posts.length} posts${next === html ? " (no change)" : " (updated)"}`);
