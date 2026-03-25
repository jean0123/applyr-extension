# Privacy Policy for Applyr Chrome Extension

**Effective Date:** March 25, 2026
**Last Updated:** March 25, 2026
**Developer:** Jean Rojas (Individual Developer)
**Contact:** jean93pierre06@gmail.com

---

## 1. Introduction

This Privacy Policy describes how Applyr ("the Extension," "we," "our") handles information when you use the Applyr Chrome Extension. Applyr is a resume tailoring tool that uses AI to customize resumes for job applications on Indeed and LinkedIn.

We are committed to protecting your privacy. Applyr is designed with a local-first architecture, meaning your data is stored on your device and is not collected, transmitted to, or stored on any servers operated by us.

## 2. Information We Collect

### 2.1 Information You Provide

- **Resume content:** The text of the resume you provide for tailoring.
- **API keys:** The API key you provide for your chosen AI provider (Anthropic Claude, OpenAI ChatGPT, or Google Gemini).
- **Application history:** Records of jobs you apply to and the tailored resumes generated, stored locally for your reference.

### 2.2 Information We Do Not Collect

- We do not collect personal identification information beyond what you provide in your resume.
- We do not collect browsing history, cookies, or tracking data.
- We do not use analytics, telemetry, or any third-party tracking services.
- We do not collect financial or payment information.

## 3. How Your Information Is Stored

All data is stored **locally on your device** using the Chrome `chrome.storage.local` API. No data is transmitted to or stored on any servers owned or operated by us.

### 3.1 API Key Encryption

Your AI provider API keys are encrypted using **AES-256-GCM** encryption before being stored in `chrome.storage.local`. Keys are decrypted only at the moment they are needed to make an API request to your chosen provider and are never stored in plaintext.

### 3.2 Resume and Application Data

Your resume content, tailored resume outputs, and application history records are stored in `chrome.storage.local` on your device. This data does not leave your browser except when sent to your chosen AI provider for resume tailoring (see Section 4).

## 4. How Your Information Is Used

Your information is used solely to provide the core functionality of the Extension:

- **Resume text and job descriptions** are sent to your chosen AI provider (Anthropic, OpenAI, or Google) via their respective APIs to generate tailored resumes. This is the only external data transmission performed by the Extension.
- **API keys** are used exclusively to authenticate requests to your chosen AI provider.
- **Application history** is stored locally to allow you to review past applications and tailored resumes.

We do not use your data for advertising, profiling, marketing, or any purpose other than providing the Extension's core resume tailoring functionality.

## 5. Third-Party Services

The Extension communicates with the following third-party AI providers, depending on your selection:

- **Anthropic** (Claude API) -- governed by [Anthropic's Privacy Policy](https://www.anthropic.com/privacy)
- **OpenAI** (ChatGPT API) -- governed by [OpenAI's Privacy Policy](https://openai.com/privacy)
- **Google** (Gemini API) -- governed by [Google's Privacy Policy](https://policies.google.com/privacy)

When you use the Extension, your resume text and the relevant job description are sent to the AI provider you have selected. We encourage you to review the privacy policies of these providers to understand how they handle data sent through their APIs.

No other third-party services receive your data. We do not use third-party analytics, advertising networks, or data brokers.

## 6. Data Sharing and Disclosure

We do not sell, rent, trade, or otherwise share your personal information with any third parties. Your data is sent only to your chosen AI provider as described in Section 4.

We may disclose information only if required to do so by law or in response to a valid legal process.

## 7. Data Retention

All data is stored locally on your device and persists until you take one of the following actions:

- Manually delete data through the Extension's settings or interface.
- Clear your browser's extension storage.
- Uninstall the Extension, which removes all associated `chrome.storage.local` data.

We do not retain any of your data on external servers, so there is no server-side data to delete.

## 8. User Rights

You have full control over your data at all times:

- **Access:** You can view all stored data through the Extension's interface.
- **Deletion:** You can delete your resume, API keys, application history, and all other stored data through the Extension's settings at any time.
- **Portability:** You can export your application history and tailored resumes as PDF files.
- **Revocation:** You can revoke AI provider access at any time by removing your API key from the Extension.

Because all data is stored locally on your device, you maintain direct and complete control without needing to submit requests to us.

## 9. Data Security

We take the security of your data seriously:

- API keys are encrypted with **AES-256-GCM** before storage.
- All communication with AI providers occurs over **HTTPS/TLS** encrypted connections.
- All data is stored locally in your browser using Chrome's `chrome.storage.local` API, which is sandboxed from other extensions and websites.
- No data is transmitted to any servers operated by us.

## 10. Children's Privacy (COPPA Compliance)

Applyr is not directed at children under the age of 13. We do not knowingly collect personal information from children under 13. If you are a parent or guardian and believe your child has provided personal information through the Extension, please contact us at jean93pierre06@gmail.com, and we will assist you in removing that information.

## 11. Changes to This Privacy Policy

We may update this Privacy Policy from time to time. Any changes will be reflected by updating the "Last Updated" date at the top of this document. Continued use of the Extension after changes are posted constitutes acceptance of the updated policy. We encourage you to review this Privacy Policy periodically.

## 12. California Privacy Rights (CCPA)

If you are a California resident, you have the right to know what personal information is collected, request deletion of your personal information, and opt out of the sale of your personal information. As described above, all data is stored locally on your device, we do not collect data on our servers, and we do not sell personal information.

## 13. European Privacy Rights (GDPR)

If you are located in the European Economic Area, you have rights under the General Data Protection Regulation including the right to access, rectify, delete, and port your data. Because Applyr stores all data locally on your device and does not transmit data to our servers, you exercise these rights directly through the Extension's interface and your browser settings.

## 14. Contact Information

If you have any questions, concerns, or requests regarding this Privacy Policy or the Extension's data practices, please contact:

**Jean Rojas**
Email: jean93pierre06@gmail.com

---

*This Privacy Policy is effective as of March 25, 2026.*
