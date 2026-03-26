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
1. NEVER fabricate experience or accomplishments. You MAY reword, rephrase, and emphasize existing experience to better match the job description. Use information present in the original resume but feel free to present it in the most relevant light.
2. NEVER REMOVE any work experience entries. ALL jobs from the original resume MUST appear in the output. Removing jobs creates employment gaps that recruiters view negatively. You CAN and SHOULD reword bullet points, emphasize transferable skills, and adjust the tone to match the target role. For less relevant jobs, reduce to 2-3 tailored bullet points.
3. DO reorder and rewrite bullet points within each job to highlight the most relevant experience first.
4. DO adjust the professional summary to speak directly to the job requirements.
5. DO incorporate keywords and phrases from the job description naturally (for ATS matching).
6. DO strengthen action verbs and quantify achievements where possible (using data already in the resume).
7. DO adjust job titles only if the candidate's actual title is a close variant (e.g., "Software Dev" → "Software Developer").
8. Keep the resume to 2-3 pages of content. Do NOT sacrifice completeness for brevity.
9. DO preserve the chronological order of work experience (most recent first).
10. DO NOT use special characters, symbols, or unicode bullets in text. Use plain text only.
11. If the original resume has a Key Achievements section, preserve it. Tailor the achievements to be relevant to the target job.
12. Group skills by category when the original resume uses categories (e.g., "Cloud Platforms:", "Networking:", "Cybersecurity:").

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
  "skills": ["Category: Skill 1, Skill 2, Skill 3", "Category: Skill 4, Skill 5"],
  "certifications": [
    { "name": "Certification Name", "issuer": "Issuing Body", "year": "2022" }
  ],
  "achievements": [
    "Key achievement with quantified impact"
  ],
  "tailoring_notes": "Brief explanation of key changes made and why"
}

CRITICAL: The number of entries in the "experience" array MUST equal the number of jobs in the original resume. Do not drop any.

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
