/**
 * Applyr – Popup Script
 * Handles the popup UI: resume upload, API key management, provider selection, history.
 */

(function () {
  'use strict';

  // ---------- State ----------

  let currentProvider = 'claude';
  let cvMeta = null;

  // ---------- Init ----------

  document.addEventListener('DOMContentLoaded', async () => {
    await Promise.all([
      loadProviderSettings(),
      loadCvSection(),
      loadHistory(),
    ]);
    updateStatus();
    bindEvents();
  });

  // ---------- Events ----------

  function bindEvents() {
    // Settings buttons
    document.getElementById('btn-open-settings')?.addEventListener('click', openSettings);
    document.getElementById('btn-open-settings-footer')?.addEventListener('click', openSettings);

    // Provider selection
    document.querySelectorAll('input[name="provider"]').forEach(radio => {
      radio.addEventListener('change', onProviderChange);
    });

    // API key
    document.getElementById('btn-save-key')?.addEventListener('click', saveApiKey);
    document.getElementById('api-key-input')?.addEventListener('keydown', e => {
      if (e.key === 'Enter') saveApiKey();
    });

    // Buy me a coffee
    document.getElementById('btn-coffee-once')?.addEventListener('click', () => {
      window.open('https://buy.stripe.com/9B6fZh7ELag941f5Z8dIA00', '_blank');
    });
    document.getElementById('btn-coffee-monthly')?.addEventListener('click', () => {
      window.open('https://buy.stripe.com/6oUbJ11gnag941f1ISdIA02', '_blank');
    });

    // Clear history
    document.getElementById('btn-clear-history')?.addEventListener('click', clearHistory);
  }

  // ---------- Provider ----------

  async function loadProviderSettings() {
    const settings = await ApplyrStorage.getSettings();
    currentProvider = settings.provider || 'claude';

    const radio = document.querySelector(`input[name="provider"][value="${currentProvider}"]`);
    if (radio) radio.checked = true;

    // Load saved key for current provider
    await loadApiKeyDisplay();
  }

  async function onProviderChange(e) {
    currentProvider = e.target.value;
    const settings = await ApplyrStorage.getSettings();
    settings.provider = currentProvider;
    await ApplyrStorage.saveSettings(settings);

    // Clear and reload key display
    const input = document.getElementById('api-key-input');
    if (input) input.value = '';
    await loadApiKeyDisplay();
    updateStatus();
  }

  async function loadApiKeyDisplay() {
    const key = await ApplyrStorage.getApiKey(currentProvider);
    const input = document.getElementById('api-key-input');
    const note = document.getElementById('api-key-note');
    if (!input) return;

    if (key) {
      input.value = '•'.repeat(20);
      input.dataset.hasKey = 'true';
      const btn = document.getElementById('btn-save-key');
      if (btn) btn.textContent = 'Clear';
      if (note) {
        note.textContent = `✓ API key saved for ${providerLabel(currentProvider)}.`;
        note.style.color = 'var(--success)';
      }
    } else {
      input.value = '';
      input.dataset.hasKey = 'false';
      const btn = document.getElementById('btn-save-key');
      if (btn) btn.textContent = 'Save';
      if (note) {
        note.textContent = 'Your API key is encrypted and stored locally. It never leaves your device except for API calls.';
        note.style.color = '';
      }
    }

    // Clear input dot-mask when user focuses to type a new key
    input.addEventListener('focus', function onFocus() {
      if (input.dataset.hasKey === 'true') {
        input.value = '';
        input.dataset.hasKey = 'false';
      }
      input.removeEventListener('focus', onFocus);
    }, { once: true });
  }

  async function saveApiKey() {
    const input = document.getElementById('api-key-input');
    const btn = document.getElementById('btn-save-key');
    if (!input) return;

    // If "Clear" mode
    if (btn?.textContent === 'Clear') {
      await ApplyrStorage.saveApiKey(currentProvider, null);
      showToast(`API key cleared for ${providerLabel(currentProvider)}.`);
      await loadApiKeyDisplay();
      updateStatus();
      return;
    }

    const key = input.value.trim();
    if (!key || key.startsWith('•')) {
      showToast('Please paste a valid API key.', 'error');
      return;
    }

    // Basic format validation
    if (!validateKeyFormat(currentProvider, key)) {
      showToast(`Key format looks incorrect for ${providerLabel(currentProvider)}.`, 'error');
      return;
    }

    await ApplyrStorage.saveApiKey(currentProvider, key);
    showToast(`API key saved for ${providerLabel(currentProvider)}!`, 'success');
    await loadApiKeyDisplay();
    updateStatus();
  }

  function validateKeyFormat(provider, key) {
    if (provider === 'claude') return key.startsWith('sk-ant-');
    if (provider === 'openai') return key.startsWith('sk-');
    if (provider === 'gemini') return key.length > 20;
    return true;
  }

  function providerLabel(provider) {
    const labels = { claude: 'Claude', openai: 'ChatGPT', gemini: 'Gemini' };
    return labels[provider] || provider;
  }

  // ---------- CV Section ----------

  async function loadCvSection() {
    const container = document.getElementById('cv-section');
    if (!container) return;

    const [text, meta] = await Promise.all([
      ApplyrStorage.getCvText(),
      ApplyrStorage.getCvMeta(),
    ]);

    cvMeta = meta;

    if (text && meta) {
      renderCvLoaded(container, meta);
    } else {
      renderDropzone(container);
    }
  }

  function renderDropzone(container) {
    container.innerHTML = `
      <div class="dropzone" id="dropzone">
        <input type="file" id="cv-file-input" accept=".pdf,.txt" />
        <span class="dropzone-icon">📄</span>
        <div class="dropzone-title">Drop your resume here</div>
        <div class="dropzone-subtitle">PDF or TXT · <a>click to browse</a></div>
      </div>
      <p class="inline-note" id="upload-status"></p>
    `;

    const dropzone = document.getElementById('dropzone');
    const fileInput = document.getElementById('cv-file-input');

    // Drag & drop
    dropzone.addEventListener('dragover', e => {
      e.preventDefault();
      dropzone.classList.add('drag-over');
    });
    dropzone.addEventListener('dragleave', () => dropzone.classList.remove('drag-over'));
    dropzone.addEventListener('drop', e => {
      e.preventDefault();
      dropzone.classList.remove('drag-over');
      const file = e.dataTransfer?.files[0];
      if (file) handleFileUpload(file);
    });

    fileInput.addEventListener('change', () => {
      if (fileInput.files[0]) handleFileUpload(fileInput.files[0]);
    });
  }

  function renderCvLoaded(container, meta) {
    const uploadedDate = meta.uploadedAt
      ? new Date(meta.uploadedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
      : 'Unknown date';

    container.innerHTML = `
      <div class="cv-loaded-card">
        <span class="cv-icon">📄</span>
        <div class="cv-info">
          <div class="cv-filename" title="${escHtml(meta.filename)}">${escHtml(meta.filename)}</div>
          <div class="cv-meta">Uploaded ${uploadedDate} · ${formatBytes(meta.size)}</div>
        </div>
        <button class="cv-remove-btn" id="btn-remove-cv" title="Remove resume">✕</button>
      </div>
    `;

    document.getElementById('btn-remove-cv')?.addEventListener('click', removeCv);
  }

  async function handleFileUpload(file) {
    const statusEl = document.getElementById('upload-status');
    const dropzone = document.getElementById('dropzone');

    if (statusEl) {
      statusEl.textContent = 'Parsing resume…';
      statusEl.style.color = 'var(--gray-500)';
    }
    if (dropzone) dropzone.style.opacity = '0.6';

    try {
      const { text } = await ApplyrCvParser.parseResumeFile(file);

      if (!text || text.trim().length < 20) {
        throw new Error('Could not extract readable text. Please try a different file format.');
      }

      const meta = {
        filename: file.name,
        size: file.size,
        uploadedAt: new Date().toISOString(),
        charCount: text.length,
      };

      await Promise.all([
        ApplyrStorage.saveCvText(text),
        ApplyrStorage.saveCvMeta(meta),
      ]);

      cvMeta = meta;
      showToast('Resume uploaded successfully!', 'success');
      await loadCvSection();
      updateStatus();
    } catch (err) {
      if (statusEl) {
        statusEl.textContent = err.message;
        statusEl.style.color = 'var(--error)';
      }
      if (dropzone) dropzone.style.opacity = '1';
    }
  }

  async function removeCv() {
    await Promise.all([
      ApplyrStorage.saveCvText(null),
      ApplyrStorage.saveCvMeta(null),
    ]);
    cvMeta = null;
    const container = document.getElementById('cv-section');
    if (container) renderDropzone(container);
    updateStatus();
    showToast('Resume removed.');
  }

  // ---------- Status ----------

  async function updateStatus() {
    const status = await ApplyrStorage.getStatus();
    const dot = document.getElementById('status-dot');
    const title = document.getElementById('status-title');
    const desc = document.getElementById('status-desc');

    if (!dot || !title || !desc) return;

    if (status.ready) {
      dot.className = 'status-indicator ready';
      title.textContent = 'Ready to apply';
      desc.textContent = 'Resume loaded · AI configured · Visit a job page to start';
    } else if (status.cvLoaded && !status.apiConfigured) {
      dot.className = 'status-indicator partial';
      title.textContent = 'API key needed';
      desc.textContent = 'Add your API key above to enable tailoring';
    } else if (!status.cvLoaded) {
      dot.className = 'status-indicator partial';
      title.textContent = 'Resume required';
      desc.textContent = 'Upload your resume to get started';
    } else {
      dot.className = 'status-indicator error';
      title.textContent = 'Not configured';
      desc.textContent = 'Upload resume and add API key';
    }
  }

  // ---------- History ----------

  async function loadHistory() {
    const container = document.getElementById('history-section');
    if (!container) return;

    const history = await ApplyrStorage.getApplicationHistory();

    if (!history || history.length === 0) {
      container.innerHTML = '<p class="history-empty">No applications yet. Visit a job posting on Indeed or LinkedIn to get started.</p>';
      return;
    }

    const items = history.slice(0, 5).map(entry => {
      const date = new Date(entry.date).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
      const platformIcon = entry.platform === 'linkedin' ? '💼' : '🔍';
      const statusClass = entry.status === 'applied' ? 'applied' : 'tailored';
      const statusLabel = entry.status === 'applied' ? 'Applied' : 'Tailored';

      return `
        <div class="history-item">
          <span class="history-icon">${platformIcon}</span>
          <div class="history-info">
            <div class="history-title">${escHtml(entry.jobTitle || 'Job Application')}</div>
            <div class="history-meta">${escHtml(entry.company || '')}${entry.company ? ' · ' : ''}${date}</div>
          </div>
          <span class="history-status ${statusClass}">${statusLabel}</span>
        </div>
      `;
    }).join('');

    container.innerHTML = `<div class="history-list">${items}</div>`;
    if (history.length > 5) {
      container.innerHTML += `<p class="inline-note" style="text-align:center;margin-top:8px;">${history.length - 5} more — open Settings to view all</p>`;
    }
  }

  async function clearHistory() {
    if (!confirm('Clear all application history?')) return;
    const stored = await chrome.storage.local.get(null);
    await chrome.storage.local.remove('applyr_history');
    showToast('History cleared.');
    loadHistory();
  }

  // ---------- Settings ----------

  function openSettings() {
    chrome.runtime.openOptionsPage();
  }

  // ---------- Utilities ----------

  function showToast(message, type = '') {
    const toast = document.getElementById('popup-toast');
    if (!toast) return;
    toast.textContent = message;
    toast.className = type ? `show ${type}` : 'show';
    clearTimeout(toast._timeout);
    toast._timeout = setTimeout(() => {
      toast.className = toast.className.replace('show', '').trim();
    }, 3000);
  }

  function escHtml(str) {
    if (!str) return '';
    const div = document.createElement('div');
    div.appendChild(document.createTextNode(str));
    return div.innerHTML;
  }

  function formatBytes(bytes) {
    if (!bytes) return '';
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  }
})();
