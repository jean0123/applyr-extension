/**
 * Applyr – Indeed Job Page Handler
 * Extracts job data and handles the application flow on Indeed pages.
 * Defines global `IndeedHandler` used by content.js.
 */

(function () {
  'use strict';

  function isJobPage() {
    const url = window.location.href;
    // Indeed job pages: /viewjob, /rc/clk, /pagead/clk, or have jk param
    return (
      /indeed\.com\/(viewjob|rc\/clk|pagead\/clk|applystart)/.test(url) ||
      url.includes('jk=') ||
      document.querySelector('[data-jk]') !== null ||
      document.querySelector('.jobsearch-JobComponent') !== null ||
      document.querySelector('#jobDescriptionText') !== null
    );
  }

  function extractJobDescription() {
    // Try multiple selectors used by Indeed across different layouts
    const selectors = [
      '#jobDescriptionText',
      '.jobsearch-JobComponent-description',
      '[data-testid="jobsearch-JobComponent-description"]',
      '.job-description',
      '#job-content',
      '.jobDescription',
      '[class*="jobDescriptionText"]',
      '[class*="description-content"]',
    ];

    for (const sel of selectors) {
      const el = document.querySelector(sel);
      if (el && el.innerText.trim().length > 100) {
        return el.innerText.trim();
      }
    }

    // Fallback: grab the largest text block that looks like a job description
    const allDivs = document.querySelectorAll('div');
    let bestEl = null;
    let bestLen = 0;
    for (const div of allDivs) {
      const text = div.innerText;
      if (text.length > bestLen && text.length < 20000 && text.includes('experience')) {
        bestEl = div;
        bestLen = text.length;
      }
    }

    return bestEl ? bestEl.innerText.trim() : '';
  }

  function extractJobTitle() {
    const selectors = [
      '[data-testid="jobsearch-JobInfoHeader-title"]',
      '.jobsearch-JobInfoHeader-title',
      'h1.jobsearch-JobInfoHeader-title',
      'h1[class*="jobTitle"]',
      '.icl-u-lg-heading',
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
      '[data-testid="inlineHeader-companyName"]',
      '.jobsearch-InlineCompanyRating-companyHeader a',
      '.jobsearch-CompanyReview--heading',
      '.icl-u-lg-copy.icl-u-textColor--secondary a',
      '[data-testid="jobsearch-CompanyName"]',
      '[class*="companyName"]',
    ];

    for (const sel of selectors) {
      const el = document.querySelector(sel);
      if (el && el.innerText.trim()) {
        return el.innerText.trim();
      }
    }
    return '';
  }

  function findApplyButton() {
    const selectors = [
      'button[aria-label*="Apply now"]:not(#applyr-trigger-btn)',
      'button[id*="apply"]:not(#applyr-trigger-btn)',
      'a[id*="apply"]:not(#applyr-trigger-btn)',
      'button[class*="apply"]:not(#applyr-trigger-btn)',
      '[data-testid="apply-button"]',
      '[data-testid="applyButton"]',
      '.ia-IndeedApplyButton',
      '#indeedApplyButton',
      'button.jobsearch-IndeedApplyButton',
      'a[href*="applystart"]',
    ];

    for (const sel of selectors) {
      const btn = document.querySelector(sel);
      if (btn && !btn.closest('#applyr-btn-wrapper')) return btn;
    }

    // Fallback: find any button with "apply" text (exclude Applyr's own buttons)
    const buttons = document.querySelectorAll('button, a');
    for (const btn of buttons) {
      if (btn.id === 'applyr-trigger-btn' || btn.closest('#applyr-btn-wrapper') || btn.closest('#applyr-panel')) continue;
      if (/\bapply\b/i.test(btn.innerText) && !btn.innerText.toLowerCase().includes('already') && !btn.innerText.toLowerCase().includes('tailor')) {
        return btn;
      }
    }
    return null;
  }

  /**
   * Find the "Apply" button location and return the element to inject next to.
   */
  function getButtonInsertionTarget() {
    const applyBtn = findApplyButton();
    if (applyBtn) return applyBtn;
    return document.querySelector('.jobsearch-ButtonContainer, .jobsearch-IndeedApplyButton-buttonWrapper') ||
           document.querySelector('[class*="apply-button"]') ||
           null;
  }

  /**
   * Trigger the native apply flow.
   * Indeed blocks programmatic .click() (isTrusted check), so we extract the URL and open it directly.
   */
  async function triggerApply() {
    const btn = findApplyButton();
    if (!btn) throw new Error('Could not find the Apply button on this page.');

    // If it's a link, open its href directly
    const link = btn.tagName === 'A' ? btn : btn.closest('a') || btn.querySelector('a');
    if (link && link.href) {
      window.open(link.href, '_blank');
      return;
    }

    // If button has an onclick that navigates, try to find the URL in parent links
    const parentLink = btn.closest('a[href]');
    if (parentLink && parentLink.href) {
      window.open(parentLink.href, '_blank');
      return;
    }

    // Try to find the apply URL from the page
    const applyLinks = document.querySelectorAll('a[href*="applystart"], a[href*="apply"], a[href*="indeed.com/rc"]');
    for (const a of applyLinks) {
      if (/apply/i.test(a.innerText) || a.href.includes('applystart')) {
        window.open(a.href, '_blank');
        return;
      }
    }

    // Last resort: try clicking and dispatching trusted-like events
    btn.click();
    btn.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
  }

  /**
   * After clicking Apply, wait for the file upload input to appear in a new tab or modal.
   * Indeed typically opens a new tab for applications.
   */
  async function waitForUploadInput(timeoutMs = 15000) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const input = document.querySelector(
        'input[type="file"][accept*="pdf"], input[type="file"][name*="resume"], input[type="file"][id*="resume"]'
      );
      if (input) return input;
      await sleep(500);
    }
    return null;
  }

  async function uploadFile(inputEl, file) {
    // Use DataTransfer to set the file on the input
    const dt = new DataTransfer();
    dt.items.add(file);
    inputEl.files = dt.files;
    inputEl.dispatchEvent(new Event('change', { bubbles: true }));
    inputEl.dispatchEvent(new Event('input', { bubbles: true }));
  }

  function sleep(ms) {
    return new Promise(r => setTimeout(r, ms));
  }

  // Public API
  const IndeedHandler = {
    isJobPage,
    extractJobDescription,
    extractJobTitle,
    extractCompany,
    getButtonInsertionTarget,
    findApplyButton,
    triggerApply,
    waitForUploadInput,
    uploadFile,
    PLATFORM: 'indeed',
  };

  if (typeof window !== 'undefined') window.IndeedHandler = IndeedHandler;
})();
