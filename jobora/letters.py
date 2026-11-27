"""
Cover letters.

Με ANTHROPIC_API_KEY → γράφει ο Claude, προσαρμοσμένο στο συγκεκριμένο job.
Χωρίς key → solid template fallback, ώστε το εργαλείο να δουλεύει ούτως ή άλλως.

Το Anthropic API καλείται με σκέτο urllib — κανένα SDK, κανένα pip install.
"""
from __future__ import annotations

import json
import re
import urllib.error
import urllib.request

from .config import Settings
from .profile import Profile

API_URL = "https://api.anthropic.com/v1/messages"
API_VERSION = "2023-06-01"

SYSTEM_PROMPT = """You write high-converting cover letters for job seekers.

Rules:
1. Open with one specific sentence about THIS company/role — never a generic hook.
2. Three concrete value propositions, each anchored to a verifiable fact from the CV.
3. Mirror the vocabulary of the job description.
4. Use metrics wherever the CV supplies them. Never invent experience.
5. 220-320 words. Recruiters skim for 7 seconds.
6. No clichés: "hard worker", "team player", "passionate", "I believe".
7. Plain text only — no markdown, no headers, no placeholders like [Company].
8. Write in the requested language, natively (not translated-sounding).
9. Start with an appropriate greeting, end with the candidate's name."""

# The languages Claude is asked to write in: the same as the extension's
# (extension/lib/letters.js). Any other code gets English.
LANG_NAMES = {"en": "English", "el": "Greek", "es": "Spanish", "de": "German", "fr": "French",
              "it": "Italian", "pt": "Portuguese", "nl": "Dutch", "pl": "Polish"}


class LetterError(RuntimeError):
    pass


def generate(job: dict, profile: Profile, settings: Settings,
             language: str | None = None) -> tuple[str, str]:
    """Returns (content, model_used): Claude's letter, or the template without a key or a CV."""
    lang = language or profile.default_language
    cv_text = profile.cv_text(lang)

    if not settings.has_ai or not cv_text:
        return _template(job, profile, lang), "template"

    try:
        return _claude(job, profile, settings, lang, cv_text), settings.claude_model
    except (urllib.error.URLError, LetterError, KeyError, ValueError, TimeoutError) as e:
        return _template(job, profile, lang) + f"\n\n[fallback: AI generation failed — {e}]", "template"


def _claude(job: dict, profile: Profile, settings: Settings, lang: str, cv_text: str) -> str:
    user_prompt = (
        f"Write a cover letter in {LANG_NAMES.get(lang, 'English')}.\n\n"
        f"COMPANY: {job.get('company')}\n"
        f"ROLE: {job.get('title')}\n"
        f"LOCATION: {job.get('location') or 'n/a'}\n\n"
        f"JOB DESCRIPTION:\n{(job.get('description') or '')[:4000]}\n\n"
        f"CANDIDATE CV:\n{cv_text[:8000]}\n\n"
        "Return only the letter."
    )

    payload = {
        "model": settings.claude_model,
        "max_tokens": 1200,
        "system": [{
            "type": "text",
            "text": SYSTEM_PROMPT,
            "cache_control": {"type": "ephemeral"},
        }],
        "messages": [{"role": "user", "content": user_prompt}],
    }

    req = urllib.request.Request(
        API_URL,
        data=json.dumps(payload).encode("utf-8"),
        headers={
            "content-type": "application/json",
            "x-api-key": settings.anthropic_api_key,
            "anthropic-version": API_VERSION,
        },
        method="POST",
    )

    try:
        with urllib.request.urlopen(req, timeout=90) as resp:
            data = json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        detail = e.read().decode("utf-8", errors="replace")[:400]
        raise LetterError(f"Anthropic HTTP {e.code}: {detail}") from e

    blocks = [b.get("text", "") for b in data.get("content", []) if b.get("type") == "text"]
    text = "\n".join(blocks).strip()
    if not text:
        raise LetterError("empty response from the API")
    return text


# ════════════════════════════════════════════════════════════════
# Template fallback
# ════════════════════════════════════════════════════════════════
# Τα bullets σε markdown CV σπάνε σε πολλές γραμμές — τα ενώνουμε ξανά.
_BULLET_RE = re.compile(r"^[ \t]*[-*•][ \t]+(.+?)(?=\n[ \t]*[-*•][ \t]|\n[ \t]*\n|\n#|\Z)",
                        re.M | re.S)


def _cv_highlights(profile: Profile, lang: str, n: int = 3) -> list[str]:
    text = profile.cv_text(lang, limit=6000)
    bullets = []
    for raw in _BULLET_RE.findall(text):
        clean = re.sub(r"\s+", " ", re.sub(r"\*\*|\*|`|_", "", raw)).strip(" .")
        if 40 <= len(clean) <= 220:
            bullets.append(clean)
    return bullets[:n]


# The template's sentences, word for word the extension's English and Greek
# ones (extension/lib/letters.js); other languages use the English. They claim
# nothing about the user: everything specific comes from the CV's bullets.
_TEMPLATES = {
    "en": {
        "greeting": "Dear {company} hiring team,",
        "opening": "I am applying for the {title} position. My background lines up closely with what the role asks for.",
        "no_highlights": "Please see my attached CV for the full background.",
        "closing": "I would welcome the chance to discuss how I can contribute to {company}. "
                   "I am available for an interview at short notice.",
        "sign_off": "Kind regards,",
    },
    "el": {
        "greeting": "Αξιότιμοι κύριοι/κυρίες της {company},",
        "opening": "Γράφω για τη θέση {title}. Το προφίλ μου ταιριάζει άμεσα με όσα ζητά ο ρόλος.",
        "no_highlights": "Παρακαλώ δείτε το συνημμένο βιογραφικό μου.",
        "closing": "Θα χαρώ να συζητήσουμε πώς μπορώ να συνεισφέρω στην {company}. "
                   "Είμαι διαθέσιμος/η για συνέντευξη άμεσα.",
        "sign_off": "Με εκτίμηση,",
    },
}


def _template(job: dict, profile: Profile, lang: str) -> str:
    words = _TEMPLATES.get(lang, _TEMPLATES["en"])
    company = job.get("company") or "your company"
    title = job.get("title") or "the role"
    highlights = _cv_highlights(profile, lang) or [words["no_highlights"]]

    body = [words["greeting"].format(company=company), "",
            words["opening"].format(title=title), ""]
    body += [f"• {point}" for point in highlights]
    body += ["", words["closing"].format(company=company), "", words["sign_off"], profile.name or "—"]

    contact = " · ".join(x for x in (profile.email, profile.phone, profile.linkedin) if x)
    if contact:
        body += ["", contact]
    return "\n".join(body)
