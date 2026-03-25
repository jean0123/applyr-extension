/**
 * Applyr – CV Tailoring Logic
 * Builds prompts, calls the AI, and parses structured JSON responses.
 * Loaded by background.js via importScripts.
 */

(function () {
  'use strict';

  const SYSTEM_PROMPT = `You are an expert resume writer and career coach specializing in ATS optimization.

Your task: Given a candidate's base resume and a specific job description, rewrite the resume to maximize relevance for that exact position.

Rules:
1. NEVER fabricate or exaggerate experience, skills, or accomplishments. Only use information present in the original resume.
2. DO reorder sections and bullet points to highlight the most relevant experience first.
3. DO adjust the professional summary to speak directly to the job requirements.
4. DO incorporate keywords and phrases from the job description naturally (for ATS matching).
5. DO strengthen action verbs and quantify achievements where possible (using data already in the resume).
6. DO adjust job titles only if the candidate's actual title is a close variant (e.g., "Software Dev" → "Software Developer").
7. Keep the resume to 1–2 pages of content.

Output Format:
Return a JSON object ONLY — no markdown, no code fences, no explanation. Use this exact schema:

{
  "name": "Full Name",
  "email": "email@example.com",
  "phone": "Phone number",
  "location": "City, Province/State",
  "linkedin": "LinkedIn URL or handle",
  "summary": "Tailored professional summary paragraph",
  "experience": [
    {
      "title": "Job Title",
      "company": "Company Name",
      "location": "City, Province",
      "startDate": "Jan 2020",
      "endDate": "Mar 2023",
      "bullets": [
        "Achievement or responsibility bullet point",
        "Second bullet point"
      ]
    }
  ],
  "education": [
    {
      "degree": "Bachelor of Science in Computer Science",
      "school": "University Name",
      "location": "City, Province",
      "startDate": "Sep 2014",
      "endDate": "Apr 2018",
      "notes": "Relevant coursework, honours, GPA if notable"
    }
  ],
  "skills": ["Skill 1", "Skill 2", "Skill 3"],
  "certifications": [
    { "name": "Certification Name", "issuer": "Issuing Body", "year": "2022" }
  ],
  "tailoring_notes": "Brief explanation of key changes made and why"
}

If a field is not present in the original resume, omit it or use an empty string. Always output valid JSON.`;

  /**
   * Build the user message combining resume text and job description.
   */
  function buildUserMessage(resumeText, jobDescription, jobTitle, company) {
    return `JOB TITLE: ${jobTitle || 'Not specified'}
COMPANY: ${company || 'Not specified'}

JOB DESCRIPTION:
${jobDescription}

---

CANDIDATE'S CURRENT RESUME:
${resumeText}

---

Please tailor this resume for the job description above. Return only the JSON object.`;
  }

  /**
   * Extract JSON from AI response, handling cases where the AI adds extra text.
   */
  function extractJson(text) {
    // Try direct parse first
    try {
      return JSON.parse(text.trim());
    } catch {}

    // Try to extract JSON block
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      try {
        return JSON.parse(jsonMatch[0]);
      } catch {}
    }

    // Try to find JSON after a code fence
    const fenceMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (fenceMatch) {
      try {
        return JSON.parse(fenceMatch[1].trim());
      } catch {}
    }

    return null;
  }

  /**
   * Main tailoring function.
   * @returns {{ resumeData: Object, tailoringNotes: string, rawText: string }}
   */
  async function tailorCv({ resumeText, jobDescription, jobTitle, company, provider, apiKey }) {
    if (!resumeText) throw new Error('No resume text found. Please upload your CV in the extension popup.');
    if (!jobDescription) throw new Error('No job description provided.');
    if (!provider) throw new Error('No AI provider configured. Please set up your API key in Settings.');
    if (!apiKey) throw new Error('No API key found. Please add your API key in Settings.');

    const userMessage = buildUserMessage(resumeText, jobDescription, jobTitle, company);

    let rawResponse;
    try {
      rawResponse = await ApplyrAiProviders.callAI(provider, apiKey, SYSTEM_PROMPT, userMessage);
    } catch (err) {
      throw new Error(`AI provider error: ${err.message}`);
    }

    const parsed = extractJson(rawResponse);

    if (!parsed) {
      // Return a fallback object using the raw text so the PDF can still be generated
      return {
        resumeData: null,
        tailoringNotes: 'AI returned plain text instead of structured JSON.',
        rawText: rawResponse,
      };
    }

    const tailoringNotes = parsed.tailoring_notes || '';
    delete parsed.tailoring_notes;

    return {
      resumeData: parsed,
      tailoringNotes,
      rawText: rawResponse,
    };
  }

  /**
   * Generate a simple diff summary between original and tailored text.
   */
  function generateDiffSummary(originalText, tailoredData) {
    const changes = [];

    if (tailoredData.summary) {
      changes.push('• Professional summary updated to match job requirements');
    }

    if (tailoredData.experience) {
      changes.push(`• Experience section reorganized (${tailoredData.experience.length} roles)`);
    }

    if (tailoredData.skills) {
      changes.push(`• Skills section updated with ${tailoredData.skills.length} relevant skills`);
    }

    return changes.join('\n');
  }

  // Public API
  const ApplyrCvTailor = {
    tailorCv,
    generateDiffSummary,
    buildUserMessage,
  };

  if (typeof globalThis !== 'undefined') {
    globalThis.ApplyrCvTailor = ApplyrCvTailor;
  }
})();
