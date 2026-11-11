import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { startApp } from "./production-app.mjs";

// Check meaning and attribution, while allowing the model to phrase tasks in its own words.
const cases = [
  {
    file: "weekly-sync",
    actions: [
      { task: /(?:retry|retries|timeout|connection pool)/i, owner: "ana", due: null },
      { task: /\b(?:read|review)\b.*\bq3\b/i, owner: "everyone", due: "before next week" },
      { task: /\blaptop\b/i, excluded: /\baccounts?\b/i, owner: null, due: null },
      { task: /\baccounts?\b/i, excluded: /\blaptop\b/i, owner: "tomaz", due: null },
      { task: /\bcopy\b/i, required: /\b(?:billing|marketing)\b/i, owner: "marko", due: /^(?:by )?friday$/ },
      { task: /\bretro(?:spective)?\b/i, excluded: /\b(?:skip|cancel)\b/i, owner: null, due: null },
      { task: /\b(?:reset|refresh)\b.*\bstaging\b.*\b(?:db|database)\b/i, owner: null, due: null },
    ],
  },
  {
    file: "customer-call",
    actions: [
      { task: /\bsso\b/i, required: /\bproduct\b/i, owner: null, due: null },
      { task: /\bexports?\b/i, required: /\b(?:50\s*k|50,?000)\s+records\b/i, owner: "ana", due: null },
      { task: /\bwalk[ -]?through\b/i, required: /\b(?:ops|operations) lead\b/i, owner: null, due: null },
    ],
  },
];

async function extract(app, text) {
  const start = performance.now();
  const response = await fetch(`${app.url}/notes/extract`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ text }),
    signal: AbortSignal.timeout(5_000),
  });
  const body = await response.text();
  return { status: response.status, body, ms: performance.now() - start };
}

function expectActions(items, actions) {
  const summary = JSON.stringify(items.map(({ title, owner, due }) => ({ title, owner, due })));
  assert.equal(items.length, actions.length, summary);
  const unmatched = [...items];
  for (const { task, required, excluded, owner, due } of actions) {
    const index = unmatched.findIndex((item) =>
      task.test(item.title) &&
      (!required || required.test(item.title)) &&
      (!excluded || !excluded.test(item.title)) &&
      (item.owner?.trim().toLowerCase() ?? null) === owner &&
      (due instanceof RegExp ? due.test(item.due?.trim().toLowerCase() ?? "") : (item.due?.trim().toLowerCase() ?? null) === due),
    );
    assert.ok(index >= 0, `Missing ${task} (owner: ${owner}, due: ${due}). Got: ${summary}`);
    unmatched.splice(index, 1);
  }
  assert.ok(items.every((item) => item.done === false));
}

test("full assignment samples through the production API and real model", { timeout: 90_000 }, async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "action-extractor-live-"));
  let app;
  t.after(async () => {
    await app?.stop();
    await rm(directory, { recursive: true, force: true });
  });
  app = await startApp(join(directory, "live.sqlite"), { EXTRACTION_TIMEOUT_MS: "" });

  // Load the route and warm up the model with different text. No sample output is used as a fixture.
  const warmup = await extract(app, "Mia will send the agenda by Tuesday.");
  assert.equal(warmup.status, 201, warmup.body);
  const samples = await Promise.all(cases.map(async (sample) => ({
    ...sample,
    text: await readFile(new URL(`fixtures/${sample.file}.txt`, import.meta.url), "utf8"),
  })));
  const saved = [];
  for (let round = 1; round <= 5; round++) {
    for (const sample of samples) {
      await t.test(`${sample.file}, run ${round}`, async (run) => {
        const { status, body, ms } = await extract(app, sample.text);
        run.diagnostic(`${ms.toFixed(1)} ms end to end (HTTP ${status})`);
        assert.equal(status, 201, body);
        assert.ok(ms < 2_000, `Expected <2,000 ms; got ${ms.toFixed(1)} ms`);
        const { note } = JSON.parse(body);
        assert.equal(note.text, sample.text);
        expectActions(note.items, sample.actions);
        saved.push(note);
      });
    }
  }

  await t.test("new notes without actions save an empty list", async () => {
    const text = "The partner said the menu was confusing. No decision or follow-up was agreed.";
    const { status, body } = await extract(app, text);
    assert.equal(status, 201, body);
    const { note } = JSON.parse(body);
    assert.equal(note.text, text);
    assert.deepEqual(note.items, []);
    saved.push(note);
  });

  const response = await fetch(`${app.url}/api/notes`, { signal: AbortSignal.timeout(5_000) });
  assert.equal(response.status, 200);
  const { notes } = await response.json();
  assert.equal(notes.length, 1 + samples.length * 5 + 1);
  for (const note of saved) {
    assert.deepEqual(notes.find(({ id }) => id === note.id), note);
  }
});
