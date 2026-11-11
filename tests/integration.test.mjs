import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { completionBody, startProvider } from "./provider-fixture.mjs";

const host = "127.0.0.1";

async function startApp(databasePath, providerUrl) {
  const child = spawn(
    process.execPath,
    ["node_modules/next/dist/bin/next", "start", "-H", host, "-p", "0"],
    {
      cwd: new URL("../", import.meta.url),
      env: {
        ...process.env,
        DATABASE_PATH: databasePath,
        EXTRACTION_TIMEOUT_MS: "1000",
        LLM_API_KEY: "fixture-key",
        LLM_BASE_URL: providerUrl,
        LLM_MODEL: "fixture-model",
        NEXT_TELEMETRY_DISABLED: "1",
        NODE_ENV: "production",
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );

  let stdout = "";
  let stderr = "";
  let spawnError;
  child.stdout.setEncoding("utf8").on("data", (chunk) => { stdout += chunk; });
  child.stderr.setEncoding("utf8").on("data", (chunk) => { stderr += chunk; });
  child.on("error", (error) => { spawnError = error; });
  const closed = new Promise((resolve) => child.once("close", resolve));

  async function stop() {
    if (child.exitCode === null && child.signalCode === null && !child.killed) {
      child.kill();
    }
    const forceStop = setTimeout(() => child.kill("SIGKILL"), 5_000);
    try {
      await closed;
      return stdout;
    } finally {
      clearTimeout(forceStop);
    }
  }

  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline && !spawnError && child.exitCode === null && child.signalCode === null) {
    const url = stdout.match(/http:\/\/127\.0\.0\.1:\d+/)?.[0];
    if (url) {
      try {
        const response = await fetch(`${url}/api/notes`, { signal: AbortSignal.timeout(500) });
        await response.text();
        if (response.ok) return { url, stop };
      } catch {
        // The server may still be starting.
      }
    }
    await delay(50);
  }
  await stop();
  assert.fail(`Next.js did not start.\n${spawnError ?? ""}\n${stdout}\n${stderr}`);
}

async function requestJson(app, path, expectedStatus, { method = "GET", payload } = {}) {
  const response = await fetch(`${app.url}${path}`, {
    method,
    headers: payload === undefined ? undefined : { "content-type": "application/json" },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(10_000),
  });
  const body = await response.text();
  assert.equal(response.status, expectedStatus, `${method} ${path} returned ${body}`);
  return JSON.parse(body);
}

function extractionAudits(output) {
  return output
    .split("\n")
    .filter((line) => line.startsWith("{"))
    .map((line) => JSON.parse(line))
    .filter((entry) => entry.event === "note_extraction");
}

test("production notes API", { timeout: 45_000 }, async (t) => {
  const temporaryDirectory = await mkdtemp(join(tmpdir(), "action-item-extractor-"));
  let provider;
  let app;
  t.after(async () => {
    await app?.stop();
    await Promise.all([
      provider?.close(),
      rm(temporaryDirectory, { recursive: true, force: true }),
    ]);
  });

  provider = await startProvider();
  const databasePath = join(temporaryDirectory, "test.sqlite");
  app = await startApp(databasePath, provider.baseUrl);
  const expectedAudits = [];
  let firstServerOutput = "";

  async function extract(text, status, outcome, { rawResponse = null, modelOutput = null } = {}) {
    const result = await requestJson(app, "/notes/extract", status, {
      method: "POST",
      payload: { text },
    });
    expectedAudits.push({
      noteText: typeof text === "string" ? text : null,
      rawResponse,
      modelOutput,
      outcome,
    });
    return result;
  }

  async function listNotes() {
    const { notes } = await requestJson(app, "/api/notes", 200);
    return notes;
  }

  await t.test("rejects invalid notes without calling the model", async () => {
    await extract(" \n\t ", 400, "invalid_request");
    await extract(42, 400, "invalid_request");
    await extract("a".repeat(12_001), 400, "invalid_request");
    assert.equal(provider.requests.length, 0);
    assert.deepEqual(await listNotes(), []);
  });

  let savedNote;
  await t.test("stores action items and preserves the original note", async () => {
    const text = "  Alex will send the revised invoice by November 20, 2026.\nUpdate the \"shared timeline\".  ";
    const items = [
      { title: "Send the revised invoice", owner: "Alex", due: "2026-11-20" },
      { title: "Update the shared timeline", owner: null, due: null },
    ];
    const modelOutput = JSON.stringify({ items });
    const rawResponse = completionBody(modelOutput);
    provider.reply({ body: rawResponse });
    const { note } = await extract(text, 201, "saved", { rawResponse, modelOutput });
    savedNote = note;

    assert.match(note.id, /\S/);
    assert.equal(note.text, text);
    assert.ok(Number.isFinite(Date.parse(note.createdAt)), "expected a valid creation timestamp");
    assert.equal(note.items.length, 2);
    assert.notEqual(note.items[0].id, note.items[1].id);
    for (const [index, item] of note.items.entries()) {
      const { id, ...fields } = item;
      assert.match(id, /\S/);
      assert.deepEqual(fields, { ...items[index], done: false });
    }
    assert.deepEqual(await listNotes(), [note]);

    assert.equal(provider.requests.length, 1);
    const [request] = provider.requests;
    assert.equal(request.authorization, "Bearer fixture-key");
    assert.equal(request.body.model, "fixture-model");
    assert.equal(request.body.response_format.type, "json_object");
    assert.ok(request.body.messages.some(({ content }) =>
      typeof content === "string" && content.includes("send the revised invoice")));
  });

  await t.test("allows toggling done and persists it across a restart", async () => {
    const [original] = savedNote.items;
    const itemPath = `/api/items/${encodeURIComponent(original.id)}`;
    await requestJson(app, itemPath, 400, {
      method: "PATCH",
      payload: { done: true, title: "Changed title" },
    });
    await requestJson(app, itemPath, 400, {
      method: "PATCH",
      payload: { done: "true" },
    });
    assert.deepEqual(await listNotes(), [savedNote]);
    await requestJson(app, "/api/items/nonexistent-id", 404, {
      method: "PATCH",
      payload: { done: true },
    });

    const { item } = await requestJson(app, itemPath, 200, {
      method: "PATCH",
      payload: { done: true },
    });
    assert.deepEqual(item, { ...original, done: true });

    firstServerOutput = await app.stop();
    app = await startApp(databasePath, provider.baseUrl);
    assert.deepEqual(await listNotes(), [{ ...savedNote, items: [item, savedNote.items[1]] }]);

    const reopened = await requestJson(app, itemPath, 200, {
      method: "PATCH",
      payload: { done: false },
    });
    assert.deepEqual(reopened.item, original);
    assert.deepEqual(await listNotes(), [savedNote]);
  });

  await t.test("stores a note when the model returns an empty list", async () => {
    const text = "We discussed the weather during the meeting.";
    const modelOutput = '{"items":[]}';
    const rawResponse = completionBody(modelOutput);
    provider.reply({ body: rawResponse });
    const { note } = await extract(text, 201, "saved", { rawResponse, modelOutput });
    assert.equal(note.text, text);
    assert.deepEqual(note.items, []);
    assert.deepEqual((await listNotes()).find(({ id }) => id === note.id), note);
  });

  await t.test("rejects invalid model output and upstream failures without saving notes", async (failureTests) => {
    const savedNotes = await listNotes();
    assert.equal(savedNotes.length, 2);

    const malformed = '{"items":[';
    const invalidItem = JSON.stringify({
      items: [
        { title: "Valid item", owner: null, due: null },
        { title: "Invalid owner", owner: 42, due: null },
      ],
    });
    const upstreamError = '{"error":{"message":"Provider unavailable"}}';
    const partialResponse = '{"choices":';
    const failures = [
      { name: "malformed JSON", status: 422, outcome: "invalid_output", modelOutput: malformed },
      { name: "invalid item", status: 422, outcome: "invalid_output", modelOutput: invalidItem },
      { name: "upstream error", status: 502, outcome: "provider_error", upstreamStatus: 503, body: upstreamError },
      { name: "stalled response body", status: 504, outcome: "timeout", body: partialResponse, stall: true },
    ];
    for (const failure of failures) {
      await failureTests.test(failure.name, async () => {
        const modelOutput = failure.modelOutput ?? null;
        const rawResponse = failure.body ?? completionBody(modelOutput);
        const before = provider.requests.length;
        provider.reply({ status: failure.upstreamStatus, body: rawResponse, stall: failure.stall });
        const started = performance.now();
        await extract(`Note for ${failure.name}.`, failure.status, failure.outcome, { rawResponse, modelOutput });
        if (failure.stall) {
          assert.ok(performance.now() - started < 5_000, "the stalled request should respect the extraction deadline");
        }
        assert.equal(provider.requests.length, before + 1);
        assert.deepEqual(await listNotes(), savedNotes);
      });
    }
  });

  await t.test("rolls back the note and all items if an insert fails", async () => {
    const before = await listNotes();
    const db = new DatabaseSync(databasePath);
    db.exec(`
      CREATE TRIGGER reject_test_item BEFORE INSERT ON action_items
      WHEN NEW.title = 'Reject this item'
      BEGIN
        SELECT RAISE(ABORT, 'test insert failure');
      END;
    `);
    try {
      const modelOutput = JSON.stringify({
        items: [
          { title: "Insert this item first", owner: null, due: null },
          { title: "Reject this item", owner: null, due: null },
        ],
      });
      const rawResponse = completionBody(modelOutput);
      provider.reply({ body: rawResponse });
      await extract("Storage failure fixture.", 500, "storage_error", { rawResponse, modelOutput });
      assert.deepEqual(await listNotes(), before);
    } finally {
      db.exec("DROP TRIGGER reject_test_item");
      db.close();
    }
  });

  await t.test("writes one audit record per extraction attempt", async () => {
    const output = `${firstServerOutput}\n${await app.stop()}`;
    const entries = extractionAudits(output);
    for (const entry of entries) {
      assert.ok(Number.isFinite(entry.elapsedMs) && entry.elapsedMs >= 0, "expected elapsed time in milliseconds");
    }
    assert.deepEqual(
      entries.map(({ noteText, rawResponse, modelOutput, outcome }) => ({
        noteText, rawResponse, modelOutput, outcome,
      })),
      expectedAudits,
    );
  });
});
