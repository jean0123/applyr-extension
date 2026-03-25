/**
 * Applyr – Storage & Encryption Utilities
 * Uses AES-GCM via Web Crypto API to encrypt sensitive data (API keys).
 * Exposes a global `ApplyrStorage` object for use across extension pages and content scripts.
 */

(function () {
  'use strict';

  const ENCRYPTION_KEY_STORE = 'applyr_enc_key';

  // ---------- Encryption helpers ----------

  async function getOrCreateEncryptionKey() {
    const stored = await chrome.storage.local.get(ENCRYPTION_KEY_STORE);
    if (stored[ENCRYPTION_KEY_STORE]) {
      const raw = new Uint8Array(stored[ENCRYPTION_KEY_STORE]);
      return crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt']);
    }
    const key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']);
    const exported = await crypto.subtle.exportKey('raw', key);
    await chrome.storage.local.set({ [ENCRYPTION_KEY_STORE]: Array.from(new Uint8Array(exported)) });
    return key;
  }

  async function encryptText(plaintext) {
    const key = await getOrCreateEncryptionKey();
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const encoded = new TextEncoder().encode(plaintext);
    const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, encoded);
    const combined = new Uint8Array(iv.length + encrypted.byteLength);
    combined.set(iv);
    combined.set(new Uint8Array(encrypted), iv.length);
    return btoa(String.fromCharCode(...combined));
  }

  async function decryptText(base64Ciphertext) {
    const key = await getOrCreateEncryptionKey();
    const combined = new Uint8Array(
      atob(base64Ciphertext).split('').map(c => c.charCodeAt(0))
    );
    const iv = combined.slice(0, 12);
    const encrypted = combined.slice(12);
    const decrypted = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, encrypted);
    return new TextDecoder().decode(decrypted);
  }

  // ---------- API Key storage ----------

  async function saveApiKey(provider, apiKey) {
    if (!apiKey) {
      await chrome.storage.local.remove(`apiKey_${provider}`);
      return;
    }
    const encrypted = await encryptText(apiKey);
    await chrome.storage.local.set({ [`apiKey_${provider}`]: encrypted });
  }

  async function getApiKey(provider) {
    const stored = await chrome.storage.local.get(`apiKey_${provider}`);
    if (!stored[`apiKey_${provider}`]) return null;
    try {
      return await decryptText(stored[`apiKey_${provider}`]);
    } catch {
      return null;
    }
  }

  // ---------- Settings ----------

  async function saveSettings(settings) {
    await chrome.storage.local.set({ applyr_settings: settings });
  }

  async function getSettings() {
    const stored = await chrome.storage.local.get('applyr_settings');
    return stored.applyr_settings || {
      provider: 'claude',
      autoApply: false,
      notifications: true,
      useApplyrAI: false,
    };
  }

  // ---------- Profile ----------

  async function saveProfile(profile) {
    await chrome.storage.local.set({ applyr_profile: profile });
  }

  async function getProfile() {
    const stored = await chrome.storage.local.get('applyr_profile');
    return stored.applyr_profile || { name: '', email: '', phone: '', location: '' };
  }

  // ---------- CV / Resume ----------

  async function saveCvText(text) {
    await chrome.storage.local.set({ applyr_cv_text: text });
  }

  async function getCvText() {
    const stored = await chrome.storage.local.get('applyr_cv_text');
    return stored.applyr_cv_text || null;
  }

  async function saveCvMeta(meta) {
    // meta: { filename, size, uploadedAt }
    await chrome.storage.local.set({ applyr_cv_meta: meta });
  }

  async function getCvMeta() {
    const stored = await chrome.storage.local.get('applyr_cv_meta');
    return stored.applyr_cv_meta || null;
  }

  // ---------- Application History ----------

  async function addApplicationEntry(entry) {
    const stored = await chrome.storage.local.get('applyr_history');
    const history = stored.applyr_history || [];
    history.unshift({
      id: Date.now().toString(36),
      date: new Date().toISOString(),
      status: 'applied',
      ...entry,
    });
    if (history.length > 100) history.splice(100);
    await chrome.storage.local.set({ applyr_history: history });
  }

  async function getApplicationHistory() {
    const stored = await chrome.storage.local.get('applyr_history');
    return stored.applyr_history || [];
  }

  async function updateApplicationEntry(id, updates) {
    const stored = await chrome.storage.local.get('applyr_history');
    const history = stored.applyr_history || [];
    const idx = history.findIndex(e => e.id === id);
    if (idx !== -1) {
      history[idx] = { ...history[idx], ...updates };
      await chrome.storage.local.set({ applyr_history: history });
    }
  }

  async function clearAll() {
    await chrome.storage.local.clear();
  }

  async function exportData() {
    const all = await chrome.storage.local.get(null);
    // Remove sensitive/key data from export
    const safe = { ...all };
    delete safe[ENCRYPTION_KEY_STORE];
    ['claude', 'openai', 'gemini'].forEach(p => delete safe[`apiKey_${p}`]);
    return safe;
  }

  async function importData(data) {
    await chrome.storage.local.set(data);
  }

  // ---------- Status helpers ----------

  async function getStatus() {
    const [cvText, settings] = await Promise.all([getCvText(), getSettings()]);
    const apiKey = settings.provider ? await getApiKey(settings.provider) : null;
    return {
      cvLoaded: !!cvText,
      apiConfigured: !!apiKey || settings.useApplyrAI,
      ready: !!cvText && (!!apiKey || settings.useApplyrAI),
    };
  }

  // ---------- Public API ----------

  const ApplyrStorage = {
    saveApiKey,
    getApiKey,
    saveSettings,
    getSettings,
    saveProfile,
    getProfile,
    saveCvText,
    getCvText,
    saveCvMeta,
    getCvMeta,
    addApplicationEntry,
    getApplicationHistory,
    updateApplicationEntry,
    clearAll,
    exportData,
    importData,
    getStatus,
  };

  if (typeof window !== 'undefined') {
    window.ApplyrStorage = ApplyrStorage;
  }
  if (typeof globalThis !== 'undefined') {
    globalThis.ApplyrStorage = ApplyrStorage;
  }
})();
