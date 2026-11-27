/*
 * Jobora: fills an application form from the user's profile.
 *
 * Runs on the application page (as a content script, or as a bookmarklet) and
 * never presses Submit: sending an application stays the user's decision.
 *
 * Exposed as window.__joboraFill(data) -> report, where data is what the
 * service worker answers to {type: "prefill"} (prefillFor in background.js).
 */
(function () {
  "use strict";

  // The report box's texts. The service worker sends them in the user's
  // language; these are for a page that gets none, such as a bookmarklet.
  const DEFAULT_TEXTS = {
    filled: "Fields filled: {n}",
    cvAttached: " · CV attached",
    required: "Required fields still empty: {n}",
    check: "Check everything, then press Submit yourself.",
    leftForYou: "Left for you: {fields}",
    cvUpload: "CV upload",
  };
  const TOAST_ID = "__jobora_toast";
  const TOAST_SECONDS = 12;
  const DESCRIPTION_LIMIT = 300;   // characters of label text a field is judged by
  const QUESTION_LIMIT = 60;       // characters of a question named in the report
  const FILLABLE_TYPES = new Set(["text", "email", "tel", "url", "search", ""]);

  /** A whole-word pattern that works for Greek too, which \b does not. */
  const words = (pattern) => new RegExp(`(?<![\\p{L}\\p{N}])(?:${pattern})(?![\\p{L}\\p{N}])`, "u");

  /* ── Rules: the first match wins, so the specific ones come first. A null
        key means "leave this field alone". They match the words describe()
        returns: lower case, with "phoneNumber" and "first_name" split up. ── */
  const NOT_THE_APPLICANT = "company|employer|organi[sz]ation|business|school|university|college|institution"
    + "|reference|referee|manager|supervisor|recruiter|project|account|bank|file|user";
  const RULES = [
    // Names that are not the applicant's: a company's, a school's, a
    // referee's, a username. Before the name rules on purpose.
    [words(`(?:${NOT_THE_APPLICANT})(?: s)? (?:first |last |full )?name|name of (?:your |the )?(?:${NOT_THE_APPLICANT})`
      + "|username|name pronunciation"), null],
    [words("first ?name|given ?name|forename|vorname|prénom|nombre(?! completo)|όνομα"), "first_name"],
    [words("last ?name|surname|family ?name|nachname|apellidos?|επώνυμο"), "last_name"],
    [words("full ?name|name|ονοματεπώνυμο"), "full_name"],
    [words("e ?mail|ηλεκτρονικό ταχυδρομείο"), "email"],
    [words("(?:tele)?phone|mobile|cell|contact number|τηλέφωνο|κινητό"), "phone"],
    [words("linked ?in"), "linkedin"],
    [words("git ?hub"), "github"],
    // Lever calls every link field "… URL": "LinkedIn URL", "Video Link URL".
    // Without this rule the profile link went where the employer wanted a video.
    [words("video|reel|showreel|demo ?(?:tape|reel)"), null],
    [words("portfolio|personal (?:web ?)?site|web ?site|url|blog|homepage"), "website"],
    // Whole words: "Ethnicity" holds "city" and "Relocation" holds "location".
    [words("current (?:city|location)|where are you (?:based|located)|city|location|address|town|πόλη|τοποθεσία|διεύθυνση"), "location"],
    [words("salary|compensation|expected pay|rate expectations?|pay expectations?|μισθ\\p{L}*"), "salary_expectation"],
    [words("notice period|when can you start|start date|availability|available from|earliest start"), "notice_period"],
    [words("work (?:authori[sz]ation|permit|status)|legally (?:authori[sz]ed|entitled)|visa|sponsorship|right to work"),
      "work_authorization"],
    // "Open source contributions" is not where they heard of the job.
    [words("how did you (?:hear|find|learn)|where did you (?:hear|find|see)|referral source|(?<!open )source"), "how_did_you_hear"],
    [words("cover ?letter|why do you|why are you|motivation|tell us|message|additional information|anything else"
      + "|συνοδευτική επιστολή|μήνυμα"), "cover_letter"],
  ];
  // The one place where repeating a value is the point: "Confirm email".
  const CONFIRMATION = words("confirm|repeat|verify|again|re ?enter|retype|ξανά|επιβεβαίωση");
  // Upload fields: the CV goes into one that asks for a CV, or else into a
  // general attachment field, but never into one meant for something else.
  const CV_UPLOAD = words("resume|résumé|cv|curriculum(?: vitae)?|lebenslauf|βιογραφικ\\p{L}*");
  const ANY_UPLOAD = words("attach(?:ment)?s?|upload|files?|documents?");
  const OTHER_UPLOAD = words("cover ?letter|motivation|anschreiben|lettre|portfolio|transcripts?|photo|picture|avatar"
    + "|certificates?|diploma|συνοδευτική");

  /* ── Writing a value the way a person would ─────────────────────────────
     React and Vue keep their own copy of a field's value and ignore
     `el.value = x`. The prototype's setter, followed by the events typing
     fires, reaches them. */
  function setNativeValue(el, value) {
    const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
    if (setter) setter.call(el, value); else el.value = value;
    for (const type of ["input", "change", "blur"]) el.dispatchEvent(new Event(type, { bubbles: true }));
  }

  /* ── What a field is about ─────────────────────────────────────────── */

  /** The label of the field's container: Greenhouse and Lever put it in a div above the input. */
  const containerLabel = (el) =>
    el.closest("div,fieldset,li,section")?.querySelector("label,legend,.label,[class*='label']") || null;

  /**
   * Everything that names a field, as plain lower-case words:
   * name="job_application[first_name]" and name="phoneNumber" become
   * "job application first name" and "phone number".
   */
  function describe(el) {
    const bits = [el.name, el.id, el.placeholder, el.getAttribute("aria-label"),
      el.getAttribute("autocomplete"), el.getAttribute("data-testid")];
    if (el.id) bits.push(document.querySelector(`label[for="${CSS.escape(el.id)}"]`)?.textContent);
    bits.push(el.closest("label")?.textContent);
    for (const id of (el.getAttribute("aria-labelledby") || "").split(/\s+/).filter(Boolean)) {
      bits.push(document.getElementById(id)?.textContent);
    }
    bits.push(containerLabel(el)?.textContent);
    return bits.filter(Boolean).join(" ")
      .replace(/(\p{Ll})(\p{Lu})/gu, "$1 $2")
      .toLowerCase()
      .replace(/[^\p{L}\p{N}]+/gu, " ")
      .trim()
      .slice(0, DESCRIPTION_LIMIT);
  }

  function keyFor(el) {
    const type = (el.type || "").toLowerCase();
    if (type === "email") return "email";
    if (type === "tel") return "phone";
    const text = describe(el);
    for (const [pattern, key] of RULES) if (pattern.test(text)) return key;
    return type === "url" ? "website" : null;
  }

  function isFillable(el) {
    if (el.disabled || el.readOnly || el.offsetParent === null) return false;   // hidden ones too
    return el.tagName === "TEXTAREA" || FILLABLE_TYPES.has((el.type || "").toLowerCase());
  }

  // A textarea asks for the applicant's own words, so the cover letter is the
  // only answer that goes there, and the letter goes nowhere else: "Mobile
  // development experience" is not a phone number.
  const fitsField = (el, key) => (el.tagName === "TEXTAREA") === (key === "cover_letter");

  /** The other radio buttons or checkboxes answering the same question. */
  const peersOf = (el) => (el.name ? [...document.querySelectorAll(`input[name="${CSS.escape(el.name)}"]`)] : [el]);

  /** The question as the page words it, for the report: "Do you need visa sponsorship?". */
  function questionOf(el) {
    let label = null;
    if (el.type === "radio" || el.type === "checkbox") {
      // A choice's own label says "Yes"; the question is the group's heading.
      const peers = peersOf(el);
      let group = el.parentElement;
      while (group && !peers.every((peer) => group.contains(peer))) group = group.parentElement;
      label = [...(group?.querySelectorAll("legend,label,.label,[class*='label']") || [])]
        .find((node) => !peers.some((peer) => node.contains(peer))) || null;
    } else {
      label = (el.id && document.querySelector(`label[for="${CSS.escape(el.id)}"]`))
        || el.closest("label") || el.closest("fieldset")?.querySelector("legend") || containerLabel(el);
    }
    const text = (label?.textContent || el.getAttribute("aria-label") || "").replace(/\s+/g, " ").trim();
    return text.length > QUESTION_LIMIT ? `${text.slice(0, QUESTION_LIMIT - 1)}…` : text;
  }

  function isAnswered(el) {
    if (el.tagName === "SELECT") return el.value !== "";
    return peersOf(el).some((peer) => peer.checked);
  }

  /* ── The CV ─────────────────────────────────────────────────────────── */

  function cvUploadField() {
    const uploads = [...document.querySelectorAll("input[type=file]")]
      .filter((el) => !el.disabled && !OTHER_UPLOAD.test(describe(el)));
    return uploads.find((el) => CV_UPLOAD.test(describe(el)))
      || uploads.find((el) => ANY_UPLOAD.test(describe(el))) || null;
  }

  // File + DataTransfer: the only way script can put a file in an upload field.
  function attachCV(input, cv) {
    try {
      const bytes = Uint8Array.from(atob(cv.base64), (c) => c.charCodeAt(0));
      const transfer = new DataTransfer();
      transfer.items.add(new File([bytes], cv.filename, { type: cv.mime || "application/octet-stream" }));
      input.files = transfer.files;
      input.dispatchEvent(new Event("change", { bubbles: true }));
      return true;
    } catch {
      return false;
    }
  }

  /*
   * How many required questions are still unanswered.
   *
   * Two traps: Workable puts aria-required on a wrapper div rather than on
   * the field, so only real controls are counted, each checking whether an
   * ancestor declares it required; and a group of five radio buttons is one
   * question, not five.
   */
  function countUnanswered() {
    const seenGroups = new Set();
    return [...document.querySelectorAll("input, textarea, select")].filter((el) => {
      if (el.disabled || el.offsetParent === null) return false;
      if (!(el.required || el.getAttribute("aria-required") === "true"
            || el.closest("[aria-required='true']"))) return false;

      const type = (el.type || "").toLowerCase();
      if (type === "file") return el.files.length === 0;
      if (type === "radio" || type === "checkbox") {
        const group = el.name || el.id;
        if (!group || seenGroups.has(group)) return false;
        seenGroups.add(group);
        return !document.querySelector(`[name="${CSS.escape(group)}"]:checked`);
      }
      return !String(el.value || "").trim();
    }).length;
  }

  /* ── The report box ─────────────────────────────────────────────────── */

  const fillIn = (template, values) =>
    Object.entries(values).reduce((text, [name, value]) => text.replaceAll(`{${name}}`, String(value)), template);
  const NOTE_STYLE = "color:#8b949e;font-size:12.5px;margin-top:6px";
  const WARNING_STYLE = "color:#f0a020;font-size:12.5px;margin-top:6px";

  // Built from text nodes only: the company and title come from public job
  // ads, and markup in them must show as text, not run on the employer's page.
  function showReport(report, data, texts) {
    document.getElementById(TOAST_ID)?.remove();
    const box = document.createElement("div");
    box.id = TOAST_ID;
    box.style.cssText = [
      "position:fixed", "z-index:2147483647", "right:18px", "bottom:18px",
      "max-width:330px", "background:#161b22", "color:#e6edf3",
      "border:1px solid #2f81f7", "border-radius:10px", "padding:14px 16px",
      "font:14px/1.5 system-ui,-apple-system,Segoe UI,sans-serif",
      "box-shadow:0 8px 28px rgba(0,0,0,.45)",
    ].join(";");
    const line = (text, style = "") => {
      const div = document.createElement("div");
      div.textContent = text;
      div.style.cssText = style;
      box.append(div);
    };

    line("🎯 Jobora", "font-weight:700");
    line(fillIn(texts.filled, { n: report.filled }) + (report.cv ? texts.cvAttached : ""));
    // Essay questions ("describe the best engineer you worked with") are never
    // filled by a tool. Without counting them, "5 fields filled" sounds like
    // the form is done, and it is not.
    if (report.required) line(fillIn(texts.required, { n: report.required }), WARNING_STYLE);
    if (data.job) line(`${data.job.company} — ${data.job.title}`, NOTE_STYLE);
    if (data.notice) line(data.notice, WARNING_STYLE);
    line(texts.check, "margin-top:8px;font-size:12.5px");
    if (report.skipped.length) line(fillIn(texts.leftForYou, { fields: report.skipped.join(", ") }), NOTE_STYLE);

    document.body.appendChild(box);
    setTimeout(() => box.remove(), TOAST_SECONDS * 1000);
  }

  /* ── Filling ────────────────────────────────────────────────────────── */

  window.__joboraFill = function (data) {
    const texts = { ...DEFAULT_TEXTS, ...(data.texts || {}) };
    const answers = { ...(data.answers || {}) };
    if (data.cover_letter) answers.cover_letter = data.cover_letter;

    const report = { filled: 0, cv: false, fields: [], skipped: [], required: 0 };
    const filledKeys = new Set();
    const usedValues = new Set();

    const upload = data.cv ? cvUploadField() : null;
    if (upload) report.cv = attachCV(upload, data.cv);

    for (const el of document.querySelectorAll("input, textarea")) {
      if (!isFillable(el)) continue;
      const key = keyFor(el);
      if (!key || !fitsField(el, key)) continue;
      const value = String(answers[key] || "").trim();
      if (!value || el.value.trim()) continue;          // nothing to give, or the user's own answer
      // A full name next to first and last name fields is the same question twice.
      if (key === "full_name" && filledKeys.has("first_name")) continue;
      // Each answer once: a form with three link fields does not want the
      // same profile three times, and whoever reads it notices.
      if ((filledKeys.has(key) || usedValues.has(value)) && !CONFIRMATION.test(describe(el))) continue;

      setNativeValue(el, value);
      filledKeys.add(key);
      usedValues.add(value);
      report.filled++;
      report.fields.push(key);
    }

    // What stays with the user: choices such as work authorization or
    // country. Jobora never picks an option: a wrong answer to a legal
    // question costs more than the click it saves.
    for (const el of document.querySelectorAll("select, input[type=radio], input[type=checkbox]")) {
      if (el.disabled || el.offsetParent === null || isAnswered(el)) continue;
      const key = keyFor(el);
      if (!key || filledKeys.has(key)) continue;
      const question = questionOf(el);
      if (question && !report.skipped.includes(question)) report.skipped.push(question);
    }
    if (data.cv && !report.cv) report.skipped.push(texts.cvUpload);

    report.required = countUnanswered();
    showReport(report, data, texts);
    return report;
  };

  return window.__joboraFill;
})();
