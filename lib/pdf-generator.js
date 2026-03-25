/**
 * Applyr – PDF Generator
 * Generates a professional resume PDF from structured JSON using pure JavaScript.
 * No external dependencies required.
 * Exposes a global `ApplyrPdfGenerator` object.
 */

(function () {
  'use strict';

  // ---------- PDF low-level primitives ----------

  class PdfWriter {
    constructor() {
      this.objects = [];
      this.offsets = [];
      this._nextId = 1;
    }

    addObject(content) {
      const id = this._nextId++;
      this.objects.push({ id, content });
      return id;
    }

    // Escape a string for PDF content stream
    static escapeString(str) {
      return str
        .replace(/\\/g, '\\\\')
        .replace(/\(/g, '\\(')
        .replace(/\)/g, '\\)')
        .replace(/[\r\n]/g, ' ');
    }

    // Encode to PDF Latin-1 friendly (replace common Unicode)
    static latinize(str) {
      return str
        .replace(/[\u2013\u2014]/g, '-')
        .replace(/[\u2018\u2019]/g, "'")
        .replace(/[\u201C\u201D]/g, '"')
        .replace(/\u2022/g, '*')
        .replace(/\u00A0/g, ' ')
        .replace(/[^\x20-\x7E]/g, '?');
    }

    serialize() {
      const lines = [];
      lines.push('%PDF-1.4');
      lines.push('%\xE2\xE3\xCF\xD3'); // binary comment to indicate binary content

      // Write objects and track byte offsets
      this.offsets = [];
      let byteCount = lines.join('\n').length + 1; // +1 for final newline

      for (const obj of this.objects) {
        this.offsets.push(byteCount);
        const objStr = `${obj.id} 0 obj\n${obj.content}\nendobj\n`;
        lines.push(objStr);
        byteCount += objStr.length + 1;
      }

      // Cross-reference table
      const xrefOffset = byteCount;
      lines.push('xref');
      lines.push(`0 ${this.objects.length + 1}`);
      lines.push('0000000000 65535 f \r');
      for (const offset of this.offsets) {
        lines.push(offset.toString().padStart(10, '0') + ' 00000 n \r');
      }

      lines.push('trailer');
      lines.push(`<< /Size ${this.objects.length + 1} /Root 1 0 R >>`);
      lines.push('startxref');
      lines.push(xrefOffset.toString());
      lines.push('%%EOF');

      return lines.join('\n');
    }
  }

  // ---------- Resume layout constants ----------

  const PAGE_W = 612;  // Letter width in points
  const PAGE_H = 792;  // Letter height in points
  const MARGIN_L = 54;
  const MARGIN_R = 54;
  const MARGIN_T = 54;
  const MARGIN_B = 54;
  const CONTENT_W = PAGE_W - MARGIN_L - MARGIN_R;

  const COLORS = {
    primary: [0.31, 0.27, 0.9],   // #4F46E5 indigo
    text: [0.1, 0.1, 0.1],        // near black
    muted: [0.45, 0.45, 0.45],    // gray
    line: [0.8, 0.8, 0.8],        // light gray for rules
  };

  // ---------- Text layout helpers ----------

  /**
   * Rough character-width estimate for Helvetica at 1pt.
   * A proper implementation would use AFM metrics; this is a good approximation.
   */
  function estimateTextWidth(text, fontSize) {
    // Average character width in Helvetica ≈ 0.55 × fontSize
    return text.length * 0.55 * fontSize;
  }

  /**
   * Word-wrap text into lines fitting within maxWidth at given fontSize.
   */
  function wrapText(text, fontSize, maxWidth) {
    const words = text.split(/\s+/).filter(Boolean);
    const lines = [];
    let current = '';

    for (const word of words) {
      const candidate = current ? `${current} ${word}` : word;
      if (estimateTextWidth(candidate, fontSize) <= maxWidth) {
        current = candidate;
      } else {
        if (current) lines.push(current);
        current = word;
      }
    }
    if (current) lines.push(current);
    return lines;
  }

  // ---------- PDF content stream builder ----------

  class ContentStream {
    constructor() {
      this.ops = [];
      this.y = PAGE_H - MARGIN_T;
      this.pages = []; // Each page: array of ops
      this._currentPage = [];
    }

    _op(str) {
      this._currentPage.push(str);
    }

    newPage() {
      this.pages.push(this._currentPage);
      this._currentPage = [];
      this.y = PAGE_H - MARGIN_T;
    }

    // Ensure we have enough vertical space; start new page if needed
    ensureSpace(needed) {
      if (this.y - needed < MARGIN_B) {
        this.newPage();
      }
    }

    setColor(rgb, isStroke = false) {
      const [r, g, b] = rgb;
      this._op(`${r} ${g} ${b} ${isStroke ? 'RG' : 'rg'}`);
    }

    drawLine(x1, y1, x2, y2, width = 0.5) {
      this._op(`${width} w`);
      this._op(`${x1} ${y1} m ${x2} ${y2} l S`);
    }

    text(str, x, y, fontSize, fontRef = 'F1') {
      const safe = PdfWriter.latinize(PdfWriter.escapeString(str));
      this._op(`BT /${fontRef} ${fontSize} Tf ${x} ${y} Td (${safe}) Tj ET`);
    }

    // Return all page content strings
    finalize() {
      this.pages.push(this._currentPage);
      return this.pages.map(p => p.join('\n'));
    }
  }

  // ---------- Resume renderer ----------

  function renderResume(data) {
    const cs = new ContentStream();

    function y() { return cs.y; }
    function addY(delta) { cs.y += delta; } // negative = move down

    // --- Header: Name ---
    cs.setColor(COLORS.primary);
    cs.text(data.name || 'Your Name', MARGIN_L, y(), 22, 'F2');
    addY(-28);

    // --- Contact line ---
    const contactParts = [data.email, data.phone, data.location, data.linkedin].filter(Boolean);
    if (contactParts.length > 0) {
      cs.setColor(COLORS.muted);
      cs.text(contactParts.join('  |  '), MARGIN_L, y(), 9, 'F1');
      addY(-6);
    }

    // Separator line
    cs.setColor(COLORS.primary, true);
    cs.drawLine(MARGIN_L, y(), PAGE_W - MARGIN_R, y(), 1);
    addY(-14);

    // --- Summary ---
    if (data.summary) {
      renderSection(cs, 'PROFESSIONAL SUMMARY');
      renderParagraph(cs, data.summary, 10);
      addY(-10);
    }

    // --- Experience ---
    if (data.experience && data.experience.length > 0) {
      renderSection(cs, 'WORK EXPERIENCE');
      for (const job of data.experience) {
        cs.ensureSpace(40);
        cs.setColor(COLORS.text);
        cs.text(job.title || '', MARGIN_L, y(), 11, 'F2');

        // Company + dates on same line (right-aligned approx)
        const meta = [job.company, job.location].filter(Boolean).join(', ');
        const dateStr = [job.startDate, job.endDate].filter(Boolean).join(' – ');

        if (meta) {
          cs.setColor(COLORS.muted);
          cs.text(meta, MARGIN_L, y() - 14, 9.5, 'F1');
        }
        if (dateStr) {
          cs.setColor(COLORS.muted);
          cs.text(dateStr, PAGE_W - MARGIN_R - estimateTextWidth(dateStr, 9.5), y() - 14, 9.5, 'F1');
        }
        addY(-16);
        if (meta) addY(-13);

        // Bullet points
        if (job.bullets && job.bullets.length > 0) {
          for (const bullet of job.bullets) {
            cs.ensureSpace(24);
            const lines = wrapText(`\u2022  ${bullet}`, 10, CONTENT_W - 14);
            for (const line of lines) {
              cs.setColor(COLORS.text);
              cs.text(line, MARGIN_L + 8, y(), 10, 'F1');
              addY(-13);
            }
          }
        } else if (job.description) {
          const lines = wrapText(job.description, 10, CONTENT_W);
          for (const line of lines) {
            cs.setColor(COLORS.text);
            cs.text(line, MARGIN_L, y(), 10, 'F1');
            addY(-13);
          }
        }
        addY(-6);
      }
      addY(-4);
    }

    // --- Education ---
    if (data.education && data.education.length > 0) {
      renderSection(cs, 'EDUCATION');
      for (const edu of data.education) {
        cs.ensureSpace(30);
        cs.setColor(COLORS.text);
        cs.text(edu.degree || '', MARGIN_L, y(), 11, 'F2');
        const dateStr = [edu.startDate, edu.endDate].filter(Boolean).join(' – ');
        if (dateStr) {
          cs.setColor(COLORS.muted);
          cs.text(dateStr, PAGE_W - MARGIN_R - estimateTextWidth(dateStr, 9.5), y(), 9.5, 'F1');
        }
        addY(-13);
        cs.setColor(COLORS.muted);
        const schoolLine = [edu.school, edu.location].filter(Boolean).join(', ');
        if (schoolLine) {
          cs.text(schoolLine, MARGIN_L, y(), 10, 'F1');
          addY(-13);
        }
        if (edu.notes) {
          cs.setColor(COLORS.muted);
          cs.text(edu.notes, MARGIN_L, y(), 9.5, 'F1');
          addY(-13);
        }
        addY(-6);
      }
      addY(-4);
    }

    // --- Skills ---
    if (data.skills && data.skills.length > 0) {
      renderSection(cs, 'SKILLS');
      const skillText = Array.isArray(data.skills)
        ? data.skills.join('   ·   ')
        : data.skills;
      const skillLines = wrapText(skillText, 10, CONTENT_W);
      for (const line of skillLines) {
        cs.ensureSpace(14);
        cs.setColor(COLORS.text);
        cs.text(line, MARGIN_L, y(), 10, 'F1');
        addY(-13);
      }
      addY(-4);
    }

    // --- Certifications ---
    if (data.certifications && data.certifications.length > 0) {
      renderSection(cs, 'CERTIFICATIONS');
      for (const cert of data.certifications) {
        cs.ensureSpace(14);
        const certLine = typeof cert === 'string' ? cert : `${cert.name}${cert.issuer ? ' – ' + cert.issuer : ''}${cert.year ? ' (' + cert.year + ')' : ''}`;
        cs.setColor(COLORS.text);
        cs.text(`\u2022  ${certLine}`, MARGIN_L + 8, y(), 10, 'F1');
        addY(-13);
      }
      addY(-4);
    }

    return cs.finalize();

    function renderSection(stream, title) {
      stream.ensureSpace(30);
      stream.setColor(COLORS.primary);
      stream.text(title, MARGIN_L, y(), 9.5, 'F2');
      addY(-4);
      stream.setColor(COLORS.primary, true);
      stream.drawLine(MARGIN_L, y(), PAGE_W - MARGIN_R, y(), 0.6);
      addY(-12);
    }

    function renderParagraph(stream, text, fontSize) {
      const lines = wrapText(text, fontSize, CONTENT_W);
      for (const line of lines) {
        stream.ensureSpace(fontSize + 4);
        stream.setColor(COLORS.text);
        stream.text(line, MARGIN_L, y(), fontSize, 'F1');
        addY(-(fontSize + 3));
      }
    }
  }

  // ---------- Main generate function ----------

  /**
   * Generate a PDF Blob from a structured resume data object.
   * @param {Object} resumeData - Structured resume JSON (see schema below)
   * @returns {Blob} PDF file as a Blob
   */
  function generatePdf(resumeData) {
    const writer = new PdfWriter();

    const pageContents = renderResume(resumeData);
    const numPages = pageContents.length;

    // Reserve object slots:
    // 1: Catalog, 2: Pages, 3..N+2: Page objects, N+3..2N+2: Content streams
    // Fonts: 2N+3 (Helvetica), 2N+4 (Helvetica-Bold)

    const pageObjectIds = [];
    const contentObjectIds = [];

    // Pre-assign IDs
    const catalogId = writer._nextId++;
    const pagesId = writer._nextId++;

    for (let i = 0; i < numPages; i++) {
      pageObjectIds.push(writer._nextId++);
      contentObjectIds.push(writer._nextId++);
    }

    const fontRegId = writer._nextId++;
    const fontBoldId = writer._nextId++;

    // Reset and write in order
    writer._nextId = 1;
    writer.objects = [];

    // Catalog (id=1)
    writer.addObject(`<< /Type /Catalog /Pages ${pagesId} 0 R >>`);

    // Pages dict (id=2)
    const kidsStr = pageObjectIds.map(id => `${id} 0 R`).join(' ');
    writer.addObject(`<< /Type /Pages /Kids [${kidsStr}] /Count ${numPages} >>`);

    // Page & Content objects
    const fontRef = `<< /F1 ${fontRegId} 0 R /F2 ${fontBoldId} 0 R >>`;
    for (let i = 0; i < numPages; i++) {
      // Page object
      writer.addObject(
        `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_W} ${PAGE_H}] ` +
        `/Contents ${contentObjectIds[i]} 0 R /Resources << /Font ${fontRef} >> >>`
      );
      // Content stream
      const streamContent = pageContents[i];
      writer.addObject(
        `<< /Length ${streamContent.length} >>\nstream\n${streamContent}\nendstream`
      );
    }

    // Fonts
    writer.addObject(
      '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>'
    );
    writer.addObject(
      '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>'
    );

    const pdfText = writer.serialize();

    // Return as Blob
    return new Blob([pdfText], { type: 'application/pdf' });
  }

  /**
   * Generate a PDF Blob from plain-text resume (AI output when JSON parse fails).
   */
  function generatePdfFromText(name, text) {
    const lines = text.split('\n');
    const data = {
      name: name || 'Resume',
      summary: '',
      experience: [],
      education: [],
      skills: [],
    };

    // Simple heuristic parsing of plain text
    let currentSection = null;
    let currentJob = null;

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;

      const upper = trimmed.toUpperCase();
      if (upper.includes('EXPERIENCE') || upper.includes('EMPLOYMENT')) {
        currentSection = 'experience';
      } else if (upper.includes('EDUCATION')) {
        currentSection = 'education';
      } else if (upper.includes('SKILL')) {
        currentSection = 'skills';
      } else if (upper.includes('SUMMARY') || upper.includes('PROFILE') || upper.includes('OBJECTIVE')) {
        currentSection = 'summary';
      } else {
        if (currentSection === 'summary') {
          data.summary += (data.summary ? ' ' : '') + trimmed;
        } else if (currentSection === 'skills') {
          data.skills.push(trimmed);
        } else if (currentSection === 'experience') {
          if (!currentJob) {
            currentJob = { title: trimmed, bullets: [] };
            data.experience.push(currentJob);
          } else if (trimmed.startsWith('-') || trimmed.startsWith('•') || trimmed.startsWith('*')) {
            currentJob.bullets.push(trimmed.replace(/^[-•*]\s*/, ''));
          } else {
            currentJob = { title: trimmed, bullets: [] };
            data.experience.push(currentJob);
          }
        } else if (currentSection === 'education') {
          data.education.push({ degree: trimmed });
        }
      }
    }

    return generatePdf(data);
  }

  /**
   * Create a File object from a Blob for use in file upload inputs.
   */
  function pdfBlobToFile(blob, filename = 'resume_tailored.pdf') {
    return new File([blob], filename, { type: 'application/pdf' });
  }

  // ---------- Schema reference ----------
  /**
   * Expected resume data schema:
   * {
   *   name: string,
   *   email: string,
   *   phone: string,
   *   location: string,
   *   linkedin: string,
   *   summary: string,
   *   experience: [
   *     {
   *       title: string,
   *       company: string,
   *       location: string,
   *       startDate: string,
   *       endDate: string,
   *       bullets: string[],
   *       description: string
   *     }
   *   ],
   *   education: [
   *     {
   *       degree: string,
   *       school: string,
   *       location: string,
   *       startDate: string,
   *       endDate: string,
   *       notes: string
   *     }
   *   ],
   *   skills: string[],
   *   certifications: [string | { name, issuer, year }]
   * }
   */

  const ApplyrPdfGenerator = {
    generatePdf,
    generatePdfFromText,
    pdfBlobToFile,
  };

  if (typeof window !== 'undefined') {
    window.ApplyrPdfGenerator = ApplyrPdfGenerator;
  }
  if (typeof globalThis !== 'undefined') {
    globalThis.ApplyrPdfGenerator = ApplyrPdfGenerator;
  }
})();
