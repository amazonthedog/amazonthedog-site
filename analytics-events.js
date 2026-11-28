/*
 * amazonthedog.com — GA4 event tracking (v6, Nov 28 2026). Loaded on every page.
 *
 * Every button: each click event carries cta_id, a readable name that is unique on the page:
 *            page_section_action, e.g. home_hero_instagram, music_more_youtube, gallery_viewer_love.
 *            The same button twice in one section gets _2, _3 in page order. data-cta="..." on a
 *            link overrides the name. The page shows each link's name in data-cta-id (DevTools).
 * Clicks:    follow_click (her own profiles only), invite_click, book_click, calendar_click,
 *            event_link_click, reel_click, short_click, nav_click, gallery_click, music_click,
 *            link_click (every other link), image_click, rage_click. Middle-clicks count too.
 * Gallery:   /gallery/ sends photo_open, photo_view, photo_close, photo_love, photo_unlove,
 *            photo_share and gallery_filter through window.atdTrack (below adds their cta_id).
 * Music:     the SoundCloud players (iframe.sc-player) on the homepage and /music/ send
 *            music_play (first play of each song), music_progress (25/50/75 %), music_finish,
 *            music_listen (seconds of each listening stretch) and music_share.
 * Reading:   section_view, section_engaged (5 s on screen), scroll_depth (25/50/75/100 %),
 *            engaged_time (15/30/60/120/300 s on screen), page_exit (where they left,
 *            how far, how long, load speed).
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
  function clean(s, n) { return (s || '').replace(/\s+/g, ' ').trim().slice(0, n || 60); }
  function textOf(a) { return clean(a.textContent) || clean(a.getAttribute('aria-label')); }
  function slug(s) { return String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40); }

  // Short page name for button names: home, gallery, music, privacy, 404 (a new page: its path)
  var PAGE = /^Page not found/.test(document.title) ? '404'
    : slug(window.location.pathname.replace(/index\.html$/, '').replace(/\.html$/, '')) || 'home';

  // Page scripts (the photo gallery) send their own events through this, and anything they
  // sent before this file loaded is waiting in atdQueue. Their buttons get a cta_id here.
  function pageEvent(name, params) {
    params = params || {};
    if (!params.cta_id) {
      var id = '';
      if (name === 'gallery_filter') id = 'filter_' + slug(params.gallery_filter);
      else if (name === 'photo_open') id = params.view_method === 'tap' ? 'grid_photo' : ''; // a shared photo link isn't a button
      else if (name === 'photo_view') id = 'viewer_' + slug(params.view_method);
      else if (name === 'photo_close') id = 'viewer_close';
      else if (name === 'photo_love' || name === 'photo_unlove') id = slug(params.button_location || 'grid') + (name === 'photo_love' ? '_love' : '_unlove');
      else if (name === 'photo_share') id = 'viewer_share_' + slug(params.share_method);
      if (id) params.cta_id = PAGE + '_' + id;
    }
    send(name, params);
  }
  window.atdTrack = pageEvent;
  (window.atdQueue || []).forEach(function (q) { pageEvent(q[0], q[1]); });
  window.atdQueue = [];

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

  // What a link does: [event name, its parameters, a short action word for the button name]
  function classify(a) {
    var url;
    try { url = new URL(a.href, window.location.href); } catch (err) { return null; }
    var host = url.hostname.replace(/^www\./, '');
    var where = placeOf(a);
    var internal = url.origin === window.location.origin;

    // Jump links inside the same page (menu, "See where she'll be", the smile-counter card)
    if (internal && url.pathname === window.location.pathname && url.hash.length > 1) {
      return ['nav_click', { nav_target: url.hash.slice(1), button_location: where, button_text: textOf(a) }, 'jump_' + slug(url.hash.slice(1))];
    }

    // Links on a "Where she'll be" event card: add to calendar, directions, details
    var ev = eventOf(a);
    if (ev) {
      if (host === 'calendar.google.com') {
        return ['calendar_click', { calendar_action: 'add_event', event_title: ev.event_title, event_date: ev.event_date, button_location: where }, 'event_add_to_calendar'];
      }
      var type = /(^|\.)google\.[a-z.]+$/.test(host) && url.pathname.indexOf('/maps') === 0 ? 'directions' : 'details';
      return ['event_link_click', { link_type: type, event_title: ev.event_title, event_date: ev.event_date }, 'event_' + type];
    }

    // Follow her whole calendar (Google, or Apple/Outlook via webcal)
    if (url.protocol === 'webcal:' || host === 'calendar.google.com') {
      var how = url.protocol === 'webcal:' ? 'subscribe_ical' : 'subscribe_google';
      return ['calendar_click', { calendar_action: how, button_location: where }, 'calendar_' + how];
    }

    // The Christmas book (Gumroad: free download or name your price)
    if (/(^|\.)gumroad\.com$/.test(host) || a.hasAttribute('data-book')) {
      var opt = a.getAttribute('data-book') || 'link';
      return ['book_click', { book_option: opt, button_location: where, button_text: textOf(a) }, 'book_' + slug(opt)];
    }

    // The photo gallery (menu, hero, "See all her photos", footer)
    if (internal && /^\/gallery(\/|\.html)?$/.test(url.pathname)) {
      return ['gallery_click', { button_location: where, button_text: textOf(a) }, 'photos_page'];
    }

    // Her music page (menu, hero, "Hear all her songs", footer)
    if (internal && /^\/music(\/|\.html)?$/.test(url.pathname)) {
      return ['music_click', { button_location: where, button_text: textOf(a) }, 'music_page'];
    }

    // "Invite Amazon": a direct message on Instagram
    if (host === 'ig.me') {
      return ['invite_click', { button_location: where, button_text: textOf(a) }, 'invite'];
    }

    var platform = PLATFORMS[host];
    if (platform) {
      var reel = url.pathname.match(/^\/(?:reel|p)\/([^\/]+)/);
      if (reel) {
        var tiles = Array.prototype.slice.call(document.querySelectorAll('a.ig-tile'));
        var rp = tiles.indexOf(a) + 1;
        return ['reel_click', { reel_id: reel[1], position: rp }, 'reel_' + rp];
      }
      var short = platform === 'youtube' && url.pathname.match(/^\/shorts\/([^\/?]+)/);
      if (short) {
        var shorts = Array.prototype.slice.call(document.querySelectorAll('a.yt-tile'));
        var sp = shorts.indexOf(a) + 1;
        return ['short_click', { short_id: short[1], position: sp }, 'short_' + sp];
      }
      // Her own profiles have "amazonthedog" in the address. Other pages on those sites
      // (SoundCloud's privacy policy, say) are plain links below, not follows.
      if (/amazonthedog/i.test(url.pathname)) {
        return ['follow_click', { platform: platform, button_location: where, button_text: textOf(a) }, platform];
      }
    }

    // Everything else: other pages on this site (Privacy, Back home) and any other website
    var action = internal
      ? (slug(url.pathname.replace(/index\.html$/, '').replace(/\.html$/, '')) || 'home') + (url.hash.length > 1 ? '_' + slug(url.hash.slice(1)) : '')
      : 'out_' + slug(host.replace(/\.(com|org|net|io|me|co)$/, ''));
    return ['link_click', {
      link_url: internal ? url.pathname + url.hash : (url.origin + url.pathname).slice(0, 100),
      link_domain: internal ? 'amazonthedog.com' : host,
      link_text: textOf(a),
      outbound: !internal,
      button_location: where
    }, action];
  }

  // Button names (cta_id): page_section_action, unique on the page. Worked out once when the
  // page loads (in page order) and kept on each link as data-cta-id.
  function ctaBase(a, action) {
    var own = a.getAttribute('data-cta');
    if (own) return slug(own);
    var sec = slug(placeOf(a));
    // Say it once: her profile link inside the Instagram feed is home_instagram_profile, and
    // "Hear all her songs" in the music section is home_music_page (not music_music_page)
    if (action === sec) action = 'profile';
    else if (action.indexOf(sec + '_') === 0) action = action.slice(sec.length + 1);
    return PAGE + '_' + sec + '_' + action;
  }
  function nameButtons() {
    var count = {};
    Array.prototype.forEach.call(document.querySelectorAll('a[href]'), function (el) {
      var c = classify(el);
      if (!c) return;
      var base = ctaBase(el, c[2]);
      count[base] = (count[base] || 0) + 1;
      el.setAttribute('data-cta-id', count[base] > 1 ? base + '_' + count[base] : base);
    });
  }
  try { nameButtons(); } catch (err) { /* names fall back to the base name at click time */ }

  function onLink(a) {
    var c = classify(a);
    if (!c) return;
    c[1].cta_id = a.getAttribute('data-cta-id') || ctaBase(a, c[2]);
    send(c[0], c[1]);
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

  /* ---------- Music: the SoundCloud players ---------- */

  // The widget API reports from inside the player's frame. Per player and song:
  // music_play (first play), music_progress (25/50/75 %), music_finish, music_share, and
  // music_listen with the seconds of each listening stretch (sent on pause, at the end of a
  // song, and when the visitor leaves or switches away, so background listening counts too).
  var players = Array.prototype.slice.call(document.querySelectorAll('iframe.sc-player'));
  var listeners = [];
  function flushListen(p) {
    if (!p.since) return;
    var secs = Math.round((Date.now() - p.since) / 1000);
    p.since = 0;
    if (secs >= 1) send('music_listen', { song_title: p.title || 'unknown', player_location: p.where, listen_seconds: secs });
  }
  function flushAll(restart) {
    listeners.forEach(function (p) {
      var on = !!p.since;
      flushListen(p);
      if (on && restart) p.since = Date.now();
    });
  }
  document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'hidden') flushAll(true); });
  window.addEventListener('pagehide', function () { flushAll(false); });

  if (players.length) {
    var api = document.createElement('script');
    api.src = 'https://w.soundcloud.com/player/api.js';
    api.async = true;
    api.onload = function () {
      if (!window.SC || !SC.Widget) return;
      players.forEach(function (frame) {
        var w = SC.Widget(frame);
        var p = { where: placeOf(frame), title: '', since: 0, played: {}, marks: {} };
        var cta = PAGE + '_' + slug(p.where) + '_player';
        listeners.push(p);
        function withSong(cb) { w.getCurrentSound(function (snd) { if (snd) cb(clean(snd.title, 80)); }); }
        w.bind(SC.Widget.Events.PLAY, function () {
          if (!p.since) p.since = Date.now(); // the player can report PLAY twice as a song starts
          withSong(function (title) {
            if (p.since && p.title && title !== p.title) { flushListen(p); p.since = Date.now(); } // picked another song mid-play
            p.title = title;
            if (p.played[title]) return;
            p.played[title] = true;
            w.getCurrentSoundIndex(function (n) {
              send('music_play', { song_title: title, player_location: p.where, position: (typeof n === 'number' ? n + 1 : 0), cta_id: cta + '_play' });
            });
          });
        });
        w.bind(SC.Widget.Events.PLAY_PROGRESS, function (e) {
          if (!p.title || !e || typeof e.relativePosition !== 'number') return;
          var done = p.marks[p.title] = p.marks[p.title] || {};
          [25, 50, 75].forEach(function (m) {
            if (e.relativePosition * 100 >= m && !done[m]) {
              done[m] = true;
              send('music_progress', { song_title: p.title, player_location: p.where, song_percent: m });
            }
          });
        });
        w.bind(SC.Widget.Events.PAUSE, function () { flushListen(p); });
        w.bind(SC.Widget.Events.FINISH, function () {
          // By now the player has moved on to the next song, so use the one that was playing
          var title = p.title;
          flushListen(p);
          if (title) send('music_finish', { song_title: title, player_location: p.where });
        });
        w.bind(SC.Widget.Events.OPEN_SHARE_PANEL, function () {
          send('music_share', { song_title: p.title || 'unknown', player_location: p.where, cta_id: cta + '_share' });
        });
      });
    };
    document.head.appendChild(api);
  }
})();
