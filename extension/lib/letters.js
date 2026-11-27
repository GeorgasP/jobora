/*
 * Cover letters. With the user's own Anthropic key, Claude writes each one
 * from the CV and the job description; without one, a formal template does,
 * in the language chosen for letters. The key stays in the user's
 * chrome.storage and is only ever sent to api.anthropic.com.
 */

const CLAUDE_URL = "https://api.anthropic.com/v1/messages";
const CLAUDE_MODEL = "claude-haiku-4-5-20251001";
const MAX_LETTER_TOKENS = 1200;          // a 320-word letter needs about 500
// How much of each source goes into the request, in characters.
const DESCRIPTION_LIMIT = 4000;
const CV_LIMIT = 8000;
const ABOUT_LIMIT = 1500;

const SYSTEM = `You write high-converting cover letters for job seekers.

Rules:
1. Open with one specific sentence about THIS company and role.
2. Three concrete value propositions, each anchored to a fact from the CV.
3. Mirror the vocabulary of the job description.
4. Never invent experience the CV does not support.
5. 220-320 words. Plain text only, no markdown, no placeholders.
6. Write natively in the requested language.
7. No clichés: "hard worker", "team player", "passionate".`;

const LANG_NAMES = { en: "English", el: "Greek", es: "Spanish", de: "German",
  fr: "French", it: "Italian", pt: "Portuguese", nl: "Dutch", pl: "Polish" };

export async function generateLetter(job, profile, cv) {
  const lang = profile.language || "en";
  const cvText = (cv && cv.text) || "";

  if (profile.anthropicKey && (cvText || profile.about)) {
    try {
      return { text: await viaClaude(job, profile, cvText, lang), model: "claude" };
    } catch (e) {
      return { text: template(job, profile, cvText, lang), model: "template", error: String(e.message || e) };
    }
  }
  return { text: template(job, profile, cvText, lang), model: "template" };
}

async function viaClaude(job, profile, cvText, lang) {
  const res = await fetch(CLAUDE_URL, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": profile.anthropicKey,
      "anthropic-version": "2023-06-01",
      "anthropic-dangerous-direct-browser-access": "true",
    },
    body: JSON.stringify({
      model: CLAUDE_MODEL,
      max_tokens: MAX_LETTER_TOKENS,
      system: [{ type: "text", text: SYSTEM, cache_control: { type: "ephemeral" } }],
      messages: [{
        role: "user",
        content: `Write a cover letter in ${LANG_NAMES[lang] || "English"}.

COMPANY: ${job.company}
ROLE: ${job.title}
LOCATION: ${job.location || "n/a"}

JOB DESCRIPTION:
${(job.description || "").slice(0, DESCRIPTION_LIMIT)}

CANDIDATE CV:
${cvText.slice(0, CV_LIMIT)}
${profile.about ? `
IN THE CANDIDATE'S OWN WORDS:
${profile.about.slice(0, ABOUT_LIMIT)}
` : ""}
Return only the letter.`,
      }],
    }),
  });

  if (!res.ok) throw new Error(`Anthropic ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const data = await res.json();
  const text = (data.content || []).filter((b) => b.type === "text").map((b) => b.text).join("\n").trim();
  if (!text) throw new Error("empty response");
  return text;
}

/* ── Template fallback ────────────────────────────────────── */

const HIGHLIGHT_COUNT = 3;
const HIGHLIGHT_MIN_LENGTH = 45;   // shorter lines are headings or single skills
const HIGHLIGHT_MAX_LENGTH = 220;  // longer ones are whole paragraphs
// The bullet marks CVs use, Word's Symbol and Wingdings bullets included.
const BULLET = /^[-*•●▪◦■□➢➤►▸‣⁃–✓✔]\s+(.*)$/u;
// Headings and contact details are not achievements.
const NOISE = /@|https?:|linkedin|github|curriculum vitae|^\s*resume\b|\+\d{2}|\[.*\]/i;

/**
 * Up to three achievements to quote. A CV's bullets often break over several
 * lines, so continuation lines are joined back first; lines that start with
 * a bullet are preferred, since that is where a CV keeps what someone did.
 */
function highlights(cvText) {
  const bullets = [];
  const fallback = [];
  let current = null;
  let currentIsBullet = false;

  const flush = () => {
    if (!current) return;
    const line = current.replace(/\*\*|`|_/g, "").replace(/\s+/g, " ").trim().replace(/[.;,]$/, "");
    current = null;
    if (line.length < HIGHLIGHT_MIN_LENGTH || line.length > HIGHLIGHT_MAX_LENGTH
        || line.endsWith(":") || NOISE.test(line)) return;
    (currentIsBullet ? bullets : fallback).push(line);
  };

  for (const raw of cvText.split(/\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#") || line.startsWith("---")) { flush(); continue; }

    const bulletMatch = BULLET.exec(line);
    if (bulletMatch) {
      flush();
      current = bulletMatch[1];
      currentIsBullet = true;
    } else if (current) {
      current += " " + line;                       // the same bullet, continued
    } else {
      current = line;
      currentIsBullet = false;
    }
    if (bullets.length >= HIGHLIGHT_COUNT) break;
  }
  flush();

  return (bullets.length ? bullets : fallback).slice(0, HIGHLIGHT_COUNT);
}

/*
 * One formal letter per language, as a native speaker writes one: the
 * greeting, the opening line, the line used when the CV has no achievements
 * to quote, the closing paragraph and the sign-off. Each language offered
 * for letters in Settings has one (tests/letters.test.mjs checks).
 */
const TEMPLATES = {
  en: {
    greeting: (company) => `Dear ${company} hiring team,`,
    opening: (title) => `I am applying for the ${title} position. My background lines up closely with what the role asks for.`,
    noHighlights: "Please see my attached CV for the full background.",
    closing: (company) => `I would welcome the chance to discuss how I can contribute to ${company}. I am available for an interview at short notice.`,
    signOff: "Kind regards,",
  },
  el: {
    greeting: (company) => `Αξιότιμοι κύριοι/κυρίες της ${company},`,
    opening: (title) => `Γράφω για τη θέση ${title}. Το προφίλ μου ταιριάζει άμεσα με όσα ζητά ο ρόλος.`,
    noHighlights: "Παρακαλώ δείτε το συνημμένο βιογραφικό μου.",
    closing: (company) => `Θα χαρώ να συζητήσουμε πώς μπορώ να συνεισφέρω στην ${company}. Είμαι διαθέσιμος/η για συνέντευξη άμεσα.`,
    signOff: "Με εκτίμηση,",
  },
  es: {
    greeting: (company) => `Estimado equipo de selección de ${company}:`,
    opening: (title) => `Les escribo para presentar mi candidatura al puesto de ${title}. Mi trayectoria se ajusta estrechamente a lo que pide el puesto.`,
    noHighlights: "Encontrarán mi trayectoria completa en el CV adjunto.",
    closing: (company) => `Me gustaría hablar con ustedes sobre cómo puedo contribuir a ${company}. Quedo a su disposición para una entrevista cuando les convenga.`,
    signOff: "Atentamente,",
  },
  de: {
    // After the greeting's comma, a German letter goes on in lower case.
    greeting: () => "Sehr geehrte Damen und Herren,",
    opening: (title) => `hiermit bewerbe ich mich um die Stelle als ${title}. Mein Werdegang passt genau zu dem, was die Stelle verlangt.`,
    noHighlights: "Meinen vollständigen Werdegang finden Sie in meinem beigefügten Lebenslauf.",
    closing: (company) => `Gerne erläutere ich Ihnen in einem persönlichen Gespräch, wie ich zum Erfolg von ${company} beitragen kann. Für ein Vorstellungsgespräch stehe ich kurzfristig zur Verfügung.`,
    signOff: "Mit freundlichen Grüßen",
  },
  fr: {
    greeting: () => "Madame, Monsieur,",
    opening: (title) => `Je vous adresse ma candidature au poste de ${title}. Mon parcours correspond étroitement aux exigences du poste.`,
    noHighlights: "Vous trouverez l'ensemble de mon parcours dans le CV ci-joint.",
    closing: (company) => `Ce serait un plaisir d'échanger avec vous sur la manière dont je peux contribuer à ${company}. Je suis disponible pour un entretien dans les meilleurs délais.`,
    signOff: "Je vous prie d'agréer, Madame, Monsieur, l'expression de mes salutations distinguées.",
  },
  it: {
    greeting: (company) => `Gentile team di selezione di ${company},`,
    opening: (title) => `Vi scrivo per candidarmi alla posizione di ${title}. Il mio percorso corrisponde da vicino a quanto richiesto dal ruolo.`,
    noHighlights: "Trovate il mio percorso completo nel CV allegato.",
    closing: (company) => `Mi farebbe piacere approfondire con voi come posso contribuire a ${company}. Sono disponibile per un colloquio anche con breve preavviso.`,
    signOff: "Cordiali saluti,",
  },
  pt: {
    greeting: () => "Exmos. Senhores,",
    opening: (title) => `Venho por este meio apresentar a minha candidatura à posição de ${title}. O meu percurso corresponde de perto ao que a função exige.`,
    noHighlights: "O meu percurso completo encontra-se no CV em anexo.",
    closing: (company) => `Teria todo o gosto em conversar sobre a forma como posso contribuir para a ${company}. Estou disponível para uma entrevista com a maior brevidade possível.`,
    signOff: "Com os melhores cumprimentos,",
  },
  nl: {
    greeting: () => "Geachte heer/mevrouw,",
    opening: (title) => `Hierbij solliciteer ik naar de functie van ${title}. Mijn achtergrond sluit nauw aan bij wat de functie vraagt.`,
    noHighlights: "Mijn volledige achtergrond vindt u in het bijgevoegde cv.",
    closing: (company) => `Graag licht ik in een gesprek toe hoe ik kan bijdragen aan ${company}. Ik ben op korte termijn beschikbaar voor een sollicitatiegesprek.`,
    signOff: "Met vriendelijke groet,",
  },
  pl: {
    greeting: () => "Szanowni Państwo,",
    opening: (title) => `Zgłaszam swoją kandydaturę na stanowisko ${title}. Moje doświadczenie ściśle odpowiada wymaganiom tego stanowiska.`,
    noHighlights: "Pełny opis mojego doświadczenia znajdą Państwo w załączonym CV.",
    closing: (company) => `Chętnie porozmawiam o tym, jak mogę przyczynić się do sukcesu firmy ${company}. Mogę spotkać się na rozmowę w dogodnym dla Państwa terminie.`,
    signOff: "Z poważaniem,",
  },
};

function template(job, profile, cvText, lang) {
  const letter = TEMPLATES[lang] || TEMPLATES.en;
  const points = highlights(cvText);
  const contact = [profile.email, profile.phone, profile.linkedin].filter(Boolean).join(" · ");
  return [
    letter.greeting(job.company), "",
    letter.opening(job.title), "",
    ...(points.length ? points : [letter.noHighlights]).map((point) => `• ${point}`), "",
    letter.closing(job.company), "",
    letter.signOff, profile.name || "", contact,
  ].join("\n").replace(/\n{3,}/g, "\n\n").trim();
}
