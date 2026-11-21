// Fills the "Where she'll be" section of index.html (between the EVENTS markers) from
// Amazon's public Google Calendar. Runs in GitHub Actions (.github/workflows/events-feed.yml).
//
// Rob adds an event in Google Calendar on his phone; within a few hours it shows on the site.
// - Only upcoming events show (up to EVENTS_MAX, default 6), soonest first.
// - An event set to "Private" in Google Calendar shows as "Busy" in the public feed and is skipped.
// - Leave Location empty for visits whose place shouldn't be public.
// - Times show in the calendar's own time zone (its X-WR-TIMEZONE), Eastern if it has none.
//
// Settings (environment):
//   EVENTS_ICS_URL   the calendar's "Public address in iCal format" (a repo variable on GitHub)
//   EVENTS_ICS_FILE  read a local .ics file instead (for testing)
//   EVENTS_MAX       how many upcoming events to show (default 6)
//   EVENTS_NOW       pretend "now" is this date (for testing), e.g. 2026-12-01
// With neither URL nor file set, it writes the empty state (invite card only).
// If the calendar can't be read, the page is left exactly as it was.
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const PAGE = process.env.EVENTS_PAGE || path.join(ROOT, "index.html");
const START = "<!-- EVENTS:START -->";
const END = "<!-- EVENTS:END -->";
const MAX = Number(process.env.EVENTS_MAX || 6);
const NOW = process.env.EVENTS_NOW ? new Date(process.env.EVENTS_NOW) : new Date();
const HORIZON_DAYS = 400;
const INSTAGRAM_DM = "https://ig.me/m/amazonthedog__";

const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

// ---------- reading the .ics ----------
function unfold(text) {
  return text.replace(/\r\n/g, "\n").replace(/\n[ \t]/g, "").split("\n");
}
function unescapeText(v) {
  return v.replace(/\\n/gi, "\n").replace(/\\,/g, ",").replace(/\\;/g, ";").replace(/\\\\/g, "\\");
}
function parseLine(line) {
  const i = line.indexOf(":");
  if (i < 0) return null;
  const head = line.slice(0, i), value = line.slice(i + 1);
  const [name, ...rest] = head.split(";");
  const params = {};
  for (const p of rest) { const [k, v] = p.split("="); if (k) params[k.toUpperCase()] = (v || "").replace(/^"|"$/g, ""); }
  return { name: name.toUpperCase(), params, value };
}
function parseIcs(text) {
  const cal = { tz: null, events: [] };
  let ev = null;
  for (const raw of unfold(text)) {
    const l = parseLine(raw);
    if (!l) continue;
    if (l.name === "X-WR-TIMEZONE" && !ev) cal.tz = l.value.trim();
    else if (l.name === "BEGIN" && l.value === "VEVENT") ev = { exdates: [] };
    else if (l.name === "END" && l.value === "VEVENT") { if (ev) cal.events.push(ev); ev = null; }
    else if (ev) {
      if (l.name === "EXDATE") ev.exdates.push(...l.value.split(",").map((v) => ({ value: v, params: l.params })));
      else ev[l.name] = l;
    }
  }
  return cal;
}

// ---------- time zones (no libraries) ----------
function tzOffsetMs(instant, tz) {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" }).formatToParts(new Date(instant));
  const g = Object.fromEntries(parts.map((p) => [p.type, p.value]));
  return Date.UTC(+g.year, +g.month - 1, +g.day, +g.hour, +g.minute, +g.second) - instant;
}
function zonedToUtc(y, mo, d, h, mi, s, tz) {
  const guess = Date.UTC(y, mo, d, h, mi, s);
  let t = guess - tzOffsetMs(guess, tz);
  t = guess - tzOffsetMs(t, tz);
  return t;
}
// Returns { t: ms since epoch, allDay: bool }
function parseDate(prop, calTz) {
  if (!prop) return null;
  const v = prop.value.trim();
  const m = v.match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})(Z)?)?$/);
  if (!m) return null;
  const [, y, mo, d, h, mi, s, z] = m;
  if (h === undefined || prop.params.VALUE === "DATE") {
    return { t: zonedToUtc(+y, +mo - 1, +d, 0, 0, 0, calTz), allDay: true, ymd: [+y, +mo - 1, +d] };
  }
  if (z) return { t: Date.UTC(+y, +mo - 1, +d, +h, +mi, +s), allDay: false };
  const tz = prop.params.TZID || calTz;
  return { t: zonedToUtc(+y, +mo - 1, +d, +h, +mi, +s, tz), allDay: false };
}

// ---------- repeating events (daily / weekly / monthly / yearly) ----------
const DAYS = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"];
function expand(ev, start, end, calTz, until) {
  const rule = ev.RRULE ? Object.fromEntries(ev.RRULE.value.split(";").map((kv) => kv.split("="))) : null;
  const dur = end.t - start.t;
  if (!rule) return [{ t: start.t, end: end.t }];
  const freq = rule.FREQ, interval = Number(rule.INTERVAL || 1);
  const count = rule.COUNT ? Number(rule.COUNT) : Infinity;
  const ruleUntil = rule.UNTIL ? parseDate({ value: rule.UNTIL, params: {} }, calTz).t : Infinity;
  const stop = Math.min(until, ruleUntil);
  const byday = rule.BYDAY ? rule.BYDAY.split(",").map((d) => DAYS.indexOf(d.slice(-2))) : null;
  const exd = new Set(ev.exdates.map((x) => parseDate(x, calTz)?.t));
  // Walk in the calendar's wall-clock time so DST shifts keep the same local hour.
  const tz = ev.DTSTART.params.TZID || calTz;
  const off = tzOffsetMs(start.t, tz);
  const local = new Date(start.t + off);
  const [Y, M, D, h, mi, s] = [local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate(), local.getUTCHours(), local.getUTCMinutes(), local.getUTCSeconds()];
  const at = (y, mo, d) => (start.allDay ? zonedToUtc(y, mo, d, 0, 0, 0, calTz) : zonedToUtc(y, mo, d, h, mi, s, tz));
  const out = [];
  let n = 0;
  for (let step = 0; step < 2000 && n < count; step++) {
    let candidates = [];
    if (freq === "DAILY") candidates = [[Y, M, D + step * interval]];
    else if (freq === "WEEKLY") {
      const base = new Date(Date.UTC(Y, M, D + step * 7 * interval));
      const weekStart = new Date(base); weekStart.setUTCDate(base.getUTCDate() - base.getUTCDay());
      const days = byday || [new Date(Date.UTC(Y, M, D)).getUTCDay()];
      candidates = days.slice().sort((a, b) => a - b).map((wd) => [weekStart.getUTCFullYear(), weekStart.getUTCMonth(), weekStart.getUTCDate() + wd]);
    } else if (freq === "MONTHLY") candidates = [[Y, M + step * interval, D]];
    else if (freq === "YEARLY") candidates = [[Y + step * interval, M, D]];
    else return [{ t: start.t, end: end.t }];
    for (const [y, mo, d] of candidates) {
      const norm = new Date(Date.UTC(y, mo, d));
      if (freq === "MONTHLY" && norm.getUTCDate() !== D) continue; // e.g. no Feb 30
      const t = at(norm.getUTCFullYear(), norm.getUTCMonth(), norm.getUTCDate());
      if (t < start.t) continue;
      if (t > stop) return out;
      n++;
      if (n > count) return out;
      if (!exd.has(t)) out.push({ t, end: t + dur, recurrenceT: t });
    }
  }
  return out;
}

function cleanDescription(v) {
  let t = unescapeText(v || "");
  t = t.replace(/<br\s*\/?>/gi, "\n").replace(/<\/p>/gi, "\n").replace(/<[^>]+>/g, "");
  t = t.replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'");
  t = t.replace(/[ \t]+/g, " ").replace(/\n{2,}/g, "\n").trim();
  return t.length > 240 ? t.slice(0, 240).replace(/\s+\S*$/, "") + "…" : t;
}
const firstUrl = (s) => (String(s || "").match(/https?:\/\/[^\s<>"']+/) || [])[0] || "";

function collectEvents(cal) {
  const calTz = cal.tz || "America/New_York";
  const until = NOW.getTime() + HORIZON_DAYS * 864e5;
  const overrides = new Map(); // UID|start → event (moved or edited single occurrences)
  for (const ev of cal.events) {
    if (ev["RECURRENCE-ID"]) {
      const rid = parseDate(ev["RECURRENCE-ID"], calTz);
      if (rid) overrides.set(`${ev.UID?.value}|${rid.t}`, ev);
    }
  }
  const list = [];
  const push = (ev, t, endT, allDay) => {
    if ((ev.STATUS?.value || "").toUpperCase() === "CANCELLED") return;
    const title = unescapeText(ev.SUMMARY?.value || "").trim();
    if (!title || /^busy$/i.test(title)) return; // "Private" events show as Busy: keep them off the site
    if (endT <= NOW.getTime()) return;
    const rawDesc = unescapeText(ev.DESCRIPTION?.value || "");
    list.push({
      title,
      t, end: endT, allDay,
      location: unescapeText(ev.LOCATION?.value || "").trim(),
      description: cleanDescription(ev.DESCRIPTION?.value),
      url: (ev.URL?.value || firstUrl(rawDesc)).trim(),
    });
  };
  const used = new Set();
  const pushOverride = (key, o, fallbackDur) => {
    used.add(key);
    const s2 = parseDate(o.DTSTART, calTz);
    if (!s2) return;
    const e2 = parseDate(o.DTEND, calTz) || { t: s2.t + fallbackDur };
    push(o, s2.t, e2.t, s2.allDay);
  };
  for (const ev of cal.events) {
    if (ev["RECURRENCE-ID"]) continue;
    const start = parseDate(ev.DTSTART, calTz);
    if (!start) continue;
    let end = parseDate(ev.DTEND, calTz);
    if (!end) end = { t: start.t + (start.allDay ? 864e5 : 3600e3) };
    for (const occ of expand(ev, start, end, calTz, until)) {
      const key = `${ev.UID?.value}|${occ.t}`;
      if (overrides.has(key)) pushOverride(key, overrides.get(key), occ.end - occ.t);
      else push(ev, occ.t, occ.end, start.allDay);
    }
  }
  // A moved occurrence whose series isn't in the feed still shows on its own.
  for (const [key, o] of overrides) if (!used.has(key)) pushOverride(key, o, 3600e3);
  return { calTz, events: list.sort((a, b) => a.t - b.t).slice(0, MAX) };
}

// ---------- writing the HTML ----------
function fmt(t, tz, opts) { return new Intl.DateTimeFormat("en-US", { timeZone: tz, ...opts }).format(new Date(t)); }
function when(ev, tz) {
  const day = (t) => fmt(t, tz, { weekday: "short", month: "short", day: "numeric" });
  const time = (t) => fmt(t, tz, { hour: "numeric", minute: "2-digit" }).replace(":00", "");
  if (ev.allDay) {
    const lastDay = ev.end - 864e5;
    return lastDay > ev.t + 1000 ? `${day(ev.t)} – ${day(lastDay)}` : `${day(ev.t)} · All day`;
  }
  const sameDay = fmt(ev.t, tz, { dateStyle: "short" }) === fmt(ev.end, tz, { dateStyle: "short" });
  return sameDay ? `${day(ev.t)} · ${time(ev.t)} – ${time(ev.end)}` : `${day(ev.t)}, ${time(ev.t)} – ${day(ev.end)}, ${time(ev.end)}`;
}
const gcalStamp = (t) => new Date(t).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
function gcalDay(t, tz) {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date(t)).map((x) => [x.type, x.value]));
  return `${p.year}${p.month}${p.day}`;
}
function addToGoogle(ev, tz) {
  const dates = ev.allDay ? `${gcalDay(ev.t, tz)}/${gcalDay(ev.end, tz)}` : `${gcalStamp(ev.t)}/${gcalStamp(ev.end)}`;
  const q = new URLSearchParams({ action: "TEMPLATE", text: `${ev.title} with Amazon the Dog`, dates, details: `${ev.description ? ev.description + "\n\n" : ""}More at https://amazonthedog.com/#events`, location: ev.location });
  return `https://calendar.google.com/calendar/render?${q}`;
}
function isoLocal(t, tz, allDay) {
  if (allDay) { const d = gcalDay(t, tz); return `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6)}`; }
  const off = tzOffsetMs(t, tz), local = new Date(t + off).toISOString().slice(0, 19);
  const m = Math.round(off / 60000), sign = m < 0 ? "-" : "+", a = Math.abs(m);
  return `${local}${sign}${String(Math.floor(a / 60)).padStart(2, "0")}:${String(a % 60).padStart(2, "0")}`;
}

function calendarIdFrom(url) {
  const m = String(url || "").match(/calendar\/ical\/([^/]+)\/public\//);
  return m ? decodeURIComponent(m[1]) : "";
}

function render({ calTz, events }, icsUrl) {
  const calId = calendarIdFrom(icsUrl);
  const subscribe = calId
    ? `      <div class="btns ev-sub">
        <a class="btn btn-alt" href="https://calendar.google.com/calendar/u/0?cid=${encodeURIComponent(Buffer.from(calId).toString("base64").replace(/=+$/, ""))}" target="_blank" rel="noopener">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><rect x="3" y="5" width="18" height="16" rx="3"/><path d="M3 10h18M8 3v4M16 3v4"/></svg>
          Follow her calendar (Google)</a>
        <a class="btn btn-alt" href="webcal://calendar.google.com/calendar/ical/${encodeURIComponent(calId)}/public/basic.ics">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><rect x="3" y="5" width="18" height="16" rx="3"/><path d="M3 10h18M8 3v4M16 3v4"/></svg>
          Apple or Outlook</a>
      </div>\n`
    : "";
  const cards = events.map((ev) => {
    const mon = fmt(ev.t, calTz, { month: "short" }).toUpperCase();
    const dnum = fmt(ev.t, calTz, { day: "numeric" });
    const links = [`<a href="${esc(addToGoogle(ev, calTz))}" target="_blank" rel="noopener">Add to my calendar</a>`];
    if (ev.location) links.push(`<a href="https://www.google.com/maps/search/?api=1&amp;query=${encodeURIComponent(ev.location)}" target="_blank" rel="noopener">Directions</a>`);
    if (ev.url) links.push(`<a href="${esc(ev.url)}" target="_blank" rel="noopener">Details</a>`);
    return `        <article class="ev">
          <p class="ev-date" aria-hidden="true"><span>${esc(mon)}</span><b>${esc(dnum)}</b></p>
          <div class="ev-body">
            <h3>${esc(ev.title)}</h3>
            <p class="ev-when"><time datetime="${isoLocal(ev.t, calTz, ev.allDay)}">${esc(when(ev, calTz))}</time></p>
${ev.location ? `            <p class="ev-where">${esc(ev.location)}</p>\n` : ""}${ev.description ? `            <p class="ev-desc">${esc(ev.description).replace(/\n/g, "<br>")}</p>\n` : ""}            <p class="ev-links">${links.join("")}</p>
          </div>
        </article>`;
  }).join("\n");
  const list = events.length
    ? `      <div class="ev-list">\n${cards}\n      </div>\n`
    : `      <div class="ev-empty">
        <p class="ev-empty-title">New dates are on the way.</p>
        <p>Follow her on Instagram to hear first, or invite her to yours.</p>
      </div>\n`;
  const ld = events.filter((e) => e.location).map((e) => ({
    "@type": "Event",
    name: `${e.title} with Amazon the Dog`,
    startDate: isoLocal(e.t, calTz, e.allDay),
    endDate: isoLocal(e.allDay ? e.end - 864e5 : e.end, calTz, e.allDay),
    eventAttendanceMode: "https://schema.org/OfflineEventAttendanceMode",
    eventStatus: "https://schema.org/EventScheduled",
    location: { "@type": "Place", name: e.location, address: e.location },
    ...(e.description ? { description: e.description } : {}),
    organizer: { "@id": "https://amazonthedog.com/#brand" },
    performer: { "@id": "https://amazonthedog.com/#brand" },
    url: "https://amazonthedog.com/#events",
  }));
  const ldTag = ld.length ? `      <script type="application/ld+json">${JSON.stringify({ "@context": "https://schema.org", "@graph": ld }).replace(/</g, "\\u003c")}</script>\n` : "";
  return `${START}
${subscribe}${list}      <aside class="ev-invite">
        <div>
          <h3>Invite Amazon</h3>
          <p>A smile visit for your library, school, senior living community or event? Send her the date, the place and what you have in mind.</p>
        </div>
        <a class="btn btn-ig" href="${INSTAGRAM_DM}" target="_blank" rel="noopener">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M21 12a8.5 8.5 0 0 1-12.4 7.6L3 21l1.5-5.3A8.5 8.5 0 1 1 21 12z"/></svg>
          Message her on Instagram</a>
      </aside>
${ldTag}      ${END}`;
}

async function main() {
  const page = await readFile(PAGE, "utf8");
  const a = page.indexOf(START), b = page.indexOf(END);
  if (a < 0 || b < 0 || b < a) throw new Error("EVENTS markers not found in index.html");
  const url = process.env.EVENTS_ICS_URL || "";
  let data = { calTz: "America/New_York", events: [] };
  if (process.env.EVENTS_ICS_FILE) data = collectEvents(parseIcs(await readFile(process.env.EVENTS_ICS_FILE, "utf8")));
  else if (url) {
    let text;
    try {
      const res = await fetch(url, { headers: { "user-agent": "amazonthedog.com events feed" } });
      if (!res.ok) throw new Error(`${res.status}`);
      text = await res.text();
      if (!/BEGIN:VCALENDAR/.test(text)) throw new Error("not a calendar file (is the calendar public?)");
    } catch (err) {
      console.log(`::warning::Couldn't read the calendar (${err.message}). Leaving the page as it is.`);
      return;
    }
    data = collectEvents(parseIcs(text));
  } else console.log("No calendar set yet (EVENTS_ICS_URL). Writing the empty state.");
  const next = page.slice(0, a) + render(data, url || process.env.EVENTS_ICS_URL_FOR_LINKS) + page.slice(b + END.length);
  if (next === page) { console.log("No change."); return; }
  await writeFile(PAGE, next);
  console.log(`Wrote ${data.events.length} upcoming event(s).`);
  for (const e of data.events) console.log(`  ${new Date(e.t).toISOString()}  ${e.title}`);
}

main().catch((err) => { console.error(err); process.exit(1); });
