/*
 * amazonthedog.com — GA4 event tracking
 * Sends follow_click, reel_click and section_view to GA4. Needs the Google tag (gtag.js) in <head>.
 * No personal data is sent.
 */
(function () {
  if (typeof window.gtag !== 'function') return;

  var PLATFORMS = {
    'instagram.com': 'instagram',
    'facebook.com': 'facebook',
    'tiktok.com': 'tiktok',
    'youtube.com': 'youtube',
    'snapchat.com': 'snapchat'
  };

  // Where on the page an element sits: header, footer, or the section's id / name class
  function placeOf(el) {
    if (el.closest('header')) return 'header';
    if (el.closest('footer')) return 'footer';
    var s = el.closest('section');
    if (!s) return 'other';
    return s.id || s.classList[1] || s.classList[0] || 'section';
  }

  // Follow buttons and Instagram reel tiles
  document.addEventListener('click', function (e) {
    var a = e.target.closest ? e.target.closest('a[href]') : null;
    if (!a) return;
    var url;
    try { url = new URL(a.href, window.location.href); } catch (err) { return; }
    var platform = PLATFORMS[url.hostname.replace(/^www\./, '')];
    if (!platform) return;

    var reel = url.pathname.match(/^\/(?:reel|p)\/([^\/]+)/);
    if (reel) {
      var tiles = Array.prototype.slice.call(document.querySelectorAll('a.ig-tile'));
      window.gtag('event', 'reel_click', {
        reel_id: reel[1],
        position: tiles.indexOf(a) + 1
      });
      return;
    }

    window.gtag('event', 'follow_click', {
      platform: platform,
      button_location: placeOf(a),
      button_text: (a.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 60)
    });
  });

  // How far down the story people get: one section_view per section per page load
  if ('IntersectionObserver' in window) {
    var seen = {};
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (!entry.isIntersecting) return;
        var name = placeOf(entry.target);
        io.unobserve(entry.target);
        if (seen[name]) return;
        seen[name] = true;
        window.gtag('event', 'section_view', { section: name });
      });
    }, { rootMargin: '0px 0px -50% 0px', threshold: 0 });
    document.querySelectorAll('section').forEach(function (s) { io.observe(s); });
  }
})();
