// Loaded first, on every page. Prevents exactly the class of bug where old
// sessionStorage data (written before a fix shipped) silently survives and
// causes mismatches that look like new bugs.
//
// APP_VERSION should be bumped any time a fix changes what shape the stored
// data is expected to have (new keys, changed cache format, etc). When the
// version in sessionStorage doesn't match, everything under the benjamin_
// prefix is wiped automatically and the visitor just starts fresh, the same
// way manually closing the tab used to fix these issues, but automatic and
// guaranteed rather than depending on remembering to do it.
(function () {
  var APP_VERSION = '2026-09-04.1';
  var VERSION_KEY = 'benjamin_schema_version';

  try {
    var current = sessionStorage.getItem(VERSION_KEY);
    if (current !== APP_VERSION) {
      var toRemove = [];
      for (var i = 0; i < sessionStorage.length; i++) {
        var k = sessionStorage.key(i);
        if (k && k.indexOf('benjamin_') === 0) toRemove.push(k);
      }
      toRemove.forEach(function (k) { sessionStorage.removeItem(k); });
      sessionStorage.setItem(VERSION_KEY, APP_VERSION);
    }
  } catch (e) {
    // If sessionStorage is unavailable for any reason, do nothing;
    // pages already guard against missing data individually.
  }
})();
