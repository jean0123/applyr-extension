/**
 * Applyr – Background Service Worker
 * Handles messages from content scripts and popup, coordinates AI calls.
 */

importScripts('../lib/storage.js', 'ai-providers.js', 'cv-tailor.js');

// ---------- Message routing ----------

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  handleMessage(message, sender)
    .then(result => sendResponse({ success: true, data: result }))
    .catch(err => sendResponse({ success: false, error: err.message }));

  return true; // Keep message channel open for async response
});

async function handleMessage(message, sender) {
  const { action } = message;

  switch (action) {
    case 'TAILOR_CV':
      return await actionTailorCv(message.payload);

    case 'GET_STATUS':
      return await ApplyrStorage.getStatus();

    case 'GET_SETTINGS':
      return await ApplyrStorage.getSettings();

    case 'GET_HISTORY':
      return await ApplyrStorage.getApplicationHistory();

    case 'ADD_HISTORY':
      await ApplyrStorage.addApplicationEntry(message.payload);
      return { ok: true };

    case 'UPDATE_HISTORY':
      await ApplyrStorage.updateApplicationEntry(message.payload.id, message.payload.updates);
      return { ok: true };

    case 'GET_CV_TEXT':
      return { text: await ApplyrStorage.getCvText() };

    case 'OPEN_BACKGROUND_TAB':
      // Open a URL in a new background tab (user stays on current tab)
      const tab = await chrome.tabs.create({ url: message.payload.url, active: false });
      return { tabId: tab.id };

    default:
      throw new Error(`Unknown action: ${action}`);
  }
}

// ---------- CV tailoring ----------

async function actionTailorCv(payload) {
  const { jobDescription, jobTitle, company } = payload;

  // Load settings and CV from storage
  const [settings, resumeText] = await Promise.all([
    ApplyrStorage.getSettings(),
    ApplyrStorage.getCvText(),
  ]);

  if (!resumeText) {
    throw new Error('No resume found. Please upload your CV in the Applyr popup first.');
  }

  const provider = settings.provider || 'claude';
  const apiKey = await ApplyrStorage.getApiKey(provider);

  if (!apiKey && !settings.useApplyrAI) {
    throw new Error(
      `No API key configured for ${provider}. Please add your API key in the Applyr settings.`
    );
  }

  if (settings.useApplyrAI) {
    throw new Error('Applyr AI subscription is coming soon. Please use your own API key for now.');
  }

  const result = await ApplyrCvTailor.tailorCv({
    resumeText,
    jobDescription,
    jobTitle,
    company,
    provider,
    apiKey,
  });

  return result;
}

// ---------- Extension lifecycle ----------

chrome.runtime.onInstalled.addListener(({ reason }) => {
  if (reason === 'install') {
    // Open options page on first install
    chrome.tabs.create({ url: chrome.runtime.getURL('options/options.html') });
  }
});
