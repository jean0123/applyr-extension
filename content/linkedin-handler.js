/**
 * Applyr – LinkedIn Job Page Handler
 * Extracts job data and handles the Easy Apply flow on LinkedIn pages.
 * Defines global `LinkedInHandler` used by content.js.
 */

(function () {
  'use strict';

  function isJobPage() {
    const url = window.location.href;
    return (
      /linkedin\.com\/jobs\/(view|search|collections)/.test(url) ||
      document.querySelector('.jobs-search__job-details') !== null ||
      document.querySelector('.job-view-layout') !== null ||
      document.querySelector('[data-job-id]') !== null
    );
  }

  function extractJobDescription() {
    const selectors = [
      '.jobs-description__content',
      '.jobs-description-content__text',
      '.job-view-layout .description__text',
      '[class*="jobs-description"]',
      '.description__text--rich',
      '#job-details',
      '.jobs-box__html-content',
    ];

    for (const sel of selectors) {
      const el = document.querySelector(sel);
      if (el && el.innerText.trim().length > 100) {
        return el.innerText.trim();
      }
    }

    // Fallback: look for the job details pane
    const pane = document.querySelector('.jobs-search__job-details--wrapper, .job-view-layout');
    if (pane) return pane.innerText.trim();

    return '';
  }

  function extractJobTitle() {
    const selectors = [
      '.jobs-unified-top-card__job-title',
      '.job-details-jobs-unified-top-card__job-title',
      'h1.t-24',
      'h1[class*="job-title"]',
      '.jobs-details-top-card__job-title',
      'h1',
    ];

    for (const sel of selectors) {
      const el = document.querySelector(sel);
      if (el && el.innerText.trim()) {
        return el.innerText.trim().replace(/\s+/g, ' ');
      }
    }
    return document.title.split('|')[0].trim() || 'Job Position';
  }

  function extractCompany() {
    const selectors = [
      '.jobs-unified-top-card__company-name a',
      '.jobs-unified-top-card__primary-description a',
      '.job-details-jobs-unified-top-card__company-name a',
      '.jobs-details-top-card__company-url',
      '[class*="company-name"]',
    ];

    for (const sel of selectors) {
      const el = document.querySelector(sel);
      if (el && el.innerText.trim()) {
        return el.innerText.trim();
      }
    }
    return '';
  }

  function findEasyApplyButton() {
    // LinkedIn Easy Apply button
    const selectors = [
      '.jobs-apply-button--top-card',
      'button[aria-label*="Easy Apply"]',
      'button.jobs-apply-button',
      '.artdeco-button--primary[data-control-name="jobdetails_topcard_inapply"]',
      'button[class*="easy-apply"]',
    ];

    for (const sel of selectors) {
      const btn = document.querySelector(sel);
      if (btn) return btn;
    }

    // Fallback: find button containing "Easy Apply" or "Apply"
    const buttons = document.querySelectorAll('button');
    // First pass: prefer Easy Apply
    for (const btn of buttons) {
      if (btn.id === 'applyr-trigger-btn' || btn.closest('#applyr-btn-wrapper')) continue;
      if (/easy apply/i.test(btn.innerText) || btn.getAttribute('aria-label')?.toLowerCase().includes('easy apply')) {
        return btn;
      }
    }
    // Second pass: any Apply button (external apply)
    for (const btn of buttons) {
      if (btn.id === 'applyr-trigger-btn' || btn.closest('#applyr-btn-wrapper') || btn.closest('#applyr-panel')) continue;
      if (/^\s*apply\s*$/i.test(btn.innerText?.replace(/[↗🔗]/g, '').trim())) {
        return btn;
      }
    }
    return null;
  }

  function getButtonInsertionTarget() {
    const applyBtn = findEasyApplyButton();
    if (applyBtn) return applyBtn.parentElement || applyBtn;

    return (
      document.querySelector('.jobs-apply-button--top-card') ||
      document.querySelector('[class*="top-card-layout__cta"]') ||
      null
    );
  }

  async function triggerApply() {
    const btn = findEasyApplyButton();
    if (!btn) throw new Error('Could not find the Easy Apply button. This job may require applying on the company website.');
    btn.click();
  }

  /**
   * Wait for the Easy Apply modal to appear.
   */
  async function waitForModal(timeoutMs = 10000) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const modal = document.querySelector(
        '.jobs-easy-apply-modal, [class*="easy-apply-modal"], [aria-label*="Easy Apply"]'
      );
      if (modal) return modal;
      await sleep(300);
    }
    return null;
  }

  /**
   * Within the Easy Apply modal, find the resume upload input.
   */
  async function waitForUploadInput(timeoutMs = 15000) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const input = document.querySelector(
        'input[type="file"][accept*="pdf"], input[type="file"][id*="resume"], .jobs-document-upload__upload-btn input'
      );
      if (input) return input;
      await sleep(500);
    }
    return null;
  }

  async function uploadFile(inputEl, file) {
    const dt = new DataTransfer();
    dt.items.add(file);
    inputEl.files = dt.files;
    inputEl.dispatchEvent(new Event('change', { bubbles: true }));
    inputEl.dispatchEvent(new Event('input', { bubbles: true }));

    // Also trigger React synthetic events
    const nativeInputValueSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
    if (nativeInputValueSetter) {
      inputEl.dispatchEvent(new Event('change', { bubbles: true }));
    }
  }

  /**
   * Find "Next" / "Continue" button within the modal to advance multi-step form.
   */
  function findNextButton(modal) {
    if (!modal) return null;
    const buttons = modal.querySelectorAll('button');
    for (const btn of buttons) {
      const txt = (btn.innerText || btn.getAttribute('aria-label') || '').toLowerCase();
      if (txt.includes('next') || txt.includes('continue') || txt.includes('review')) {
        return btn;
      }
    }
    return null;
  }

  /**
   * Find "Submit application" button.
   */
  function findSubmitButton(modal) {
    if (!modal) return null;
    const buttons = modal.querySelectorAll('button');
    for (const btn of buttons) {
      const txt = (btn.innerText || btn.getAttribute('aria-label') || '').toLowerCase();
      if (txt.includes('submit')) return btn;
    }
    return null;
  }

  function sleep(ms) {
    return new Promise(r => setTimeout(r, ms));
  }

  // Public API
  const LinkedInHandler = {
    isJobPage,
    extractJobDescription,
    extractJobTitle,
    extractCompany,
    getButtonInsertionTarget,
    findApplyButton: findEasyApplyButton,
    triggerApply,
    waitForModal,
    waitForUploadInput,
    uploadFile,
    findNextButton,
    findSubmitButton,
    PLATFORM: 'linkedin',
  };

  if (typeof window !== 'undefined') window.LinkedInHandler = LinkedInHandler;
})();
