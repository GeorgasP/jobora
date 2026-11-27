import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { generateLetter } from "../extension/lib/letters.js";

const job = { company: "Taverna Thalassa", title: "Waiter", location: "Athens, Greece", description: "Serve our guests." };
const profile = { name: "Maria Papadopoulou", email: "maria@example.test", phone: "+30 690 000 0000", language: "en" };
const cv = { text: [
  "Maria Papadopoulou",
  "maria@example.test · +30 690 000 0000 · linkedin.com/in/maria-example",
  "EXPERIENCE",
  "- Served up to 120 covers a night in a busy seaside restaurant in Piraeus",
  "  during the summer seasons of 2022 and 2023",
  "- Trained four new waiters on the till, the menu and the basics of wine pairing",
  "- Fluent",
  "- Kept a 4.8 rating on the restaurant's guest reviews across two full seasons",
].join("\n") };

const withFetch = async (fake, run) => {
  const original = globalThis.fetch;
  globalThis.fetch = fake;
  try { return await run(); } finally { globalThis.fetch = original; }
};

test("without a key, the letter is the template, built from the CV's achievements", async () => {
  const letter = await generateLetter(job, profile, cv);
  assert.equal(letter.model, "template");
  assert.match(letter.text, /^Dear Taverna Thalassa hiring team,/);
  assert.match(letter.text, /the Waiter position/);
  // A bullet broken over two lines is one achievement; contact lines and
  // one-word bullets are not achievements.
  assert.match(letter.text, /• Served up to 120 covers a night in a busy seaside restaurant in Piraeus during the summer seasons of 2022 and 2023\n/);
  assert.match(letter.text, /• Trained four new waiters/);
  assert.match(letter.text, /• Kept a 4.8 rating/);
  assert.doesNotMatch(letter.text, /• (Fluent|maria@)/);
  assert.match(letter.text, /Kind regards,\nMaria Papadopoulou\nmaria@example.test · \+30 690 000 0000$/);
});

test("a CV with nothing usable still gets a complete letter", async () => {
  const letter = await generateLetter(job, profile, { text: "" });
  assert.match(letter.text, /• Please see my attached CV/);
});

test("the template is written in the language chosen for letters", async () => {
  const english = (await generateLetter(job, profile, cv)).text;
  const closing = { el: "Με εκτίμηση,", es: "Atentamente,", de: "Mit freundlichen Grüßen", fr: "salutations distinguées.",
    it: "Cordiali saluti,", pt: "Com os melhores cumprimentos,", nl: "Met vriendelijke groet,", pl: "Z poważaniem," };
  for (const [language, words] of Object.entries(closing)) {
    const { text } = await generateLetter(job, { ...profile, language }, cv);
    assert.notEqual(text, english, `${language} fell back to English`);
    assert.ok(text.includes(words), `${language}: ${text}`);
    assert.ok(text.includes("Waiter") && text.includes("Taverna Thalassa"), `${language} lost the job`);
    assert.ok(text.includes("• Trained four new waiters"), `${language} lost the CV's achievements`);
    assert.ok(text.endsWith("Maria Papadopoulou\nmaria@example.test · +30 690 000 0000"), `${language} lost the signature`);
  }
});

test("every language offered for cover letters in Settings has a template", async () => {
  const html = readFileSync(new URL("../extension/app.html", import.meta.url), "utf8");
  const select = html.slice(html.indexOf('<select id="language">'), html.indexOf("</select>", html.indexOf('<select id="language">')));
  const offered = [...select.matchAll(/value="([a-z]{2})"/g)].map((m) => m[1]);
  assert.ok(offered.length >= 7, `options found: ${offered}`);
  const english = (await generateLetter(job, profile, cv)).text;
  for (const language of offered.filter((code) => code !== "en")) {
    const { text } = await generateLetter(job, { ...profile, language }, cv);
    assert.notEqual(text, english, `"${language}" is offered but writes English`);
  }
});

test("with a key, Claude writes the letter, and the key goes only to Anthropic", async () => {
  const requests = [];
  const letter = await withFetch(async (url, options) => {
    requests.push({ url: String(url), headers: options.headers, body: JSON.parse(options.body) });
    return new Response(JSON.stringify({ content: [{ type: "text", text: "Dear Taverna Thalassa team, …" }] }));
  }, () => generateLetter(job, { ...profile, language: "el", anthropicKey: "test-key" }, cv));

  assert.deepEqual(letter, { text: "Dear Taverna Thalassa team, …", model: "claude" });
  assert.equal(requests.length, 1);
  const [request] = requests;
  assert.equal(request.url, "https://api.anthropic.com/v1/messages");
  assert.equal(request.headers["x-api-key"], "test-key");
  const prompt = request.body.messages[0].content;
  assert.match(prompt, /in Greek/);
  assert.match(prompt, /COMPANY: Taverna Thalassa/);
  assert.match(prompt, /Trained four new waiters/);
});

test("when Claude fails, the template is used and the reason is kept", async () => {
  const letter = await withFetch(async () => new Response('{"error":"invalid key"}', { status: 401 }),
    () => generateLetter(job, { ...profile, anthropicKey: "wrong" }, cv));
  assert.equal(letter.model, "template");
  assert.match(letter.text, /^Dear Taverna Thalassa hiring team,/);
  assert.match(letter.error, /401/);
});

test("a key without a CV or an about text is not sent anywhere", async () => {
  let called = false;
  const letter = await withFetch(async () => { called = true; return new Response("{}"); },
    () => generateLetter(job, { ...profile, anthropicKey: "test-key" }, { text: "" }));
  assert.equal(called, false);
  assert.equal(letter.model, "template");
});
