// Shared between checkout.html and report.html.
// Generates paid reports via /api/benjamin-report and caches results in
// sessionStorage so checkout can pre-generate quietly while the visitor
// is filling in the (fake) card form, and report.html can pick up
// whatever finished in time instead of starting from zero.

var BenjaminReports = (function () {
  var SECTION_NAMES = ['PATTERN', 'ORIGIN', 'TENSION', 'COST', 'OPENING', 'PHASE', 'WATCH'];
  var CACHE_KEY = 'benjamin_report_cache';

  function toBlob(dataUrl) {
    var p = dataUrl.split(','), mime = p[0].match(/:(.*?);/)[1];
    var bin = atob(p[1]), arr = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
    return new Blob([arr], { type: mime });
  }

  function parseReport(text) {
    var r = {};
    for (var i = 0; i < SECTION_NAMES.length; i++) {
      var key = SECTION_NAMES[i];
      var tag = '###' + key + '###';
      var s = text.indexOf(tag);
      if (s === -1) continue;
      var from = s + tag.length, to = text.length;
      for (var j = i + 1; j < SECTION_NAMES.length; j++) {
        var nx = text.indexOf('###' + SECTION_NAMES[j] + '###', from);
        if (nx !== -1) { to = nx; break; }
      }
      r[key] = text.slice(from, to).trim();
    }
    return r;
  }

  function getCache() {
    try {
      var raw = sessionStorage.getItem(CACHE_KEY);
      return raw ? JSON.parse(raw) : {};
    } catch (e) { return {}; }
  }

  function setCacheEntry(category, sections) {
    try {
      var cache = getCache();
      cache[category] = sections;
      sessionStorage.setItem(CACHE_KEY, JSON.stringify(cache));
    } catch (e) {}
  }

  function getCached(category) {
    return getCache()[category] || null;
  }

  // Returns true if we have everything needed to generate this category
  // right now (i.e. traits needs a second photo, which may not exist yet).
  function canGenerate(category) {
    var photo = sessionStorage.getItem('benjamin_photo_preview');
    if (!photo) return false;
    if (category === 'traits') {
      return !!sessionStorage.getItem('benjamin_photo2_preview');
    }
    return true;
  }

  async function fetchReportSection(category) {
    var photo = sessionStorage.getItem('benjamin_photo_preview');
    var photo2 = sessionStorage.getItem('benjamin_photo2_preview');
    var reading = sessionStorage.getItem('benjamin_reading') || '';
    var name = sessionStorage.getItem('benjamin_name') || '';
    var chosenCategory = sessionStorage.getItem('benjamin_category') || '';
    var mcAnswer = sessionStorage.getItem('benjamin_mc_answer') || '';
    var checkinsRaw = sessionStorage.getItem('benjamin_checkins');
    var checkins = {};
    try { checkins = checkinsRaw ? JSON.parse(checkinsRaw) : {}; } catch (e) {}

    var fd = new FormData();
    fd.append('photo', toBlob(photo), 'palm.jpg');
    if (category === 'traits' && photo2) {
      fd.append('photo2', toBlob(photo2), 'palm2.jpg');
    }
    fd.append('category', category);
    fd.append('reading', reading);
    fd.append('checkins', JSON.stringify(checkins));
    fd.append('mcAnswer', category === chosenCategory ? mcAnswer : '');
    fd.append('name', name);

    var res = await fetch('/api/benjamin-report', { method: 'POST', body: fd });
    var d = await res.json();
    if (d.rateLimited) throw d.message;
    if (d.error || !d.report) throw (d.message || 'Something went wrong writing this report.');
    var sections = parseReport(d.report);
    setCacheEntry(category, sections);
    return sections;
  }

  // Fire-and-forget background pre-generation, safe to call from checkout.html.
  // Silently does nothing for categories it can't generate yet (e.g. traits
  // without a second photo) or that are already cached.
  function pregenerate(categories) {
    categories.forEach(function (cat) {
      if (getCached(cat)) return;
      if (!canGenerate(cat)) return;
      fetchReportSection(cat).catch(function () {
        // Silent failure here is fine: report.html will simply try again
        // for real, with visible error handling, when the visitor gets there.
      });
    });
  }

  return {
    SECTION_NAMES: SECTION_NAMES,
    toBlob: toBlob,
    parseReport: parseReport,
    getCached: getCached,
    setCacheEntry: setCacheEntry,
    canGenerate: canGenerate,
    fetchReportSection: fetchReportSection,
    pregenerate: pregenerate
  };
})();
