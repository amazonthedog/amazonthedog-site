/*
 * amazonthedog.com — GA4 event tracking (v5, Nov 23 2026). Loaded on every page.
 *
 * Clicks:    follow_click, invite_click, book_click, calendar_click, event_link_click,
 *            reel_click, short_click, nav_click, gallery_click, music_click, link_click (every other link),
 *            image_click, rage_click. Middle-clicks count too.
 * Gallery:   /gallery/ sends photo_open, photo_view, photo_close, photo_love, photo_unlove,
 *            photo_share and gallery_filter through window.atdTrack (below).
 * Reading:   section_view, section_engaged (5 s on screen), scroll_depth (25/50/75/100 %),
 *            engaged_time (15/30/60/120/300 s on screen), page_exit (where they left,
 *            how far, how long, load speed).
 * Music:     music_play (first play of each song), music_finish (played to the end), from the
 *            SoundCloud players (iframe.sc-player) on the homepage and /music/.
 * Other:     text_copy, page_print, page_not_found, js_error; user property color_scheme.
 *
 * Needs the Google tag (gtag.js) in <head>. No personal data is sent: no names, emails,
 * typed text or copied text. Plan: amazonthedog-tracking/tracking-plan.md (skills project).
 */
(function () {
  if (typeof window.gtag !== 'function') return;

  var PLATFORMS = {
    'instagram.com': 'instagram',
    'facebook.com': 'facebook',
    'tiktok.com': 'tiktok',
    'youtube.com': 'youtube',
    'snapchat.com': 'snapchat',
    'linkedin.com': 'linkedin',
    'soundcloud.com': 'soundcloud'
  };

  // Test visits (?ga_debug=1): GA4 only honours debug_mode when it rides on each event
  function send(name, params) {
    params = params || {};
    if (window.gaDebug) params.debug_mode = true;
    window.gtag('event', name, params);
  }
  // Page scripts (the photo gallery) send their own events through this, and anything they
  // sent before this file loaded is waiting in atdQueue
  window.atdTrack = send;
  (window.atdQueue || []).forEach(function (q) { send(q[0], q[1]); });
  window.atdQueue = [];
  function clean(s, n) { return (s || '').replace(/\s+/g, ' ').trim().slice(0, n || 60); }
  function textOf(a) { return clean(a.textContent) || clean(a.getAttribute('aria-label')); }

  // Where on the page an element sits: header, footer, the section's id / name class, or main
  function placeOf(el) {
    if (!el || !el.closest) return 'other';
    if (el.closest('header')) return 'header';
    if (el.closest('footer')) return 'footer';
    var s = el.closest('section');
    if (s) return s.id || s.classList[1] || s.classList[0] || 'section';
    return el.closest('main') ? 'main' : 'other';
  }

  // The calendar event a link belongs to (title and date shown on the public site)
  function eventOf(a) {
    var card = a.closest('.ev');
    if (!card) return null;
    var h = card.querySelector('h3');
    var t = card.querySelector('time[datetime]');
    return {
      event_title: clean(h && h.textContent, 80),
      event_date: t ? t.getAttribute('datetime').slice(0, 10) : ''
    };
  }

  // Colour scheme the visitor's device asks for (the site follows it)
  try {
    window.gtag('set', 'user_properties', {
      color_scheme: window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
    });
  } catch (err) { /* old browsers */ }

  // A broken link brought someone to the 404 page
  if (/^Page not found/.test(document.title)) send('page_not_found', {});

  /* ---------- Clicks ---------- */

  function onLink(a) {
    var url;
    try { url = new URL(a.href, window.location.href); } catch (err) { return; }
    var host = url.hostname.replace(/^www\./, '');
    var where = placeOf(a);

    // Jump links inside the same page (menu, "See where she'll be", the smile-counter card)
    if (url.origin === window.location.origin && url.pathname === window.location.pathname && url.hash.length > 1) {
      send('nav_click', { nav_target: url.hash.slice(1), button_location: where, button_text: textOf(a) });
      return;
    }

    // Links on a "Where she'll be" event card: add to calendar, directions, details
    var ev = eventOf(a);
    if (ev) {
      if (host === 'calendar.google.com') {
        send('calendar_click', { calendar_action: 'add_event', event_title: ev.event_title, event_date: ev.event_date, button_location: where });
      } else {
        var type = /(^|\.)google\.[a-z.]+$/.test(host) && url.pathname.indexOf('/maps') === 0 ? 'directions' : 'details';
        send('event_link_click', { link_type: type, event_title: ev.event_title, event_date: ev.event_date });
      }
      return;
    }

    // Follow her whole calendar (Google, or Apple/Outlook via webcal)
    if (url.protocol === 'webcal:' || host === 'calendar.google.com') {
      send('calendar_click', { calendar_action: url.protocol === 'webcal:' ? 'subscribe_ical' : 'subscribe_google', button_location: where });
      return;
    }

    // The Christmas book (Gumroad: free download or name your price)
    if (/(^|\.)gumroad\.com$/.test(host) || a.hasAttribute('data-book')) {
      send('book_click', { book_option: a.getAttribute('data-book') || 'link', button_location: where, button_text: textOf(a) });
      return;
    }

    // The photo gallery (menu, hero, "See all her photos", footer)
    if (url.origin === window.location.origin && /^\/gallery(\/|\.html)?$/.test(url.pathname)) {
      send('gallery_click', { button_location: where, button_text: textOf(a) });
      return;
    }

    // Her music page (menu, hero, "Hear all her songs", footer)
    if (url.origin === window.location.origin && /^\/music(\/|\.html)?$/.test(url.pathname)) {
      send('music_click', { button_location: where, button_text: textOf(a) });
      return;
    }

    // "Invite Amazon": a direct message on Instagram
    if (host === 'ig.me') {
      send('invite_click', { button_location: where, button_text: textOf(a) });
      return;
    }

    var platform = PLATFORMS[host];
    if (platform) {
      var reel = url.pathname.match(/^\/(?:reel|p)\/([^\/]+)/);
      if (reel) {
        var tiles = Array.prototype.slice.call(document.querySelectorAll('a.ig-tile'));
        send('reel_click', { reel_id: reel[1], position: tiles.indexOf(a) + 1 });
        return;
      }
      var short = platform === 'youtube' && url.pathname.match(/^\/shorts\/([^\/?]+)/);
      if (short) {
        var shorts = Array.prototype.slice.call(document.querySelectorAll('a.yt-tile'));
        send('short_click', { short_id: short[1], position: shorts.indexOf(a) + 1 });
        return;
      }
      send('follow_click', { platform: platform, button_location: where, button_text: textOf(a) });
      return;
    }

    // Everything else: other pages on this site (Privacy, Back home) and any other website
    var internal = url.origin === window.location.origin;
    send('link_click', {
      link_url: internal ? url.pathname + url.hash : (url.origin + url.pathname).slice(0, 100),
      link_domain: internal ? 'amazonthedog.com' : host,
      link_text: textOf(a),
      outbound: !internal,
      button_location: where
    });
  }

  // Photos that aren't links (book pages, gallery): people tapping them expect something
  function imageOf(el) {
    var img = el.closest && el.closest('img, picture');
    if (!img) return null;
    if (img.tagName === 'PICTURE') img = img.querySelector('img') || img;
    return img;
  }

  // Three or more taps within a second in the same spot: something isn't doing what they expect
  var recent = [];
  var raged = {};
  function rageCheck(e) {
    var now = Date.now();
    recent = recent.filter(function (c) { return now - c.t < 1000 && Math.abs(c.x - e.clientX) < 40 && Math.abs(c.y - e.clientY) < 40; });
    recent.push({ t: now, x: e.clientX, y: e.clientY });
    if (recent.length < 3) return;
    recent = [];
    var el = e.target;
    var img = imageOf(el);
    var label = img ? 'img: ' + clean(img.getAttribute('alt'), 50)
      : el.tagName.toLowerCase() + (el.classList && el.classList[0] ? '.' + el.classList[0] : '');
    var key = placeOf(el) + '|' + label;
    if (raged[key]) return;
    raged[key] = true;
    send('rage_click', { button_location: placeOf(el), click_element: label });
  }

  function onClick(e) {
    if (e.type === 'auxclick' && e.button !== 1) return; // only the middle button
    var a = e.target.closest ? e.target.closest('a[href]') : null;
    if (a) { onLink(a); } else {
      var img = imageOf(e.target);
      // Gallery photos are buttons that open the viewer, which sends its own photo_open / photo_view
      if (img && e.type === 'click' && !img.closest('button, dialog')) {
        send('image_click', { image_alt: clean(img.getAttribute('alt'), 80), button_location: placeOf(img) });
      }
    }
    // Quick taps on the viewer's arrows, or on a heart, are play, not frustration
    if (e.type === 'click' && !(e.target.closest && e.target.closest('dialog, [aria-pressed]'))) rageCheck(e);
  }
  document.addEventListener('click', onClick, true);
  document.addEventListener('auxclick', onClick, true);

  /* ---------- Copy and print ---------- */

  document.addEventListener('copy', function () {
    var sel = window.getSelection ? window.getSelection() : null;
    var n = sel ? String(sel).length : 0;
    if (!n) return;
    var node = sel.anchorNode && (sel.anchorNode.nodeType === 1 ? sel.anchorNode : sel.anchorNode.parentElement);
    send('text_copy', { button_location: placeOf(node), copy_length: n }); // the copied text itself is never sent
  });
  window.addEventListener('beforeprint', function () { send('page_print', {}); });

  /* ---------- Errors in this site's own scripts ---------- */

  var errors = 0;
  window.addEventListener('error', function (e) {
    if (!e || !e.message || errors >= 5) return;
    var file = e.filename || '';
    if (file && file.indexOf(window.location.origin) !== 0) return; // ignore extensions and other sites
    errors++;
    send('js_error', { error_message: clean(e.message, 100), error_source: clean(file.replace(window.location.origin, '') || 'inline', 60) });
  });

  /* ---------- Reading: sections, scroll depth, time on screen ---------- */

  var sections = Array.prototype.slice.call(document.querySelectorAll('section'));
  var seen = {};
  var lastSection = '';
  var secTime = {};
  var engagedSent = {};
  var visibleSeconds = 0;
  var maxScroll = 0;
  var depthSent = {};
  var timeMarks = [15, 30, 60, 120, 300];

  // section_view: once per section, when it reaches the top half of the screen
  function markSeen(name) {
    lastSection = name;
    if (seen[name]) return;
    seen[name] = true;
    send('section_view', { section: name });
  }
  if ('IntersectionObserver' in window) {
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) { if (entry.isIntersecting) markSeen(placeOf(entry.target)); });
    }, { rootMargin: '0px 0px -50% 0px', threshold: 0 });
    sections.forEach(function (s) { io.observe(s); });
  }
  // Fast flicks can carry a short section past between frames; catch it on the scroll event
  function sweepSections() {
    var mid = window.innerHeight * 0.5;
    sections.forEach(function (s) {
      var r = s.getBoundingClientRect();
      if (r.top < mid && r.bottom > 0) markSeen(placeOf(s));
    });
  }

  function scrollPercent() {
    var doc = document.documentElement;
    var h = Math.max(doc.scrollHeight, document.body ? document.body.scrollHeight : 0);
    if (!h) return 0;
    return Math.min(100, Math.round((window.scrollY + window.innerHeight) / h * 100));
  }
  function checkScroll() {
    var p = scrollPercent();
    if (p > maxScroll) maxScroll = p;
    // Short pages (Privacy, 404) fit on one screen, so depth marks would all fire at once
    if (document.documentElement.scrollHeight < window.innerHeight * 1.5) return;
    [25, 50, 75, 100].forEach(function (mark) {
      if (maxScroll >= mark && !depthSent[mark]) {
        depthSent[mark] = true;
        send('scroll_depth', { percent_scrolled: mark });
      }
    });
  }
  window.addEventListener('scroll', function () { checkScroll(); sweepSections(); }, { passive: true });
  checkScroll();

  // Every second the page is on screen: count reading time and which section is being read
  setInterval(function () {
    if (document.visibilityState && document.visibilityState !== 'visible') return;
    visibleSeconds++;
    timeMarks.forEach(function (s) {
      if (visibleSeconds === s) send('engaged_time', { engaged_seconds: s });
    });
    var vh = window.innerHeight;
    sections.forEach(function (s) {
      var r = s.getBoundingClientRect();
      var shown = Math.min(r.bottom, vh) - Math.max(r.top, 0);
      if (shown <= 0 || shown < Math.min(r.height, vh) * 0.5) return;
      var name = placeOf(s);
      secTime[name] = (secTime[name] || 0) + 1;
      if (secTime[name] === 5 && !engagedSent[name]) {
        engagedSent[name] = true;
        send('section_engaged', { section: name });
      }
    });
    checkScroll();
    sweepSections();
  }, 1000);

  /* ---------- Load speed (for page_exit) ---------- */

  var lcp = 0, cls = 0;
  try {
    new PerformanceObserver(function (list) {
      var entries = list.getEntries();
      if (entries.length) lcp = Math.round(entries[entries.length - 1].startTime);
    }).observe({ type: 'largest-contentful-paint', buffered: true });
    new PerformanceObserver(function (list) {
      list.getEntries().forEach(function (en) { if (!en.hadRecentInput) cls += en.value; });
    }).observe({ type: 'layout-shift', buffered: true });
  } catch (err) { /* not supported */ }

  // page_exit: the first time the page is hidden or closed — where they were, how far, how long
  var exited = false;
  function onExit() {
    if (exited) return;
    exited = true;
    var top = '', topTime = 0;
    Object.keys(secTime).forEach(function (k) { if (secTime[k] > topTime) { top = k; topTime = secTime[k]; } });
    var p = { last_section: lastSection || 'none', top_section: top || 'none', max_scroll: maxScroll, visible_seconds: visibleSeconds };
    if (lcp) p.lcp_ms = lcp;
    p.cls = Math.round(cls * 1000) / 1000;
    send('page_exit', p);
  }
  document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'hidden') onExit(); });
  window.addEventListener('pagehide', onExit);

  // Music: SoundCloud players. The widget API reports plays from inside the player's frame.
  var players = document.querySelectorAll('iframe.sc-player');
  if (players.length) {
    var api = document.createElement('script');
    api.src = 'https://w.soundcloud.com/player/api.js';
    api.async = true;
    api.onload = function () {
      if (!window.SC || !SC.Widget) return;
      players.forEach(function (frame) {
        var w = SC.Widget(frame), played = {}, where = placeOf(frame);
        function withSong(cb) { w.getCurrentSound(function (snd) { if (snd) cb(clean(snd.title, 80)); }); }
        w.bind(SC.Widget.Events.PLAY, function () {
          withSong(function (title) {
            if (played[title]) return;
            played[title] = true;
            send('music_play', { song_title: title, player_location: where });
          });
        });
        w.bind(SC.Widget.Events.FINISH, function () {
          withSong(function (title) { send('music_finish', { song_title: title, player_location: where }); });
        });
      });
    };
    document.head.appendChild(api);
  }
})();
