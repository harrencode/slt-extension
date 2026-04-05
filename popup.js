document.addEventListener('DOMContentLoaded', () => {
  const loading = document.getElementById('loading');
  const totalRemaining = document.getElementById('total-remaining');
  const totalFull = document.getElementById('total-full');
  const totalUsed = document.getElementById('total-used');
  const percentageLabel = document.getElementById('percentage-label');
  const progressBar = document.getElementById('progress-bar');
  const peakRemaining = document.getElementById('peak-remaining');
  const peakFull = document.getElementById('peak-full');
  const peakProgress = document.getElementById('peak-progress');
  const offpeakRemaining = document.getElementById('offpeak-remaining');
  const offpeakFull = document.getElementById('offpeak-full');
  const offpeakProgress = document.getElementById('offpeak-progress');
  const extraRemaining = document.getElementById('extra-remaining');
  const extraFull = document.getElementById('extra-full');
  const extraProgress = document.getElementById('extra-progress');
  const bonusRemaining = document.getElementById('bonus-remaining');
  const bonusFull = document.getElementById('bonus-full');
  const bonusProgress = document.getElementById('bonus-progress');
  const addonsRemaining = document.getElementById('addons-remaining');
  const addonsFull = document.getElementById('addons-full');
  const addonsProgress = document.getElementById('addons-progress');
  const loginHint = document.getElementById('login-hint');
  const connectionStatus = document.getElementById('connection-status');
  const refreshBtn = document.getElementById('refresh-btn');
  const settingsBtn = document.getElementById('settings-btn');
  const settingsPanel = document.getElementById('settings-panel');
  const thresholdInput = document.getElementById('threshold');
  const saveSettingsBtn = document.getElementById('save-settings');

  function toNumber(value) {
    const num = Number(value);
    return Number.isFinite(num) ? num : null;
  }

  function getPercent(remaining, limit) {
    const remainingValue = toNumber(remaining);
    const limitValue = toNumber(limit);
    if (remainingValue === null || limitValue === null || limitValue <= 0) {
      return 0;
    }

    return Math.max(0, Math.min(100, (remainingValue / limitValue) * 100));
  }

  function applyBarState(bar, percent) {
    const safePercent = Math.max(0, Math.min(100, percent));
    bar.style.width = `${safePercent}%`;
    bar.classList.remove('is-warning', 'is-danger');

    if (safePercent <= 20) {
      bar.classList.add('is-danger');
      return;
    }

    if (safePercent <= 40) {
      bar.classList.add('is-warning');
    }
  }

  // Load data from storage
  function loadStoredData() {
    chrome.storage.local.get(['usageData', 'threshold'], (result) => {
      if (result.usageData) {
        updateUI(result.usageData);
      }
      if (result.threshold) {
        thresholdInput.value = result.threshold;
      }
      setTimeout(() => loading.classList.add('hidden'), 500);
    });
  }

  function updateUI(data) {
    const gb = (v) => (v === undefined || v === null || v === '' ? '--' : `${v} GB`);
    const full = (v) => (v === undefined || v === null || v === '' ? 'Full: --' : `Full: ${v} GB`);
    const used = (v) => (v === undefined || v === null || v === '' ? 'Used: --' : `Used: ${v} GB`);

    totalRemaining.textContent = gb(data.totalRemaining);
    totalFull.textContent = full(data.totalLimit);
    totalUsed.textContent = used(data.totalUsed);

    peakRemaining.textContent = gb(data.peakRemaining);
    peakFull.textContent = full(data.peakLimit);

    offpeakRemaining.textContent = gb(data.offPeakRemaining);
    offpeakFull.textContent = full(data.offPeakLimit);

    extraRemaining.textContent = gb(data.extraRemaining);
    extraFull.textContent = full(data.extraLimit);

    bonusRemaining.textContent = gb(data.bonusRemaining);
    bonusFull.textContent = full(data.bonusLimit);

    addonsRemaining.textContent = gb(data.addOnsRemaining);
    addonsFull.textContent = full(data.addOnsLimit);
    
    const hasPercentage = !(data.percentage === undefined || data.percentage === null || data.percentage === '');
    const percentage = hasPercentage ? Number(data.percentage) : 0;
    percentageLabel.textContent = hasPercentage ? `${percentage}%` : '--';
    applyBarState(progressBar, hasPercentage ? percentage : 0);

    applyBarState(peakProgress, getPercent(data.peakRemaining, data.peakLimit));
    applyBarState(offpeakProgress, getPercent(data.offPeakRemaining, data.offPeakLimit));
    applyBarState(extraProgress, getPercent(data.extraRemaining, data.extraLimit));
    applyBarState(bonusProgress, getPercent(data.bonusRemaining, data.bonusLimit));
    applyBarState(addonsProgress, getPercent(data.addOnsRemaining, data.addOnsLimit));

    if (data.isOffline) {
      connectionStatus.textContent = 'Login Required';
      connectionStatus.style.color = '#f56565';
      loginHint.classList.remove('hidden');
    } else {
      connectionStatus.textContent = 'Updated: ' + new Date(data.lastUpdated).toLocaleTimeString();
      connectionStatus.style.color = '#48bb78';
      loginHint.classList.add('hidden');
    }
  }

  // Refresh data
  refreshBtn.addEventListener('click', () => {
    loading.classList.remove('hidden');
    chrome.runtime.sendMessage({ action: 'fetchData' }, (response) => {
      if (response && response.success) {
        loadStoredData();
      } else {
        connectionStatus.textContent = 'Update Failed';
        connectionStatus.style.color = '#f56565';
        loading.classList.add('hidden');
      }
    });
  });

  // Settings toggle
  settingsBtn.addEventListener('click', () => {
    settingsPanel.classList.toggle('show');
  });

  // Save settings
  saveSettingsBtn.addEventListener('click', () => {
    const threshold = parseInt(thresholdInput.value);
    chrome.storage.local.set({ threshold }, () => {
      alert('Settings saved!');
      settingsPanel.classList.remove('show');
    });
  });

  loadStoredData();
});
