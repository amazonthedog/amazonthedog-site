// Pulls Amazon's latest YouTube Shorts and writes them into index.html (between the YT-FEED markers).
// Runs in GitHub Actions (.github/workflows/youtube-feed.yml). No API key needed: it reads the
// channel's public RSS feed, and falls back to the public Shorts page when the feed is unavailable.
// If both fail, the page is left exactly as it was.
import { readFile, writeFile, mkdir, readdir, unlink } from "node:fs/promises";
import path from "node:path";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const PAGE = path.join(ROOT, "index.html");
const IMG_DIR = path.join(ROOT, "img", "yt");
const CHANNEL_ID = "UCW9MJtigWhH88ma5gh_Wwog";
const HANDLE = "AmazonTheDogDelivers";
const CHANNEL = `https://www.youtube.com/@${HANDLE}`;
const COUNT = Number(process.env.YT_COUNT || 6);
const START = "<!-- YT-FEED:START -->";
const END = "<!-- YT-FEED:END -->";
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36";

const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const cleanTitle = (t) => String(t || "").replace(/\s*\|\s*Amazon the Dog\s*$/i, "").trim();
const decodeXml = (s) => s.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'");

function shortViews(n) {
  if (n == null || Number.isNaN(n)) return "";
  if (n >= 1e6) return `${(n / 1e6).toFixed(n >= 1e7 ? 0 : 1).replace(/\.0$/, "")}M views`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(n >= 1e4 ? 0 : 1).replace(/\.0$/, "")}K views`;
  return `${n} view${n === 1 ? "" : "s"}`;
}

async function get(url) {
  const res = await fetch(url, { headers: { "user-agent": UA, "accept-language": "en-US,en;q=0.9" } });
  if (!res.ok) throw new Error(`${res.status} for ${url}`);
  return res.text();
}

// 1) The public RSS feed. "UUSH…" is the channel's Shorts-only playlist.
async function fromRss() {
  for (const q of [`playlist_id=UUSH${CHANNEL_ID.slice(2)}`, `channel_id=${CHANNEL_ID}`]) {
    try {
      const xml = await get(`https://www.youtube.com/feeds/videos.xml?${q}`);
      const items = [...xml.matchAll(/<entry>([\s\S]*?)<\/entry>/g)].map(([, e]) => ({
        id: (e.match(/<yt:videoId>([^<]+)</) || [])[1],
        title: decodeXml((e.match(/<title>([^<]*)</) || [])[1] || ""),
        views: Number((e.match(/<media:statistics views="(\d+)"/) || [])[1]),
      })).filter((v) => v.id);
      if (items.length) return { source: `RSS (${q.split("=")[0]})`, items };
    } catch (err) { console.log(`RSS ${q.split("=")[0]}: ${err.message}`); }
  }
  return null;
}

// 2) The public Shorts tab, which lists only Shorts that are already public.
async function fromShortsPage() {
  const html = await get(`${CHANNEL}/shorts`);
  const m = html.match(/var ytInitialData = (\{[\s\S]*?\});<\/script>/);
  if (!m) throw new Error("ytInitialData not found on the Shorts page");
  const data = JSON.parse(m[1]);
  const found = [];
  (function walk(o) {
    if (!o || typeof o !== "object") return;
    if (o.shortsLockupViewModel) found.push(o.shortsLockupViewModel);
    for (const v of Object.values(o)) walk(v);
  })(data);
  const items = found.map((v) => {
    const id = v.onTap?.innertubeCommand?.reelWatchEndpoint?.videoId;
    const title = v.overlayMetadata?.primaryText?.content || "";
    const viewsText = v.overlayMetadata?.secondaryText?.content || "";
    return { id, title, viewsText };
  }).filter((v) => v.id);
  if (!items.length) throw new Error("no Shorts found on the Shorts page");
  return { source: "Shorts page", items };
}

async function saveThumb(id) {
  let sharp;
  try { sharp = (await import("sharp")).default; } catch { return false; }
  const res = await fetch(`https://i.ytimg.com/vi/${id}/oardefault.jpg`, { headers: { "user-agent": UA } });
  if (!res.ok) return false;
  const buf = Buffer.from(await res.arrayBuffer());
  await mkdir(IMG_DIR, { recursive: true });
  for (const w of [360, 720]) {
    await sharp(buf).resize({ width: w, height: Math.round(w * 16 / 9), fit: "cover" }).webp({ quality: 74 })
      .toFile(path.join(IMG_DIR, `${id}-${w}.webp`));
  }
  return true;
}

function tile(v, local) {
  const title = cleanTitle(v.title);
  const views = v.viewsText || shortViews(v.views);
  const img = local
    ? `<img src="img/yt/${v.id}-360.webp" srcset="img/yt/${v.id}-360.webp 360w, img/yt/${v.id}-720.webp 720w" sizes="(max-width: 880px) 33vw, 180px" width="720" height="1280" alt="${esc(`YouTube Short from Amazon the Dog: ${title}`)}" loading="lazy" decoding="async">`
    : `<img src="https://i.ytimg.com/vi/${v.id}/oardefault.jpg" width="1080" height="1920" alt="${esc(`YouTube Short from Amazon the Dog: ${title}`)}" loading="lazy" decoding="async">`;
  return `        <a class="yt-tile" href="https://www.youtube.com/shorts/${esc(v.id)}" target="_blank" rel="noopener">
          ${img}
          <span class="yt-cap">${views ? `<b>${esc(views)}</b>` : ""}<span>${esc(title)}</span></span>
        </a>`;
}

function section(items, localIds) {
  return `
  <section class="section yt-feed" id="youtube" style="padding-top: 0;" aria-labelledby="yt-title">
    <div class="wrap">
      <div class="head">
        <div style="display:grid; gap:12px;">
          <p class="eyebrow">Fresh from YouTube</p>
          <h2 class="h2" id="yt-title">Her latest Shorts.</h2>
        </div>
        <a class="ig-handle" href="${CHANNEL}" target="_blank" rel="noopener">@${HANDLE}</a>
      </div>
      <div class="yt-grid">
${items.map((v) => tile(v, localIds.has(v.id))).join("\n")}
      </div>
      <div class="ig-foot">
        <a class="btn btn-yt" href="${CHANNEL}?sub_confirmation=1" target="_blank" rel="noopener">Subscribe on YouTube</a>
      </div>
    </div>
  </section>
  `;
}

let feed = null;
try { feed = await fromRss(); } catch (err) { console.log(`RSS: ${err.message}`); }
if (!feed) {
  try { feed = await fromShortsPage(); } catch (err) { console.log(`Shorts page: ${err.message}`); }
}
if (!feed) {
  console.log("::warning::Could not read the YouTube channel; the page was left unchanged.");
  process.exit(0);
}

const items = feed.items.slice(0, COUNT);
const localIds = new Set();
for (const v of items) if (await saveThumb(v.id).catch(() => false)) localIds.add(v.id);

// Remove thumbnails of Shorts that dropped off the row
const keep = new Set([...localIds].flatMap((id) => [`${id}-360.webp`, `${id}-720.webp`]));
try { for (const f of await readdir(IMG_DIR)) if (f.endsWith(".webp") && !keep.has(f)) await unlink(path.join(IMG_DIR, f)); } catch {}

const html = await readFile(PAGE, "utf8");
const a = html.indexOf(START), b = html.indexOf(END);
if (a < 0 || b < a) throw new Error("YT-FEED markers not found in index.html");
const next = html.slice(0, a + START.length) + section(items, localIds) + html.slice(b);
if (next !== html) await writeFile(PAGE, next);
console.log(`YouTube feed: ${items.length} Shorts from ${feed.source}, ${localIds.size} thumbnails saved${next === html ? " (no change)" : " (updated)"}`);
