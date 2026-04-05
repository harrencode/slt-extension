const ALARM_NAME = 'checkSLTUsage';
const CHECK_INTERVAL = 30; // Minutes

function ensureCheckAlarm() {
  chrome.alarms.get(ALARM_NAME, (alarm) => {
    if (!alarm || alarm.periodInMinutes !== CHECK_INTERVAL) {
      chrome.alarms.create(ALARM_NAME, { periodInMinutes: CHECK_INTERVAL });
      console.log(`SLT Monitor: Alarm set to ${CHECK_INTERVAL} minutes`);
    }
  });
}

// Create alarm when installed
chrome.runtime.onInstalled.addListener(() => {
  ensureCheckAlarm();
  fetchData(); // Initial attempt
});

// Re-ensure schedule when browser starts.
chrome.runtime.onStartup.addListener(() => {
  ensureCheckAlarm();
  fetchData();
});

// Alarm listener
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === ALARM_NAME) {
    console.log('SLT Monitor: Checking usage...');
    fetchData();
  }
});

// Message handlers
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'fetchData') {
    fetchData().then(result => sendResponse({ success: true, data: result }))
      .catch(error => sendResponse({ success: false, error: error.message }));
    return true; // async
  }

  if (request.action === 'usageUpdated') {
    // content script notified page updated; optional: process/check threshold
    if (request.data) {
      chrome.storage.local.set({ usageData: request.data });
      checkThreshold(request.data);
      checkUsageWarnings(request.data);
    }
  }
});

// Wait for a tab to finish loading (status === 'complete')
function waitForTabLoad(tabId, timeout = 10000) {
  return new Promise((resolve, reject) => {
    const deadline = Date.now() + timeout;
    function listener(updatedTabId, changeInfo) {
      if (updatedTabId === tabId && changeInfo.status === 'complete') {
        chrome.tabs.onUpdated.removeListener(listener);
        resolve();
      }
    }
    chrome.tabs.onUpdated.addListener(listener);

    // fallback: poll
    (function poll() {
      chrome.tabs.get(tabId, (t) => {
        if (chrome.runtime.lastError) return reject(new Error('Tab not available'));
        if (t.status === 'complete') {
          chrome.tabs.onUpdated.removeListener(listener);
          return resolve();
        }
        if (Date.now() > deadline) {
          chrome.tabs.onUpdated.removeListener(listener);
          return resolve(); // resolve anyway, we'll attempt injection
        }
        setTimeout(poll, 200);
      });
    })();
  });
}

// Function executed inside page to scrape DOM for a specific page kind
function scrapeInPage(kind) {
  function parseNumber(str) {
    if (!str) return 0.0;
    const m = ('' + str).match(/([\d.,]+)/);
    if (!m) return 0.0;
    return parseFloat(m[1].replace(/,/g, '')) || 0.0;
  }

  function remainingFromUsed(used, cap) {
    return cap > 0 ? Math.max(0, cap - used) : 0;
  }

  const bodyText = document.body.innerText || '';
  const isLogin = /login|sign in|username|password/i.test(bodyText) && !/Remaining|GB|My Package/i.test(bodyText);

  function escapeRegExp(str) {
    return (str || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  function parseLabeledUsedFrom(label) {
    const rx = new RegExp(escapeRegExp(label) + '[\\s\\S]{0,160}?([\\d.,]+)\\s*used\\s*from\\s*([\\d.,]+)\\s*GB', 'i');
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

  function parseTileByLabel(label) {
    const tabs = document.querySelectorAll('.buttonTab');
    for (const tab of tabs) {
      const labelEl = tab.querySelector('p.m-0');
      const valueEl = tab.querySelector('.pkg-option');
      if (!labelEl || !valueEl) continue;

      const labelText = (labelEl.textContent || '').trim().toLowerCase();
      if (labelText !== label.trim().toLowerCase()) continue;

      const valueText = (valueEl.textContent || '').trim();
      const m = valueText.match(/([\d.,]+)\s*used\s*from\s*([\d.,]+)\s*GB/i);
      if (!m) return null;

      const used = parseNumber(m[1]);
      const cap = parseNumber(m[2]);
      return { used, cap, remaining: remainingFromUsed(used, cap) };
    }
    return null;
  }


  if (isLogin) {
    return { isOffline: true, lastUpdated: Date.now() };
  }

  if (kind === 'summary') {
    let total = 0.0;
    let limit = 0.0;
    let totalUsed = 0.0;
    let peak = 0.0;
    let peakLimit = 0.0;
    let peakUsed = 0.0;

    const myPackageTile = parseTileByLabel('My Package');
    if (myPackageTile) {
      total = myPackageTile.remaining;
      limit = myPackageTile.cap;
      totalUsed = myPackageTile.used;
    }

    const totalUsedOf = parseLabeledUsedOf('Total\\s*\\(\\s*Standard\\s*\\+\\s*Free\\s*\\)');
    if (totalUsedOf) {
      total = totalUsedOf.remaining;
      limit = totalUsedOf.cap;
      totalUsed = totalUsedOf.used;
    }

    // Peak is the Standard block in summary page.
    const peakUsedOf = parseLabeledUsedOf('(?:^|\\n)\\s*Standard\\b');
    if (peakUsedOf) {
      peak = peakUsedOf.remaining;
      peakLimit = peakUsedOf.cap;
      peakUsed = peakUsedOf.used;
    }

    const peakFallback = parseLabeledUsedOf('(?:^|\\n)\\s*Peak\\b');
    if (peakFallback && !peakLimit) {
      peak = peakFallback.remaining;
      peakLimit = peakFallback.cap;
      peakUsed = peakFallback.used;
    }

    if (!limit) {
      const myPkg = bodyText.match(/My\s*Package[\s\S]{0,120}?([\d.,]+)\s*used\s*from\s*([\d.,]+)\s*GB/i);
      if (myPkg) {
        const used = parseNumber(myPkg[1]);
        const cap = parseNumber(myPkg[2]);
        total = remainingFromUsed(used, cap);
        limit = cap;
        totalUsed = used;
      }
    }

    const offPeak = Math.max(0, total - peak);
    const offPeakLimit = Math.max(0, limit - peakLimit);
    const offPeakUsed = Math.max(0, totalUsed - peakUsed);
    const percentage = limit > 0 ? Math.round((total / limit) * 100) : 0;

    return {
      totalRemaining: total.toFixed(1),
      totalUsed: totalUsed.toFixed(1),
      peakRemaining: peak.toFixed(1),
      peakUsed: peakUsed.toFixed(1),
      offPeakRemaining: offPeak.toFixed(1),
      offPeakUsed: offPeakUsed.toFixed(1),
      totalLimit: limit.toFixed(1),
      peakLimit: peakLimit.toFixed(1),
      offPeakLimit: offPeakLimit.toFixed(1),
      percentage,
      lastUpdated: Date.now(),
      isOffline: false
    };
  }

  // For extra/bonus/addons pages, read first "USED OF" block.
  const anyUsedOf = bodyText.match(/([\d.,]+)\s*GB?\s*USED\s*OF\s*([\d.,]+)\s*GB/i);
  if (anyUsedOf) {
    const used = parseNumber(anyUsedOf[1]);
    const cap = parseNumber(anyUsedOf[2]);
    return {
      used: used.toFixed(1),
      remaining: remainingFromUsed(used, cap).toFixed(1),
      limit: cap.toFixed(1),
      isOffline: false,
      lastUpdated: Date.now()
    };
  }

  if (kind === 'extra') {
    const extra = parseTileByLabel('Extra GB') || parseLabeledUsedFrom('Extra GB');
    if (extra) {
      return {
        used: extra.used.toFixed(1),
        remaining: extra.remaining.toFixed(1),
        limit: extra.cap.toFixed(1),
        isOffline: false,
        lastUpdated: Date.now()
      };
    }
  }

  if (kind === 'bonus') {
    const bonus = parseTileByLabel('Bonus Data') || parseLabeledUsedFrom('Bonus Data');
    if (bonus) {
      return {
        used: bonus.used.toFixed(1),
        remaining: bonus.remaining.toFixed(1),
        limit: bonus.cap.toFixed(1),
        isOffline: false,
        lastUpdated: Date.now()
      };
    }
  }

  if (kind === 'addOns') {
    const addOns = parseTileByLabel('Add-Ons Data') || parseLabeledUsedFrom('Add-Ons Data');
    if (addOns) {
      return {
        used: addOns.used.toFixed(1),
        remaining: addOns.remaining.toFixed(1),
        limit: addOns.cap.toFixed(1),
        isOffline: false,
        lastUpdated: Date.now()
      };
    }
  }

  return { remaining: '0.0', limit: '0.0', isOffline: false, lastUpdated: Date.now() };
}

async function fetchData() {
  let tab = null;
  try {
    const urls = {
      summary: 'https://myslt.slt.lk/boardBand/summary',
      extra: 'https://myslt.slt.lk/boardBand/summary/extraGB',
      bonus: 'https://myslt.slt.lk/boardBand/summary/bonusData',
      addOns: 'https://myslt.slt.lk/boardBand/summary/addOns'
    };

    tab = await chrome.tabs.create({ url: urls.summary, active: false });

    async function delay(ms) {
      return new Promise(resolve => setTimeout(resolve, ms));
    }

    function hasValidResult(result, kind) {
      if (!result || result.isOffline) return false;
      if (kind === 'summary') {
        return (parseFloat(result.totalLimit || '0') > 0) || (parseFloat(result.totalRemaining || '0') > 0);
      }
      return (parseFloat(result.limit || '0') > 0) || (parseFloat(result.remaining || '0') > 0);
    }

    async function scrapeUrl(url, kind) {
      await chrome.tabs.update(tab.id, { url });
      await waitForTabLoad(tab.id, 15000);

      let lastResult = null;
      // SPA content can render after load complete; retry for a short window.
      for (let i = 0; i < 8; i++) {
        const results = await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          func: scrapeInPage,
          args: [kind]
        });
        lastResult = (results && results[0] && results[0].result) ? results[0].result : null;
        if (hasValidResult(lastResult, kind)) return lastResult;
        await delay(750);
      }

      return lastResult;
    }

    const summary = await scrapeUrl(urls.summary, 'summary');
    if (!summary || summary.isOffline) {
      notifyLoggedOut();
      const offlineData = { isOffline: true, lastUpdated: Date.now() };
      chrome.storage.local.set({ usageData: offlineData });
      notifyPeriodicStatus(offlineData);
      try { chrome.tabs.remove(tab.id); } catch (e) {}
      return offlineData;
    }

    if (!hasValidResult(summary, 'summary')) {
      throw new Error('Summary parse returned no usable values');
    }

    const extra = await scrapeUrl(urls.extra, 'extra');
    const bonus = await scrapeUrl(urls.bonus, 'bonus');
    const addOns = await scrapeUrl(urls.addOns, 'addOns');

    const data = {
      ...summary,
      extraUsed: extra && extra.used ? extra.used : '0.0',
      extraRemaining: extra && extra.remaining ? extra.remaining : '0.0',
      extraLimit: extra && extra.limit ? extra.limit : '0.0',
      bonusUsed: bonus && bonus.used ? bonus.used : '0.0',
      bonusRemaining: bonus && bonus.remaining ? bonus.remaining : '0.0',
      bonusLimit: bonus && bonus.limit ? bonus.limit : '0.0',
      addOnsUsed: addOns && addOns.used ? addOns.used : '0.0',
      addOnsRemaining: addOns && addOns.remaining ? addOns.remaining : '0.0',
      addOnsLimit: addOns && addOns.limit ? addOns.limit : '0.0',
      lastUpdated: Date.now(),
      isOffline: false
    };

    chrome.storage.local.set({ usageData: data });
    checkThreshold(data);
    checkUsageWarnings(data);
    notifyPeriodicStatus(data);

    try { chrome.tabs.remove(tab.id); } catch (e) {}
    return data;
  } catch (error) {
    console.error('SLT Monitor Error (tab approach):', error);
    if (tab && tab.id) {
      try { chrome.tabs.remove(tab.id); } catch (e) {}
    }
    // Keep previously known-good values instead of overwriting with zeros.
    const prev = await new Promise((resolve) => {
      chrome.storage.local.get(['usageData'], (res) => resolve(res && res.usageData ? res.usageData : null));
    });
    if (prev) {
      return prev;
    }

    const offlineData = { isOffline: true, lastUpdated: Date.now() };
    chrome.storage.local.set({ usageData: offlineData });
    return offlineData;
  }
}

function toNum(v) {
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : 0;
}

function checkUsageWarnings(data) {
  const peakUsed = toNum(data.peakUsed);
  const peakRemaining = toNum(data.peakRemaining);
  const peakLimit = toNum(data.peakLimit);

  const addOnsRemaining = toNum(data.addOnsRemaining);
  const addOnsLimit = toNum(data.addOnsLimit);
  const addOnsPercent = addOnsLimit > 0 ? (addOnsRemaining / addOnsLimit) * 100 : 0;

  const bonusRemaining = toNum(data.bonusRemaining);
  const bonusLimit = toNum(data.bonusLimit);
  const bonusPercent = bonusLimit > 0 ? (bonusRemaining / bonusLimit) * 100 : 0;

  chrome.storage.local.get([
    'peakLastAlertBucket',
    'peakLastSeenUsed',
    'lastAddOnsLowAlertSent',
    'lastBonusEndAlertSent'
  ], (state) => {
    const updates = {};
    const now = Date.now();

    // Reset milestone tracking if usage cycle appears to have reset.
    const lastSeen = toNum(state.peakLastSeenUsed);
    if (peakUsed + 0.5 < lastSeen) {
      updates.peakLastAlertBucket = 0;
    }
    updates.peakLastSeenUsed = peakUsed;

    // Peak heavy-usage milestone every 5 GB used.
    const stepGb = 5;
    const currentBucket = Math.floor(peakUsed / stepGb);
    const lastBucket = Math.max(0, parseInt(state.peakLastAlertBucket || 0, 10));
    if (currentBucket >= 1 && currentBucket > lastBucket) {
      notifyPeakMilestone(peakUsed, peakRemaining, peakLimit);
      updates.peakLastAlertBucket = currentBucket;
    }

    // Add-ons almost exhausted warning at <= 1% remaining.
    const twelveHours = 12 * 60 * 60 * 1000;
    const lastAddOnsLow = parseInt(state.lastAddOnsLowAlertSent || 0, 10);
    if (addOnsLimit > 0 && addOnsPercent <= 1) {
      if (!lastAddOnsLow || (now - lastAddOnsLow) > twelveHours) {
        notifyAddOnsLow(addOnsRemaining, addOnsLimit);
        updates.lastAddOnsLowAlertSent = now;
      }
    }

    // Bonus data ended warning when remaining is effectively zero.
    const lastBonusEnd = parseInt(state.lastBonusEndAlertSent || 0, 10);
    const bonusEnded = bonusLimit > 0 && (bonusRemaining <= 0.1 || bonusPercent <= 0.5);
    if (bonusEnded) {
      if (!lastBonusEnd || (now - lastBonusEnd) > twelveHours) {
        notifyBonusEnded(bonusRemaining, bonusLimit);
        updates.lastBonusEndAlertSent = now;
      }
    }

    // Check for any exhausted data types and notify (cooldown: 12 hours per type)
    const kinds = [
      { key: 'total', rem: toNum(data.totalRemaining), lim: toNum(data.totalLimit) },
      { key: 'peak', rem: toNum(data.peakRemaining), lim: toNum(data.peakLimit) },
      { key: 'offPeak', rem: toNum(data.offPeakRemaining), lim: toNum(data.offPeakLimit) },
      { key: 'extra', rem: toNum(data.extraRemaining), lim: toNum(data.extraLimit) },
      { key: 'bonus', rem: toNum(data.bonusRemaining), lim: toNum(data.bonusLimit) },
      { key: 'addOns', rem: toNum(data.addOnsRemaining), lim: toNum(data.addOnsLimit) }
    ];

    for (const k of kinds) {
      if (k.lim > 0 && k.rem <= 0) {
        const stateKey = `lastExhaustAlert_${k.key}`;
        const lastSent = parseInt(state[stateKey] || 0, 10);
        if (!lastSent || (now - lastSent) > twelveHours) {
          notifyDataExhausted(k.key, k.rem, k.lim);
          updates[stateKey] = now;
        }
      }
    }

    if (Object.keys(updates).length) {
      chrome.storage.local.set(updates);
    }
  });
}

function checkThreshold(data) {
  chrome.storage.local.get(['threshold', 'lastNotificationSent'], (result) => {
    const threshold = result.threshold || 10;
    const now = Date.now();
    const oneDay = 24 * 60 * 60 * 1000;

    if (data.percentage <= threshold && data.percentage > 0) {
      if (!result.lastNotificationSent || (now - result.lastNotificationSent > oneDay)) {
        showNotification(data.percentage, data.totalRemaining);
        chrome.storage.local.set({ lastNotificationSent: now });
      }
    }
  });
}

const NOTIFICATION_ICON_URL = chrome.runtime.getURL('icons/brand128.png');

function notifyPeakMilestone(used, remaining, limit) {
  chrome.notifications.create('slt-peak-milestone', {
    type: 'basic',
    iconUrl: NOTIFICATION_ICON_URL,
    title: 'Peak Data Usage Update',
    message: `Peak used: ${used.toFixed(1)} GB (remaining ${remaining.toFixed(1)} / ${limit.toFixed(1)} GB). Consider shifting usage to add-ons.`,
    priority: 2
  });
}

function notifyAddOnsLow(remaining, limit) {
  chrome.notifications.create('slt-addons-low', {
    type: 'basic',
    iconUrl: NOTIFICATION_ICON_URL,
    title: 'Add-Ons Data Almost Finished',
    message: `Add-ons remaining is critically low: ${remaining.toFixed(1)} / ${limit.toFixed(1)} GB (<=1%).`,
    priority: 2
  });
}

function notifyBonusEnded(remaining, limit) {
  chrome.notifications.create('slt-bonus-ended', {
    type: 'basic',
    iconUrl: NOTIFICATION_ICON_URL,
    title: 'Bonus Data Finished',
    message: `Bonus data is finished or nearly finished: ${remaining.toFixed(1)} / ${limit.toFixed(1)} GB left.`,
    priority: 2
  });
}

function showNotification(percentage, remaining) {
  chrome.notifications.create({
    type: 'basic',
    iconUrl: NOTIFICATION_ICON_URL,
    title: 'Low Data Alert!',
    message: `You have only ${percentage}% (${remaining} GB) of data remaining.`,
    priority: 2
  });
}

function notifyPeriodicStatus(data) {
  if (!data || data.isOffline) {
    chrome.notifications.create(`slt-status-${Date.now()}`, {
      type: 'basic',
      iconUrl: NOTIFICATION_ICON_URL,
      title: 'SLT Status Update',
      message: 'Please log in to MySLT to update usage data.',
      priority: 1
    });
    return;
  }

  const total = toNum(data.totalRemaining).toFixed(1);
  const peak = toNum(data.peakRemaining).toFixed(1);
  const offPeak = toNum(data.offPeakRemaining).toFixed(1);
  const addOns = toNum(data.addOnsRemaining).toFixed(1);
  const bonus = toNum(data.bonusRemaining).toFixed(1);

  chrome.notifications.create(`slt-status-${Date.now()}`, {
    type: 'basic',
    iconUrl: NOTIFICATION_ICON_URL,
    title: 'SLT Remaining Data (30 min)',
    message: `Total ${total}GB | Peak ${peak}GB | Off-Peak ${offPeak}GB | Add-Ons ${addOns}GB | Bonus ${bonus}GB`,
    priority: 1
  });
}

function notifyLoggedOut() {
  chrome.storage.local.get(['lastLoginNotificationSent'], (res) => {
    const now = Date.now();
    const oneDay = 24 * 60 * 60 * 1000;
    if (res.lastLoginNotificationSent && (now - res.lastLoginNotificationSent) < oneDay) return; // already notified today

    const options = {
      type: 'basic',
      iconUrl: NOTIFICATION_ICON_URL,
      title: 'SLT: Not Logged In',
      message: 'Your SLT session appears to be logged out. Click to open SLT and sign in.',
      priority: 2
    };

    chrome.notifications.create('slt-login-needed', options, () => {
      chrome.storage.local.set({ lastLoginNotificationSent: now });
    });
  });
}

function notifyDataExhausted(kind, remaining, limit) {
  const labels = {
    total: 'Total',
    peak: 'Peak',
    offPeak: 'Off-Peak',
    extra: 'Extra GB',
    bonus: 'Bonus',
    addOns: 'Add-Ons'
  };
  const label = labels[kind] || kind;
  chrome.notifications.create(`slt-exhausted-${kind}`, {
    type: 'basic',
    iconUrl: NOTIFICATION_ICON_URL,
    title: `${label} Data Finished`,
    message: `${label} data appears to be exhausted (${remaining.toFixed(1)} / ${limit.toFixed(1)} GB).`,
    priority: 2
  });
}

// Open SLT page when notification clicked
chrome.notifications.onClicked.addListener((notifId) => {
  if (notifId === 'slt-login-needed') {
    chrome.tabs.create({ url: 'https://myslt.slt.lk/boardBand/summary' });
  }
  if (notifId === 'slt-addons-low') {
    chrome.tabs.create({ url: 'https://myslt.slt.lk/boardBand/summary/addOns' });
  }
  if (notifId === 'slt-peak-milestone') {
    chrome.tabs.create({ url: 'https://myslt.slt.lk/boardBand/summary' });
  }
  if (notifId === 'slt-bonus-ended') {
    chrome.tabs.create({ url: 'https://myslt.slt.lk/boardBand/summary/bonusData' });
  }
  if (notifId && notifId.indexOf('slt-status-') === 0) {
    chrome.tabs.create({ url: 'https://myslt.slt.lk/boardBand/summary' });
  }
});

if (chrome.notifications.onButtonClicked) {
  chrome.notifications.onButtonClicked.addListener((notifId, btnIdx) => {
    if (notifId === 'slt-login-needed') {
      chrome.tabs.create({ url: 'https://myslt.slt.lk/boardBand/summary' });
    }
  });
}
