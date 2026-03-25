/**
 * Applyr – Options Page Script
 * Handles all settings sections: profile, AI config, resume, preferences, history, data.
 */

(function () {
  'use strict';

  let currentProvider = 'claude';

  // ---------- Init ----------

  document.addEventListener('DOMContentLoaded', async () => {
    setupNav();
    await Promise.all([
      loadProfile(),
      loadAiSection(),
      loadResumeSection(),
      loadPreferences(),
      loadHistory(),
    ]);
    bindAllEvents();
  });

  // ---------- Navigation ----------

  function setupNav() {
    const navItems = document.querySelectorAll('.nav-item[data-section]');
    navItems.forEach(item => {
      item.addEventListener('click', () => {
        const target = item.dataset.section;
        navItems.forEach(n => n.classList.remove('active'));
        item.classList.add('active');
        document.querySelectorAll('.page-section').forEach(s => s.classList.remove('active'));
        const section = document.getElementById(`section-${target}`);
        if (section) section.classList.add('active');
        if (target === 'history') loadHistory();
      });
    });
  }

  // ---------- Profile ----------

  async function loadProfile() {
    const profile = await ApplyrStorage.getProfile();
    setVal('profile-name', profile.name);
    setVal('profile-email', profile.email);
    setVal('profile-phone', profile.phone);
    setVal('profile-location', profile.location);
    setVal('profile-linkedin', profile.linkedin);
    setVal('profile-website', profile.website);
  }

  async function saveProfile() {
    const profile = {
      name: getVal('profile-name'),
      email: getVal('profile-email'),
      phone: getVal('profile-phone'),
      location: getVal('profile-location'),
      linkedin: getVal('profile-linkedin'),
      website: getVal('profile-website'),
    };
    await ApplyrStorage.saveProfile(profile);
    showToast('Profile saved!', 'success');
  }

  // ---------- AI Configuration ----------

  async function loadAiSection() {
    const settings = await ApplyrStorage.getSettings();
    currentProvider = settings.provider || 'claude';

    // Mark correct provider card as selected
    document.querySelectorAll('.provider-card-opt').forEach(card => {
      card.classList.toggle('selected', card.dataset.value === currentProvider);
    });

    updateKeyLabel();
    await loadKeyStatus();
  }

  function updateKeyLabel() {
    const labels = { claude: 'Claude API Key', openai: 'OpenAI API Key', gemini: 'Gemini API Key' };
    const labelEl = document.getElementById('ai-key-label');
    if (labelEl) labelEl.textContent = labels[currentProvider] || 'API Key';

    const placeholders = { claude: 'sk-ant-...', openai: 'sk-...', gemini: 'AIzaSy...' };
    const input = document.getElementById('ai-api-key');
    if (input) input.placeholder = placeholders[currentProvider] || 'Paste your API key';
  }

  async function loadKeyStatus() {
    const key = await ApplyrStorage.getApiKey(currentProvider);
    const statusEl = document.getElementById('ai-key-status');
    const input = document.getElementById('ai-api-key');

    if (key) {
      if (statusEl) {
        statusEl.textContent = `✓ API key saved for ${providerLabel(currentProvider)}.`;
        statusEl.style.color = 'var(--success)';
      }
      if (input) {
        input.value = '•'.repeat(24);
        input.dataset.hasKey = 'true';
      }
    } else {
      if (statusEl) {
        statusEl.textContent = 'Your key is AES-256 encrypted and stored locally in Chrome.';
        statusEl.style.color = '';
      }
      if (input) {
        input.value = '';
        input.dataset.hasKey = 'false';
      }
    }
  }

  async function saveAiKey() {
    const input = document.getElementById('ai-api-key');
    if (!input) return;

    const value = input.value.trim();
    if (!value || value.startsWith('•')) {
      showToast('Please paste a valid API key first.', 'error');
      return;
    }

    await ApplyrStorage.saveApiKey(currentProvider, value);
    showToast(`API key saved for ${providerLabel(currentProvider)}!`, 'success');
    await loadKeyStatus();
  }

  async function clearAiKey() {
    await ApplyrStorage.saveApiKey(currentProvider, null);
    showToast(`API key cleared.`);
    await loadKeyStatus();
  }

  // ---------- Resume ----------

  async function loadResumeSection() {
    const container = document.getElementById('options-cv-section');
    if (!container) return;

    const [text, meta] = await Promise.all([
      ApplyrStorage.getCvText(),
      ApplyrStorage.getCvMeta(),
    ]);

    if (text && meta) {
      // Show loaded state
      const uploadedDate = meta.uploadedAt
        ? new Date(meta.uploadedAt).toLocaleDateString(undefined, { dateStyle: 'medium' })
        : 'Unknown';

      container.innerHTML = `
        <div class="opt-cv-loaded">
          <span class="opt-cv-icon">📄</span>
          <div class="opt-cv-info">
            <div class="opt-cv-name" title="${escHtml(meta.filename)}">${escHtml(meta.filename)}</div>
            <div class="opt-cv-meta">Uploaded ${uploadedDate} · ${formatBytes(meta.size)} · ~${text.split(/\s+/).length} words</div>
          </div>
          <div class="opt-cv-actions">
            <button class="btn btn-secondary btn-sm" id="btn-replace-cv">Replace</button>
            <button class="btn btn-danger btn-sm" id="btn-remove-cv-options">Remove</button>
          </div>
        </div>
      `;

      document.getElementById('btn-remove-cv-options')?.addEventListener('click', async () => {
        if (!confirm('Remove your stored resume?')) return;
        await ApplyrStorage.saveCvText(null);
        await ApplyrStorage.saveCvMeta(null);
        showToast('Resume removed.');
        loadResumeSection();
      });

      document.getElementById('btn-replace-cv')?.addEventListener('click', () => {
        // Swap to upload zone
        renderUploadZone(container);
      });

      // Fill text area — skip if stored text looks like garbled binary
      const textArea = document.getElementById('cv-text-input');
      if (textArea && !textArea.value) {
        const printable = (text.match(/[a-zA-Z ]/g) || []).length / text.length;
        if (printable > 0.4) textArea.value = text;
      }
    } else {
      renderUploadZone(container);
    }
  }

  function renderUploadZone(container) {
    container.innerHTML = `
      <div class="opt-dropzone" id="opt-dropzone">
        <input type="file" id="opt-cv-file-input" accept=".pdf,.txt" />
        <div class="opt-dropzone-icon">📂</div>
        <div class="opt-dropzone-title">Drop your resume here or <span class="opt-browse-link">browse</span></div>
        <div class="opt-dropzone-sub">PDF or TXT · max 5 MB</div>
      </div>
      <p class="opt-upload-status" id="opt-upload-status"></p>
    `;
    bindUploadZone();
  }

  function bindUploadZone() {
    const dropzone = document.getElementById('opt-dropzone');
    const fileInput = document.getElementById('opt-cv-file-input');
    if (!dropzone || !fileInput) return;

    dropzone.addEventListener('dragover', e => {
      e.preventDefault();
      dropzone.classList.add('drag-over');
    });
    dropzone.addEventListener('dragleave', () => dropzone.classList.remove('drag-over'));
    dropzone.addEventListener('drop', e => {
      e.preventDefault();
      dropzone.classList.remove('drag-over');
      const file = e.dataTransfer?.files[0];
      if (file) handleOptionsFileUpload(file);
    });

    fileInput.addEventListener('change', () => {
      if (fileInput.files[0]) handleOptionsFileUpload(fileInput.files[0]);
    });
  }

  async function handleOptionsFileUpload(file) {
    const statusEl = document.getElementById('opt-upload-status');
    const dropzone = document.getElementById('opt-dropzone');

    if (file.size > 5 * 1024 * 1024) {
      if (statusEl) { statusEl.textContent = 'File too large. Max 5 MB.'; statusEl.style.color = 'var(--red)'; }
      return;
    }

    if (statusEl) { statusEl.textContent = 'Parsing resume…'; statusEl.style.color = 'var(--text-3)'; }
    if (dropzone) dropzone.style.opacity = '0.6';

    try {
      const { text } = await ApplyrCvParser.parseResumeFile(file);
      if (!text || text.trim().length < 20) throw new Error('Could not extract readable text.');

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

      showToast('Resume uploaded!', 'success');
      const container = document.getElementById('options-cv-section');
      if (container) await loadResumeSection();

      const textArea = document.getElementById('cv-text-input');
      if (textArea) textArea.value = text;
    } catch (err) {
      if (statusEl) { statusEl.textContent = err.message; statusEl.style.color = 'var(--red)'; }
      if (dropzone) dropzone.style.opacity = '1';
    }
  }

  async function saveCvText() {
    const textArea = document.getElementById('cv-text-input');
    const text = textArea?.value?.trim();
    if (!text || text.length < 50) {
      showToast('Resume text is too short. Please paste your full resume.', 'error');
      return;
    }

    const meta = {
      filename: 'resume_pasted.txt',
      size: new Blob([text]).size,
      uploadedAt: new Date().toISOString(),
      charCount: text.length,
    };

    await ApplyrStorage.saveCvText(text);
    await ApplyrStorage.saveCvMeta(meta);
    showToast('Resume text saved!', 'success');
    await loadResumeSection();
  }

  // ---------- Preferences ----------

  async function loadPreferences() {
    const settings = await ApplyrStorage.getSettings();
    setChecked('pref-show-preview', settings.showPreview !== false);
    setChecked('pref-auto-upload', settings.autoUpload !== false);
    setChecked('pref-notifications', settings.notifications !== false);
    setChecked('pref-history', settings.saveHistory !== false);
  }

  async function savePreferences() {
    const settings = await ApplyrStorage.getSettings();
    settings.showPreview = getChecked('pref-show-preview');
    settings.autoUpload = getChecked('pref-auto-upload');
    settings.notifications = getChecked('pref-notifications');
    settings.saveHistory = getChecked('pref-history');
    await ApplyrStorage.saveSettings(settings);
    showToast('Preferences saved!', 'success');
  }

  // ---------- History ----------

  async function loadHistory() {
    const container = document.getElementById('history-table-container');
    if (!container) return;

    const history = await ApplyrStorage.getApplicationHistory();

    if (!history || history.length === 0) {
      container.innerHTML = `
        <div class="empty-state">
          <div class="empty-state-icon">📋</div>
          <div class="empty-state-text">No applications yet. Visit a job page on Indeed or LinkedIn to get started.</div>
        </div>
      `;
      return;
    }

    const rows = history.map(entry => {
      const date = new Date(entry.date).toLocaleDateString(undefined, { dateStyle: 'medium' });
      const platform = entry.platform === 'linkedin' ? '💼 LinkedIn' : '🔍 Indeed';
      const statusClass = entry.status === 'applied' ? 'applied' : 'tailored';
      const statusLabel = entry.status === 'applied' ? 'Applied' : 'Tailored';
      const titleCell = entry.url
        ? `<a href="${escHtml(entry.url)}" target="_blank" rel="noopener" style="color:var(--primary);text-decoration:none;font-weight:500;" title="Open job posting">${escHtml(entry.jobTitle || '—')}</a>`
        : escHtml(entry.jobTitle || '—');
      return `
        <tr>
          <td>${titleCell}</td>
          <td>${escHtml(entry.company || '—')}</td>
          <td>${platform}</td>
          <td>${date}</td>
          <td><span class="status-pill ${statusClass}">${statusLabel}</span></td>
        </tr>
      `;
    }).join('');

    container.innerHTML = `
      <table class="history-table">
        <thead>
          <tr>
            <th>Job Title</th>
            <th>Company</th>
            <th>Platform</th>
            <th>Date</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    `;
  }

  // ---------- Data Management ----------

  async function exportData() {
    const data = await ApplyrStorage.exportData();
    const json = JSON.stringify(data, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `applyr-settings-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    showToast('Settings exported!', 'success');
  }

  async function importData(file) {
    try {
      const text = await file.text();
      const data = JSON.parse(text);
      await ApplyrStorage.importData(data);
      showToast('Settings imported!', 'success');
      await Promise.all([loadProfile(), loadAiSection(), loadResumeSection(), loadPreferences()]);
    } catch (err) {
      showToast('Import failed: invalid file.', 'error');
    }
  }

  // ---------- Bind Events ----------

  function bindAllEvents() {
    // Profile
    document.getElementById('btn-save-profile')?.addEventListener('click', saveProfile);

    // AI provider cards
    document.querySelectorAll('.provider-card-opt').forEach(card => {
      card.addEventListener('click', async () => {
        currentProvider = card.dataset.value;
        document.querySelectorAll('.provider-card-opt').forEach(c => c.classList.remove('selected'));
        card.classList.add('selected');
        const settings = await ApplyrStorage.getSettings();
        settings.provider = currentProvider;
        await ApplyrStorage.saveSettings(settings);
        updateKeyLabel();
        await loadKeyStatus();
        showToast(`Switched to ${providerLabel(currentProvider)}.`);
      });
    });

    // API key focus: clear mask
    const aiKeyInput = document.getElementById('ai-api-key');
    if (aiKeyInput) {
      aiKeyInput.addEventListener('focus', function onFocus() {
        if (aiKeyInput.dataset.hasKey === 'true') {
          aiKeyInput.value = '';
          aiKeyInput.dataset.hasKey = 'false';
        }
        aiKeyInput.removeEventListener('focus', onFocus);
      }, { once: true });
    }

    document.getElementById('btn-save-ai-key')?.addEventListener('click', saveAiKey);
    document.getElementById('btn-clear-ai-key')?.addEventListener('click', clearAiKey);

    // Resume
    document.getElementById('btn-save-cv-text')?.addEventListener('click', saveCvText);
    document.getElementById('btn-clear-cv-text')?.addEventListener('click', () => {
      const ta = document.getElementById('cv-text-input');
      if (ta) ta.value = '';
    });

    // Preferences
    document.getElementById('btn-save-prefs')?.addEventListener('click', savePreferences);

    // Support / Coffee
    document.getElementById('btn-coffee-once-opts')?.addEventListener('click', () => {
      window.open('https://buy.stripe.com/9B6fZh7ELag941f5Z8dIA00', '_blank');
    });
    document.getElementById('btn-coffee-monthly-opts')?.addEventListener('click', () => {
      window.open('https://buy.stripe.com/6oUbJ11gnag941f1ISdIA02', '_blank');
    });

    // History clear
    document.getElementById('btn-clear-history-options')?.addEventListener('click', async () => {
      if (!confirm('Clear all application history? This cannot be undone.')) return;
      await chrome.storage.local.remove('applyr_history');
      showToast('History cleared.');
      await loadHistory();
    });

    // Data management
    document.getElementById('btn-export-data')?.addEventListener('click', exportData);

    document.getElementById('btn-import-data')?.addEventListener('click', () => {
      document.getElementById('import-file-input')?.click();
    });

    document.getElementById('import-file-input')?.addEventListener('change', e => {
      const file = e.target.files?.[0];
      if (file) importData(file);
    });

    document.getElementById('btn-clear-resume')?.addEventListener('click', async () => {
      if (!confirm('Remove your stored resume?')) return;
      await ApplyrStorage.saveCvText(null);
      await ApplyrStorage.saveCvMeta(null);
      showToast('Resume cleared.');
      const container = document.getElementById('options-cv-section');
      if (container) renderUploadZone(container);
    });

    document.getElementById('btn-clear-keys')?.addEventListener('click', async () => {
      if (!confirm('Clear all stored API keys?')) return;
      await Promise.all(['claude', 'openai', 'gemini'].map(p => ApplyrStorage.saveApiKey(p, null)));
      showToast('All API keys cleared.');
      await loadKeyStatus();
    });

    document.getElementById('btn-reset-all')?.addEventListener('click', async () => {
      if (!confirm('Reset ALL Applyr data? This will delete your resume, API keys, profile, and history.')) return;
      if (!confirm('Are you absolutely sure? This cannot be undone.')) return;
      await ApplyrStorage.clearAll();
      showToast('All data reset.');
      location.reload();
    });

    // Help link
    document.getElementById('link-help')?.addEventListener('click', e => {
      e.preventDefault();
      window.open('https://github.com/jean0123/applyr-extension/issues', '_blank');
    });
  }

  // ---------- Utilities ----------

  function setVal(id, value) {
    const el = document.getElementById(id);
    if (el) el.value = value || '';
  }

  function getVal(id) {
    return document.getElementById(id)?.value?.trim() || '';
  }

  function setChecked(id, value) {
    const el = document.getElementById(id);
    if (el) el.checked = !!value;
  }

  function getChecked(id) {
    return document.getElementById(id)?.checked ?? false;
  }

  function providerLabel(provider) {
    return { claude: 'Claude', openai: 'ChatGPT', gemini: 'Gemini' }[provider] || provider;
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
    if (bytes < 1048576) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / 1048576).toFixed(1) + ' MB';
  }

  function showToast(message, type = '') {
    const toast = document.getElementById('options-toast');
    if (!toast) return;
    toast.textContent = message;
    toast.className = type ? `show ${type}` : 'show';
    clearTimeout(toast._timeout);
    toast._timeout = setTimeout(() => {
      toast.className = toast.className.replace('show', '').trim();
    }, 3500);
  }
})();
