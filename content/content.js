/**
 * Applyr – Main Content Script
 * Coordinates the Indeed/LinkedIn handlers, injects the Applyr button and panel UI,
 * and orchestrates the full tailor → preview → apply workflow.
 */

(function () {
  'use strict';

  // ---------- Detect platform ----------

  function detectHandler() {
    const hostname = window.location.hostname;
    if (hostname.includes('indeed.com') && window.IndeedHandler?.isJobPage()) {
      return window.IndeedHandler;
    }
    if (hostname.includes('linkedin.com') && window.LinkedInHandler?.isJobPage()) {
      return window.LinkedInHandler;
    }
    return null;
  }

  // ---------- State ----------

  let handler = null;
  let panelState = 'idle'; // idle | loading | preview | applying | done | error
  let tailoredData = null;   // { resumeData, tailoringNotes, rawText }
  let tailoredPdfBlob = null;
  let overlayEl = null;
  let panelEl = null;
  let entryId = null;

  // ---------- Initialise ----------

  function init() {
    // Clean up any leftover UI from previous job views (SPA navigation)
    const oldTooltip = document.getElementById('applyr-apply-tooltip');
    if (oldTooltip) oldTooltip.remove();
    const oldHighlight = document.getElementById('applyr-highlight-style');
    if (oldHighlight) oldHighlight.remove();
    document.querySelectorAll('.applyr-highlighted').forEach(el => el.classList.remove('applyr-highlighted'));

    // Check for pending operations (even on non-job pages like the apply form)
    checkPendingTailor();
    checkPendingUpload();

    handler = detectHandler();
    if (!handler) return;

    // Slight delay to ensure job page has fully rendered
    setTimeout(injectApplyrButton, 1200);
  }

  function checkPendingTailor() {
    chrome.storage.local.get('pendingTailor', (result) => {
      const pending = result.pendingTailor;
      if (!pending) return;

      // Only process if less than 2 minutes old
      if (Date.now() - pending.timestamp > 120000) {
        chrome.storage.local.remove('pendingTailor');
        return;
      }

      // Clear the flag immediately so it doesn't trigger again
      chrome.storage.local.remove('pendingTailor');

      // Wait for page to settle, then open panel and start tailoring
      setTimeout(() => {
        openPanel();
        panelState = 'loading';

        setBody(`
          <div class="applyr-progress-container">
            <div class="applyr-spinner"></div>
            <p class="applyr-progress-label">Tailoring your resume…</p>
            <p class="applyr-progress-sub">AI is matching your experience to this job's requirements</p>
          </div>
        `);
        setActions('');

        // Run the tailoring with the saved job data
        runPendingTailor(pending);
      }, 1500);
    });
  }

  async function runPendingTailor(pending) {
    const { jobTitle, company, jobDescription, jobUrl } = pending;

    if (!jobDescription || jobDescription.length < 50) {
      renderError('Could not extract the job description. Please try again from the job posting page.');
      return;
    }

    const result = await sendMessage('TAILOR_CV', { jobDescription, jobTitle, company });

    if (!result.success) {
      renderError(result.error);
      return;
    }

    tailoredData = result.data;
    panelState = 'preview';

    // Generate the PDF
    try {
      if (tailoredData.resumeData) {
        tailoredPdfBlob = ApplyrPdfGenerator.generatePdf(tailoredData.resumeData);
      } else if (tailoredData.rawText) {
        tailoredPdfBlob = ApplyrPdfGenerator.generatePdfFromText(jobTitle, tailoredData.rawText);
      }
    } catch (err) {
      /* PDF generation failed — continue without PDF */
    }

    // Log to history
    entryId = Date.now().toString(36);
    await sendMessage('ADD_HISTORY', {
      id: entryId,
      jobTitle,
      company,
      platform: window.location.hostname.includes('indeed') ? 'indeed' : 'linkedin',
      status: 'tailored',
      url: jobUrl || window.location.href,
    });

    // Auto-upload the tailored PDF to Indeed's form, then show preview
    if (tailoredPdfBlob) {
      await autoUploadResume(tailoredPdfBlob, jobTitle, company);
    }

    renderApplyPagePreview(jobTitle, company);
  }

  // ---------- Auto-upload to Indeed's application form ----------

  function waitForEl(selectorOrFn, timeoutMs = 6000) {
    return new Promise((resolve) => {
      const start = Date.now();
      const check = () => {
        const el = typeof selectorOrFn === 'function' ? selectorOrFn() : document.querySelector(selectorOrFn);
        if (el) return resolve(el);
        if (Date.now() - start > timeoutMs) return resolve(null);
        setTimeout(check, 400);
      };
      check();
    });
  }

  function findByText(selector, text) {
    for (const el of document.querySelectorAll(selector)) {
      if (el.innerText?.toLowerCase().includes(text.toLowerCase())) return el;
    }
    return null;
  }

  function blobToBase64(blob) {
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result);
      reader.readAsDataURL(blob);
    });
  }

  function base64ToBlob(dataUrl) {
    const [header, data] = dataUrl.split(',');
    const mime = header.match(/:(.*?);/)[1];
    const binary = atob(data);
    const arr = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) arr[i] = binary.charCodeAt(i);
    return new Blob([arr], { type: mime });
  }

  function shortFileName(company, jobTitle) {
    const c = (company || 'company').replace(/[^a-zA-Z0-9]/g, '_').slice(0, 15).replace(/_+$/, '');
    const t = (jobTitle || 'job').replace(/[^a-zA-Z0-9]/g, '_').slice(0, 15).replace(/_+$/, '');
    return `CV_${c}_${t}.pdf`;
  }

  async function autoUploadResume(pdfBlob, jobTitle, company) {
    const fileName = shortFileName(company, jobTitle);

    // Update panel to show upload progress
    setBody(`
      <div class="applyr-progress-container">
        <div class="applyr-spinner"></div>
        <p class="applyr-progress-label">Uploading tailored resume…</p>
        <p class="applyr-progress-sub">Navigating Indeed's application form</p>
      </div>
    `);
    setActions('');

    // Detect which page we're on
    const fileRadio = document.querySelector('input[type="radio"][value="file"]');
    const isResumeSelectionPage = !!fileRadio;

    if (isResumeSelectionPage) {
      // --- SCENARIO: "Add a resume for the employer" page ---
      await uploadOnResumeSelectionPage(pdfBlob, fileName);
    } else {
      // --- SCENARIO: "Please review your application" page ---
      // Can't navigate away (breaks Indeed's form state).
      // Auto-download the PDF and guide the user to upload it via the Edit link.
      const file = new File([pdfBlob], fileName, { type: 'application/pdf' });
      const url = URL.createObjectURL(pdfBlob);
      const a = document.createElement('a');
      a.href = url;
      a.download = fileName;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 5000);

      // Save PDF for pendingUpload in case Edit navigates to resume-selection
      const base64 = await blobToBase64(pdfBlob);
      await new Promise(r => chrome.storage.local.set({ pendingUpload: { base64, fileName, timestamp: Date.now() } }, r));

      /* Review page — PDF downloaded, user clicks Edit to upload */
    }
  }

  async function uploadOnResumeSelectionPage(pdfBlob, fileName) {
    const file = new File([pdfBlob], fileName, { type: 'application/pdf' });

    try {
      // Step 1: Select the "file" radio (the uploaded PDF option, not Indeed Resume)
      const fileRadio = document.querySelector('input[type="radio"][value="file"]');
      if (fileRadio && !fileRadio.checked) {
        fileRadio.click();
        // Also click the label/parent for React state updates
        const label = fileRadio.closest('label') || fileRadio.parentElement;
        if (label && label !== fileRadio) label.click();
        await new Promise(r => setTimeout(r, 800));
      }

      // Step 2: Click "Resume options" button
      const resumeOpts = findByText('button', 'resume options');
      if (resumeOpts) {
        resumeOpts.click();
        await new Promise(r => setTimeout(r, 800));
      }

      // Step 3: Click "Upload a different file" button
      const uploadBtn = await waitForEl(() => findByText('button, a', 'upload a different file'), 4000);
      if (uploadBtn) {
        uploadBtn.click();
        await new Promise(r => setTimeout(r, 800));
      }

      // Step 4: Find the file input and set our tailored PDF
      const fileInput = await waitForEl('input[type="file"]', 4000);
      if (fileInput) {
        const dt = new DataTransfer();
        dt.items.add(file);
        fileInput.files = dt.files;
        fileInput.dispatchEvent(new Event('change', { bubbles: true }));
        fileInput.dispatchEvent(new Event('input', { bubbles: true }));
        await new Promise(r => setTimeout(r, 2000));
        /* Resume auto-uploaded */
      }
    } catch (_) {
      /* Auto-upload failed — user will upload manually */
    }
  }

  // Check for pending upload on page load (after navigating from review → resume-selection)
  function checkPendingUpload() {
    chrome.storage.local.get('pendingUpload', async (result) => {
      const pending = result.pendingUpload;
      if (!pending) return;
      if (Date.now() - pending.timestamp > 60000) {
        chrome.storage.local.remove('pendingUpload');
        return;
      }

      // Only process on resume-selection pages
      const fileRadio = document.querySelector('input[type="radio"][value="file"]');
      if (!fileRadio) return;

      // Clear flag
      chrome.storage.local.remove('pendingUpload');

      // Recreate the blob from base64
      const blob = base64ToBlob(pending.base64);

      // Open panel and upload
      openPanel();
      setBody(`
        <div class="applyr-progress-container">
          <div class="applyr-spinner"></div>
          <p class="applyr-progress-label">Uploading tailored resume…</p>
          <p class="applyr-progress-sub">Almost done!</p>
        </div>
      `);
      setActions('');

      await new Promise(r => setTimeout(r, 1000));
      await uploadOnResumeSelectionPage(blob, pending.fileName);

      // Show success
      setBody(`
        <div style="background:#ECFDF5;border:1px solid #A7F3D0;border-radius:12px;padding:14px 16px;color:#065F46;font-size:13px;">
          ✓ Tailored resume uploaded! Click Continue to proceed with your application.
        </div>
      `);
      setActions(`
        <button class="applyr-btn applyr-btn-success" id="btn-done-upload" style="flex:1;padding:12px;border-radius:12px;border:none;background:linear-gradient(135deg,#059669,#10B981);color:white;font-weight:600;font-size:13px;cursor:pointer;">✓ Done</button>
      `);
      document.getElementById('btn-done-upload')?.addEventListener('click', closePanel);
    });
  }

  function renderApplyPagePreview(jobTitle, company) {
    const notes = tailoredData.tailoringNotes || '';
    const hasPdf = !!tailoredPdfBlob;
    const downloadUrl = hasPdf ? URL.createObjectURL(tailoredPdfBlob) : null;

    setBody(`
      <div>
        <p class="applyr-section-title" style="color:#6B6880;font-size:10.5px;font-weight:700;text-transform:uppercase;letter-spacing:0.08em;margin:0 0 8px;">Tailored For</p>
        <div class="applyr-job-card" style="background:white;border:1px solid rgba(120,110,220,0.12);border-radius:12px;padding:14px 16px;">
          <p style="font-weight:600;margin:0;color:#1A1523;">${escHtml(jobTitle)}</p>
          ${company ? `<p style="font-size:12px;color:#9490AD;margin:4px 0 0;">${escHtml(company)}</p>` : ''}
        </div>
      </div>

      <div style="background:#ECFDF5;border:1px solid #A7F3D0;border-radius:12px;padding:14px 16px;color:#065F46;font-size:13px;line-height:1.6;">
        ${document.querySelector('input[type="radio"][value="file"]')
          ? '✓ Resume tailored and uploaded! Continue with your application.'
          : '✓ Resume tailored and downloaded! Scroll down, click <strong>Edit</strong> next to Resume, then upload the downloaded file.'}
      </div>

      ${notes ? `
        <div>
          <p class="applyr-section-title" style="color:#6B6880;font-size:10.5px;font-weight:700;text-transform:uppercase;letter-spacing:0.08em;margin:0 0 8px;">Key Changes</p>
          <div style="background:white;border:1px solid rgba(120,110,220,0.12);border-radius:12px;padding:14px 16px;font-size:12.5px;color:#3D3A50;max-height:180px;overflow-y:auto;">${escHtml(notes)}</div>
        </div>` : ''}

      ${hasPdf ? `
        <div>
          <a style="display:inline-flex;align-items:center;gap:6px;color:#7C3AED;font-weight:600;font-size:13px;text-decoration:none;" href="${downloadUrl}" download="${shortFileName(company, jobTitle)}" id="applyr-download-link">
            ↓ Download tailored resume PDF
          </a>
        </div>` : ''}
    `);

    setActions(`
      ${hasPdf ? `<button class="applyr-btn applyr-btn-secondary" id="btn-download-manual" style="flex:1;padding:12px;border-radius:12px;border:1px solid rgba(120,110,220,0.15);background:white;color:#3D3A50;font-weight:600;font-size:13px;cursor:pointer;">↓ Download PDF</button>` : ''}
      <button class="applyr-btn applyr-btn-success" id="btn-done-close" style="flex:1;padding:12px;border-radius:12px;border:none;background:linear-gradient(135deg,#059669,#10B981);color:white;font-weight:600;font-size:13px;cursor:pointer;">✓ Done</button>
    `);

    document.getElementById('btn-done-close')?.addEventListener('click', () => {
      closePanel();
      if (entryId) {
        sendMessage('UPDATE_HISTORY', { id: entryId, updates: { status: 'applied' } });
      }
    });
    document.getElementById('btn-download-manual')?.addEventListener('click', () => {
      document.getElementById('applyr-download-link')?.click();
    });
  }

  function injectApplyrButton() {
    if (document.getElementById('applyr-trigger-btn')) return; // already injected

    const target = handler.getButtonInsertionTarget();
    if (!target) {
      // Retry after more time
      setTimeout(injectApplyrButton, 2000);
      return;
    }

    const btn = document.createElement('button');
    btn.id = 'applyr-trigger-btn';
    btn.innerHTML = `
      <svg class="applyr-btn-logo" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
        <rect width="24" height="24" rx="6" fill="white" fill-opacity="0.2"/>
        <path d="M12 4L4 19h4l1.5-4h5L16 19h4L12 4zm0 5l1.8 5H10.2L12 9z" fill="white"/>
      </svg>
      Tailor &amp; Apply
    `;
    btn.title = 'Tailor your resume for this job with Applyr';
    btn.addEventListener('click', (e) => {
      const jobTitle = handler.extractJobTitle();
      const company = handler.extractCompany();
      const jobDescription = handler.extractJobDescription();
      const jobUrl = window.location.href;

      e.stopPropagation();
      e.preventDefault();

      if (handler.PLATFORM === 'linkedin') {
        // LinkedIn: open panel directly on this page (Easy Apply is a modal, not a new tab)
        onApplyrButtonClick();
      } else if (panelState === 'loading' || (panelState === 'preview' && tailoredData)) {
        // Indeed: if tailoring is in progress or done, just re-show the panel
        openPanel();
        if (panelState === 'preview') renderPreview(handler.extractJobTitle(), handler.extractCompany());
      } else {
        // Indeed: save job data, then explicitly trigger Indeed's Apply button
        chrome.storage.local.set({
          pendingTailor: {
            jobTitle,
            company,
            jobDescription,
            jobUrl,
            timestamp: Date.now(),
          }
        });

        // Find and click Indeed's actual Apply button to open the application page
        const indeedApplyBtn = handler.findApplyButton();
        if (indeedApplyBtn) {
          // Try to get the URL first (works for <a> tags and external apply links)
          const applyLink = indeedApplyBtn.closest('a[href]') || indeedApplyBtn.querySelector('a[href]');
          const applyUrl = applyLink?.href || indeedApplyBtn.getAttribute('data-href');
          if (applyUrl) {
            window.open(applyUrl, '_blank');
          } else {
            // Fallback: programmatic click
            indeedApplyBtn.click();
          }
        }
      }
    });

    const wrapper = document.createElement('span');
    wrapper.id = 'applyr-btn-wrapper';
    wrapper.style.cssText = 'display:contents;';
    wrapper.appendChild(btn);

    if (handler.PLATFORM === 'indeed') {
      // Indeed: Apply button is deeply nested inside a flex item.
      // Walk up to find the multi-child flex row and insert as a new flex item.
      let el = target;
      let inserted = false;
      for (let i = 0; i < 12 && el.parentElement; i++) {
        const parent = el.parentElement;
        const style = window.getComputedStyle(parent);
        if ((style.display === 'flex' || style.display === 'inline-flex') && parent.children.length > 2) {
          // Found the buttons row — insert after the Apply button's flex item
          el.insertAdjacentElement('afterend', wrapper);
          inserted = true;
          break;
        }
        el = parent;
      }
      if (!inserted) target.insertAdjacentElement('afterend', wrapper);
    } else {
      // LinkedIn: insert right after the Apply button (flex row is shallow)
      target.insertAdjacentElement('afterend', wrapper);
    }
  }

  // ---------- Panel ----------

  function createOverlay() {
    if (overlayEl) return;

    overlayEl = document.createElement('div');
    overlayEl.id = 'applyr-overlay';
    overlayEl.style.cssText = 'all:initial;position:fixed;inset:0;z-index:2147483640;display:flex;align-items:flex-start;justify-content:flex-end;padding:20px;pointer-events:none;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI","Inter",Roboto,sans-serif;color-scheme:light!important;';

    panelEl = document.createElement('div');
    panelEl.id = 'applyr-panel';
    panelEl.style.cssText = 'all:initial;box-sizing:border-box;background:#F8F7FF!important;color:#1A1523!important;border:1px solid rgba(120,110,220,0.18)!important;border-radius:20px;box-shadow:0 20px 60px rgba(80,60,180,0.18),0 4px 16px rgba(0,0,0,0.08);width:420px;max-height:calc(100vh - 40px);overflow:hidden;display:flex;flex-direction:column;transform:translateX(460px) scale(0.96);opacity:0;transition:transform 0.35s cubic-bezier(0.34,1.56,0.64,1),opacity 0.2s ease;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI","Inter",Roboto,sans-serif;font-size:13.5px;line-height:1.5;-webkit-font-smoothing:antialiased;';
    panelEl.innerHTML = buildPanelSkeleton();

    overlayEl.appendChild(panelEl);
    document.body.appendChild(overlayEl);

    // Close on backdrop click
    overlayEl.addEventListener('click', e => {
      if (e.target === overlayEl) closePanel();
    });
  }

  function buildPanelSkeleton() {
    return `
      <div class="applyr-panel-header" style="background:#FFFFFF!important;color:#1A1523!important;display:flex;align-items:center;gap:11px;padding:18px 20px 14px;border-bottom:1px solid rgba(120,110,220,0.12);flex-shrink:0;">
        <div class="applyr-panel-logo" style="width:30px;height:30px;background:linear-gradient(135deg,#7C3AED,#DB2777);border-radius:8px;display:flex;align-items:center;justify-content:center;color:white!important;font-size:14px;font-weight:800;flex-shrink:0;">A</div>
        <div class="applyr-panel-title-group" style="flex:1;">
          <h2 class="applyr-panel-title" style="font-size:15px;font-weight:700;background:linear-gradient(135deg,#7C3AED,#DB2777);-webkit-background-clip:text;-webkit-text-fill-color:transparent;margin:0;line-height:1.2;">Applyr</h2>
          <p class="applyr-panel-subtitle" style="font-size:11px;color:#9490AD!important;margin:2px 0 0;">AI-powered resume tailoring</p>
        </div>
        <button class="applyr-close-btn" id="applyr-close" title="Close" aria-label="Close Applyr panel" style="background:#F5F4FF!important;color:#9490AD!important;border:1px solid rgba(120,110,220,0.12);border-radius:7px;width:26px;height:26px;display:flex;align-items:center;justify-content:center;cursor:pointer;font-size:14px;line-height:1;">✕</button>
      </div>
      <div class="applyr-panel-body" id="applyr-panel-body" style="background:#F8F7FF!important;color:#1A1523!important;flex:1;overflow-y:auto;padding:16px 18px;display:flex;flex-direction:column;gap:12px;"></div>
      <div class="applyr-actions" id="applyr-actions" style="background:#FFFFFF!important;display:flex;gap:8px;padding:14px 18px;border-top:1px solid rgba(120,110,220,0.12);flex-shrink:0;"></div>
    `;
  }

  function openPanel() {
    if (!overlayEl) createOverlay();
    const closeBtn = document.getElementById('applyr-close');
    if (closeBtn) closeBtn.addEventListener('click', closePanel);
    requestAnimationFrame(() => {
      overlayEl.classList.add('applyr-visible');
      overlayEl.style.pointerEvents = 'auto';
      panelEl.style.transform = 'translateX(0) scale(1)';
      panelEl.style.opacity = '1';
    });
  }

  function closePanel() {
    if (overlayEl) {
      overlayEl.classList.remove('applyr-visible');
      overlayEl.style.pointerEvents = 'none';
      panelEl.style.transform = 'translateX(460px) scale(0.96)';
      panelEl.style.opacity = '0';
    }
  }

  function setBody(html) {
    const body = document.getElementById('applyr-panel-body');
    if (body) body.innerHTML = html;
  }

  function setActions(html) {
    const actions = document.getElementById('applyr-actions');
    if (actions) actions.innerHTML = html;
  }

  // ---------- Workflow ----------

  async function onApplyrButtonClick() {
    // If panel was dismissed during loading/preview, re-show it with current state
    if (panelState === 'loading') {
      openPanel();
      return;
    }
    if (panelState === 'preview' && tailoredData) {
      openPanel();
      renderPreview(handler.extractJobTitle(), handler.extractCompany());
      return;
    }
    openPanel();
    panelState = 'idle';
    await renderIdleState();
  }

  async function renderIdleState() {
    const jobTitle = handler.extractJobTitle();
    const company = handler.extractCompany();

    // Check extension status
    const status = await sendMessage('GET_STATUS');

    setBody(`
      <div>
        <p class="applyr-section-title">Detected Job</p>
        <div class="applyr-job-card">
          <p class="applyr-job-title">${escHtml(jobTitle)}</p>
          ${company ? `<p class="applyr-job-company">${escHtml(company)}</p>` : ''}
        </div>
      </div>
      <div>
        <p class="applyr-section-title">Status</p>
        <div style="display:flex;flex-direction:column;gap:8px;">
          <div class="applyr-status-row">
            <span class="applyr-status-dot ${status.data?.cvLoaded ? 'ready' : 'error'}"></span>
            Resume: ${status.data?.cvLoaded ? 'Loaded ✓' : 'Not uploaded — open the Applyr popup to upload your resume'}
          </div>
          <div class="applyr-status-row">
            <span class="applyr-status-dot ${status.data?.apiConfigured ? 'ready' : 'warn'}"></span>
            AI: ${status.data?.apiConfigured ? 'Configured ✓' : 'Not configured — open Settings to add your API key'}
          </div>
        </div>
      </div>
      ${!status.data?.ready ? `
        <div class="applyr-note-box warning">
          Please upload your resume and configure an AI provider before using Applyr.
          <br><br>
          Click the Applyr icon in your browser toolbar to get started.
        </div>` : ''}
    `);

    if (status.data?.ready) {
      setActions(`
        <button class="applyr-btn applyr-btn-secondary" id="btn-cancel">Cancel</button>
        <button class="applyr-btn applyr-btn-primary" id="btn-tailor">✦ Tailor My Resume</button>
      `);
      document.getElementById('btn-tailor').addEventListener('click', startTailoring);
    } else {
      setActions(`<button class="applyr-btn applyr-btn-secondary" id="btn-cancel">Close</button>`);
    }
    document.getElementById('btn-cancel')?.addEventListener('click', closePanel);
  }

  async function startTailoring() {
    panelState = 'loading';

    setBody(`
      <div class="applyr-progress-container">
        <div class="applyr-spinner"></div>
        <p class="applyr-progress-label">Tailoring your resume…</p>
        <p class="applyr-progress-sub">AI is matching your experience to this job's requirements</p>
      </div>
    `);
    setActions('');

    const jobDescription = handler.extractJobDescription();
    const jobTitle = handler.extractJobTitle();
    const company = handler.extractCompany();

    if (!jobDescription || jobDescription.length < 50) {
      renderError('Could not extract the job description from this page. Please try on the full job posting page.');
      return;
    }

    const result = await sendMessage('TAILOR_CV', { jobDescription, jobTitle, company });

    if (!result.success) {
      renderError(result.error);
      return;
    }

    tailoredData = result.data;
    panelState = 'preview';

    // Generate the PDF
    try {
      if (tailoredData.resumeData) {
        tailoredPdfBlob = ApplyrPdfGenerator.generatePdf(tailoredData.resumeData);
      } else if (tailoredData.rawText) {
        tailoredPdfBlob = ApplyrPdfGenerator.generatePdfFromText(jobTitle, tailoredData.rawText);
      }
    } catch (err) {
      /* PDF generation failed — continue without PDF */
    }

    // Log to history
    entryId = Date.now().toString(36);
    await sendMessage('ADD_HISTORY', {
      id: entryId,
      jobTitle,
      company,
      platform: handler.PLATFORM,
      status: 'tailored',
      url: window.location.href,
    });

    renderPreview(jobTitle, company);
  }

  function renderPreview(jobTitle, company) {
    const notes = tailoredData.tailoringNotes || '';
    const hasPdf = !!tailoredPdfBlob;
    const downloadUrl = hasPdf ? URL.createObjectURL(tailoredPdfBlob) : null;

    setBody(`
      <div>
        <p class="applyr-section-title">Tailored For</p>
        <div class="applyr-job-card">
          <p class="applyr-job-title">${escHtml(jobTitle)}</p>
          ${company ? `<p class="applyr-job-company">${escHtml(company)}</p>` : ''}
        </div>
      </div>

      <div class="applyr-note-box success">
        ✓ Resume successfully tailored! Review the changes below before applying.
      </div>

      ${notes ? `
        <div>
          <p class="applyr-section-title">Key Changes Made</p>
          <div class="applyr-diff-box">${escHtml(notes)}</div>
        </div>` : ''}

      ${hasPdf ? `
        <div>
          <a class="applyr-download-link" href="${downloadUrl}" download="${shortFileName(company, jobTitle)}" id="applyr-download-link">
            ↓ Download tailored resume PDF
          </a>
        </div>` : ''}

      <div class="applyr-note-box" style="line-height:1.6;">
        ${handler.PLATFORM === 'linkedin'
          ? 'Click <strong>"Download & Apply"</strong> to save your tailored resume, then click LinkedIn\'s <strong>"Easy Apply"</strong> button and upload it.'
          : 'The application form is open in another tab. Click <strong>"Download & Apply"</strong> to save your tailored resume, then switch tabs to upload it.'}
      </div>
    `);

    setActions(`
      <button class="applyr-btn applyr-btn-secondary" id="btn-retailor">↺ Re-tailor</button>
      <button class="applyr-btn applyr-btn-success" id="btn-apply">↓ Download & Apply</button>
    `);

    document.getElementById('btn-retailor')?.addEventListener('click', startTailoring);
    document.getElementById('btn-apply')?.addEventListener('click', () => startApply(jobTitle, company));
  }

  async function startApply(jobTitle, company) {
    panelState = 'applying';

    try {
      // Auto-download the tailored PDF
      if (tailoredPdfBlob) {
        const fileName = shortFileName(company, jobTitle);
        const url = URL.createObjectURL(tailoredPdfBlob);
        const a = document.createElement('a');
        a.href = url;
        a.download = fileName;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        setTimeout(() => URL.revokeObjectURL(url), 5000);
      }

      panelState = 'done';

      if (handler.PLATFORM === 'linkedin') {
        // LinkedIn: close panel so user can click Easy Apply
        closePanel();

        // Highlight LinkedIn's Easy Apply button
        const easyApplyBtn = handler.findApplyButton();
        if (easyApplyBtn) {
          const style = document.createElement('style');
          style.id = 'applyr-highlight-style';
          style.textContent = `
            @keyframes applyr-glow {
              0%, 100% { box-shadow: 0 0 8px 3px rgba(124,58,237,0.5); }
              50% { box-shadow: 0 0 20px 8px rgba(124,58,237,0.7); }
            }
            .applyr-highlighted { animation: applyr-glow 1.2s ease infinite !important; }
          `;
          document.head.appendChild(style);
          easyApplyBtn.classList.add('applyr-highlighted');

          // Add fixed-position tooltip above the Easy Apply button
          const tooltip = document.createElement('div');
          tooltip.id = 'applyr-apply-tooltip';
          const isEasyApply = /easy apply/i.test(easyApplyBtn.innerText || easyApplyBtn.getAttribute('aria-label') || '');
          tooltip.innerHTML = isEasyApply
            ? '↑ Click <strong>Easy Apply</strong> and upload your tailored resume'
            : '↑ Click <strong>Apply</strong> and upload your tailored resume';
          const btnRect = easyApplyBtn.getBoundingClientRect();
          tooltip.style.cssText = `position:fixed;top:${btnRect.top - 48}px;left:${btnRect.left + btnRect.width/2}px;transform:translateX(-50%);background:linear-gradient(135deg,#7C3AED,#DB2777);color:white;padding:8px 14px;border-radius:10px;font-size:12px;font-weight:600;white-space:nowrap;z-index:2147483646;box-shadow:0 4px 16px rgba(124,58,237,0.4);font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;pointer-events:none;`;
          const arrow = document.createElement('div');
          arrow.style.cssText = 'position:absolute;top:100%;left:50%;transform:translateX(-50%);width:0;height:0;border-left:7px solid transparent;border-right:7px solid transparent;border-top:7px solid #DB2777;';
          tooltip.appendChild(arrow);
          document.body.appendChild(tooltip);

          const cleanup = () => {
            easyApplyBtn.classList.remove('applyr-highlighted');
            const t = document.getElementById('applyr-apply-tooltip');
            if (t) t.remove();
            const s = document.getElementById('applyr-highlight-style');
            if (s) s.remove();
          };
          // Defer listener so the current click event doesn't immediately dismiss
          setTimeout(() => {
            document.addEventListener('click', cleanup, { once: true });
          }, 100);
          setTimeout(cleanup, 15000);
        }
      } else {
        // Indeed: show done message (apply tab already open)
        setBody(`
          <div class="applyr-note-box success" style="line-height:1.7;">
            <strong>Your tailored resume has been downloaded!</strong><br><br>
            The application page was opened in another tab when you clicked "Tailor & Apply".<br><br>
            Switch to that tab and upload your tailored resume.
          </div>
        `);
        setActions(`
          <button class="applyr-btn applyr-btn-secondary" id="btn-done-close">Done</button>
        `);
        document.getElementById('btn-done-close')?.addEventListener('click', closePanel);
      }

      // Update history (async — fine to do after UI actions)
      if (entryId) {
        await sendMessage('UPDATE_HISTORY', { id: entryId, updates: { status: 'applied' } });
      }

    } catch (err) {
      renderError(err.message);
    }
  }

  function renderError(message) {
    panelState = 'error';
    setBody(`
      <div class="applyr-note-box error">
        <strong>Something went wrong</strong><br><br>
        ${escHtml(message)}
      </div>
    `);
    setActions(`
      <button class="applyr-btn applyr-btn-secondary" id="btn-retry">↺ Try Again</button>
      <button class="applyr-btn applyr-btn-secondary" id="btn-close-err">Close</button>
    `);
    document.getElementById('btn-retry')?.addEventListener('click', startTailoring);
    document.getElementById('btn-close-err')?.addEventListener('click', closePanel);
  }

  // ---------- Messaging ----------

  function sendMessage(action, payload = {}) {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage({ action, payload }, (response) => {
        if (chrome.runtime.lastError) {
          resolve({ success: false, error: chrome.runtime.lastError.message });
        } else {
          resolve(response || { success: false, error: 'No response' });
        }
      });
    });
  }

  // ---------- Utilities ----------

  function escHtml(str) {
    if (!str) return '';
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;')
      .replace(/\n/g, '<br>');
  }

  // ---------- SPA navigation support ----------
  // Indeed and LinkedIn are SPAs; re-init on URL changes.

  let lastUrl = window.location.href;

  const observer = new MutationObserver(() => {
    if (window.location.href !== lastUrl) {
      lastUrl = window.location.href;
      // Remove old button and wrapper if present
      const oldWrapper = document.getElementById('applyr-btn-wrapper');
      if (oldWrapper) oldWrapper.remove();
      const oldBtn = document.getElementById('applyr-trigger-btn');
      if (oldBtn) oldBtn.remove();
      // Remove any leftover highlights
      const oldTooltip = document.getElementById('applyr-apply-tooltip');
      if (oldTooltip) oldTooltip.remove();
      const oldStyle = document.getElementById('applyr-highlight-style');
      if (oldStyle) oldStyle.remove();
      // Re-detect and inject
      setTimeout(init, 1500);
    }
  });

  observer.observe(document.body, { childList: true, subtree: true });

  // ---------- Boot ----------

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
