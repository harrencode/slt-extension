(function() {
  function parseNumber(str) {
    if (!str) return 0.0;
    const m = ('' + str).match(/([\d.,]+)/);
    if (!m) return 0.0;
    return parseFloat(m[1].replace(/,/g, '')) || 0.0;
  }

  function scrapeUsage() {
    const bodyText = document.body.innerText || '';

    function escapeRegExp(str) {
      return (str || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }

    function remainingFromUsed(used, cap) {
      return cap > 0 ? Math.max(0, cap - used) : 0;
    }

    function parseLabeledUsedFrom(label) {
      const rx = new RegExp(escapeRegExp(label) + '[\\s\\S]{0,140}?([\\d.,]+)\\s*used\\s*from\\s*([\\d.,]+)\\s*GB', 'i');
      const m = bodyText.match(rx);
      if (!m) return null;
      const used = parseNumber(m[1]);
      const cap = parseNumber(m[2]);
      return { used, cap, remaining: remainingFromUsed(used, cap) };
    }

    function parseLabeledUsedOf(labelRegex) {
      const rx = new RegExp(labelRegex + '[\\s\\S]{0,180}?([\\d.,]+)\\s*GB\\s*USED\\s*OF\\s*([\\d.,]+)\\s*GB', 'i');
      const m = bodyText.match(rx);
      if (!m) return null;
      const used = parseNumber(m[1]);
      const cap = parseNumber(m[2]);
      return { used, cap, remaining: remainingFromUsed(used, cap) };
    }

    // Detect login screen heuristics
    const isLogin = /login|sign in|username|password/i.test(bodyText) && !/Remaining|GB|My Package/i.test(bodyText);

    function parseTileByLabel(label) {
      const tabs = document.querySelectorAll('.buttonTab');
      for (const tab of tabs) {
        const labelEl = tab.querySelector('p.m-0');
        const valueEl = tab.querySelector('.pkg-option');
        if (!labelEl || !valueEl) continue;
        const ltxt = (labelEl.textContent || '').trim().toLowerCase();
        if (ltxt !== label.trim().toLowerCase()) continue;
        const vtxt = (valueEl.textContent || '').trim();
        const m = vtxt.match(/([\d.,]+)\s*used\s*from\s*([\d.,]+)\s*GB/i);
        if (!m) return null;
        const used = parseNumber(m[1]);
        const cap = parseNumber(m[2]);
        return { used, cap, remaining: remainingFromUsed(used, cap) };
      }
      return null;
    }

    // progress count (percentage) element
    function parseProgressPercentage() {
      const pct = document.querySelector('.progress-count');
      if (pct && pct.textContent) {
        const ptxt = pct.textContent.match(/([\d]{1,3})%/);
        if (ptxt) return parseInt(ptxt[1], 10);
      }
      return null;
    }

    // declare variables up-front to avoid temporal-dead-zone errors
    let total = 0.0, peak = 0.0, offPeak = 0.0, limit = 0.0, percentage = 0;
    let extra = 0.0, bonus = 0.0, addOns = 0.0;

    const myPkg = parseTileByLabel('My Package');
    if (myPkg) {
      total = myPkg.remaining;
      limit = myPkg.cap;
    }

    const extraTile = parseTileByLabel('Extra GB');
    if (extraTile) extra = extraTile.remaining;

    const bonusTile = parseTileByLabel('Bonus Data');
    if (bonusTile) bonus = bonusTile.remaining;

    const addOnsTile = parseTileByLabel('Add-Ons Data');
    if (addOnsTile) addOns = addOnsTile.remaining;

    const progressPct = parseProgressPercentage();
    if (typeof progressPct === 'number') {
      percentage = progressPct;
    }

    const totalUsedOf = parseLabeledUsedOf('Total\\s*\\(\\s*Standard\\s*\\+\\s*Free\\s*\\)');
    if (totalUsedOf) {
      total = totalUsedOf.remaining;
      limit = totalUsedOf.cap;
    }

    const peakUsedOf = parseLabeledUsedOf('(?:^|\\n)\\s*Peak\\b');
    if (peakUsedOf) peak = peakUsedOf.remaining;

    const offPeakUsedOf = parseLabeledUsedOf('(?:^|\\n)\\s*Off[\\s-]*Peak\\b');
    if (offPeakUsedOf) offPeak = offPeakUsedOf.remaining;

    const extraUsedFrom = parseLabeledUsedFrom('Extra GB');
    if (extraUsedFrom) extra = extraUsedFrom.remaining;

    const bonusUsedFrom = parseLabeledUsedFrom('Bonus Data');
    if (bonusUsedFrom) bonus = bonusUsedFrom.remaining;

    const addOnsUsedFrom = parseLabeledUsedFrom('Add-Ons Data');
    if (addOnsUsedFrom) addOns = addOnsUsedFrom.remaining;

    // try to find limit from nearby "used from" pattern
    const usedFromMatch = bodyText.match(/My\s*Package[\s\S]{0,80}?used\s*from\s*([\d.,]+)\s*GB/i);
    if (usedFromMatch && !limit) limit = parseNumber(usedFromMatch[1]);
    else if (!limit) {
      const fromMatch = bodyText.match(/from\s*([\d.,]+)\s*GB/i);
      if (fromMatch) limit = parseNumber(fromMatch[1]);
    }

    if (limit > 0) {
      percentage = Math.round((total / limit) * 100);
    } else if (total > 0) {
      percentage = 100;
    }

    return {
      totalRemaining: total.toFixed(1),
      peakRemaining: peak.toFixed(1),
      offPeakRemaining: offPeak.toFixed(1),
      extraRemaining: extra.toFixed(1),
      bonusRemaining: bonus.toFixed(1),
      addOnsRemaining: addOns.toFixed(1),
      totalLimit: limit.toFixed(1),
      percentage,
      lastUpdated: Date.now(),
      isOffline: !!isLogin,
      debugEntries: [
        { source: 'myPackage', value: myPkg ? myPkg.remaining : null },
        { source: 'peak', value: peak },
        { source: 'offPeak', value: offPeak },
        { source: 'extra', value: extra },
        { source: 'bonus', value: bonus },
        { source: 'addOns', value: addOns }
      ]
    };
  }

  // Run on load and also observe small DOM changes
  let lastSavedJson = null;
  let publishTimer = null;
  let stopped = false;

  function safeSetStorage(obj) {
    if (!chrome || !chrome.runtime || !chrome.runtime.id) {
      throw new Error('Extension context invalidated');
    }
    if (chrome.storage && chrome.storage.local && chrome.storage.local.set) {
      chrome.storage.local.set(obj, () => {
        if (chrome.runtime && chrome.runtime.lastError) {
          console.warn('content_script: storage set lastError', chrome.runtime.lastError.message);
        }
      });
    }
  }

  function safeSendMessage(msg) {
    if (!chrome || !chrome.runtime || !chrome.runtime.id) {
      throw new Error('Extension context invalidated');
    }
    if (chrome.runtime && chrome.runtime.sendMessage) {
      chrome.runtime.sendMessage(msg, () => {
        if (chrome.runtime && chrome.runtime.lastError) {
          console.warn('content_script: sendMessage lastError', chrome.runtime.lastError.message);
        }
      });
    }
  }

  function publish() {
    if (stopped) return;
    // debounce rapid succession
    if (publishTimer) clearTimeout(publishTimer);
    publishTimer = setTimeout(() => {
      publishTimer = null;
      if (!chrome || !chrome.runtime || !chrome.runtime.id) {
        stopped = true;
        if (obs) obs.disconnect();
        return;
      }
      const data = scrapeUsage();
      try {
        // Debug: print what GB entries were found
        try { console.debug('slt: scrape entries', data.debugEntries); } catch (e) {}

        const json = JSON.stringify(data);
        if (json === lastSavedJson) return; // no change
        lastSavedJson = json;
        // Do not write from content script; background.js now performs a
        // deterministic multi-page scrape and owns storage updates.
      } catch (e) {
        // eslint-disable-next-line no-console
        console.error('content_script: failed to save usage', e);
      }
    }, 250);
  }

  // Run once now
  publish();

  // Observe for changes in case SPA updates values after network
  const obs = new MutationObserver(() => {
    publish();
  });
  obs.observe(document.body, { childList: true, subtree: true, characterData: true });

  // Listen for explicit scrape requests
  chrome.runtime.onMessage.addListener((req, sender, sendResponse) => {
    if (req && req.action === 'scrapeNow') {
      const out = scrapeUsage();
      chrome.storage.local.set({ usageData: out }, () => sendResponse({ success: true, data: out }));
      return true;
    }
  });
})();
