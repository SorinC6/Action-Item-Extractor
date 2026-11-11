# Action Item Extractor

Paste rough meeting notes and get a saved checklist of tasks, owners, and deadlines. Check off completed tasks or reopen them. The original notes and the model’s extracted fields stay as submitted and returned.

## Run locally

You’ll need **Node.js 24** and npm. SQLite is built into Node, so there is no database server to install. Open a terminal in the unzipped project folder.

```sh
npm ci
cp .env.example .env.local
```

Create a key in [Groq Console](https://console.groq.com/keys), then put it in `LLM_API_KEY` in `.env.local`. The example config uses GPT-OSS 20B, which is listed in [Groq’s free-tier limits](https://console.groq.com/docs/rate-limits). Keep the key in this server-side file.

```sh
npm run dev
```

Open [http://127.0.0.1:3000](http://127.0.0.1:3000). Select **Use example** or paste your own notes, extract, then check off an item and refresh. The SQLite file is created at `data/action-items.sqlite` and reused across restarts. Set `DATABASE_PATH` to use a separate file.

For a production build, run `npm run build` followed by `npm start`. Use this mode to measure latency without development compilation.

### Run with a local model

With [Ollama](https://ollama.com/download) running, pull a small instruction model:

```sh
ollama pull qwen2.5:1.5b-instruct
```

Set these values in `.env.local` and restart the app. The base URL should end in `/v1`.

```dotenv
LLM_BASE_URL=http://127.0.0.1:11434/v1
LLM_MODEL=qwen2.5:1.5b-instruct
LLM_API_KEY=
```

Any compatible server supporting chat completions and JSON object mode can be used. The live checks used [llama.cpp](https://github.com/ggml-org/llama.cpp) with a Qwen2.5 1.5B Instruct model and the same request format. Give a local model a short warmup request. If it needs more time, set `EXTRACTION_TIMEOUT_MS=5000` for local evaluation. That intentionally relaxes the two-second target.

## API and data

- **`POST /notes/extract`** accepts `{"text":"Ana will check export timings by Friday."}`. The server asks the configured LLM for `{"items":[{"title":"Check export timings","owner":"Ana","due":"Friday"}]}`. A successful response is HTTP 201 with a `note` containing `id`, `text`, `createdAt`, and `items`. Missing owners and deadlines are `null`; a valid empty list saves the note with zero items. Relative deadlines stay as written.
- **`GET /api/notes`** returns saved notes with their items, newest first.
- **`PATCH /api/items/:id`** accepts only `{"done":true}` or `{"done":false}`. The app has no endpoint for editing extracted content.

The server validates the entire model result before opening a SQLite transaction. Missing fields, extra fields, incomplete output, or a malformed item reject the whole extraction. Inserting the note and every item is one transaction. Invalid input returns 400, unusable output returns 422, a provider failure returns 502, and a deadline returns 504. Missing provider configuration returns 503. A write failure returns 500 and rolls back any partial insert. The UI keeps the text available to retry after an error.

Each extraction request writes a JSON log line to the server terminal with the original `noteText`, full `rawResponse` body and exact `modelOutput` when received, timing, outcome, and a request ID. If a response stops midway, the line records the received prefix and flags it as truncated. Failed extraction data stays out of SQLite. **The logs contain meeting content.** Keep them local and use sample notes for review. The app sends notes to the provider configured in `.env.local`.

## Checks

```sh
npm run lint
npm test
```

The test command builds the app and starts it on a temporary port against a local provider fixture. It needs no API key. It covers the exact extraction endpoint, invalid output and timeout rejection, preservation of the raw audit response, completion-only updates, and persistence after a restart. The fixture lives in the test suite. The normal app always calls the configured model.

The extraction budget defaults to **1,700 ms** from handler entry, with time left for validation, a small local transaction, and the HTTP response. The server aborts slow upstream work and skips automatic retries. A provider’s queue, cold start, or a long output can exceed the budget, so a slow extraction returns an error instead of keeping the user waiting indefinitely.

### Live model check

On an M1 Pro, the production build saved three short notes through Qwen2.5-1.5B in **128–919 ms**. A long note timed out at **1,710 ms**, with no new database record. Both full assignment samples reached the default deadline and returned HTTP 504 in about 1.8 seconds. With the deadline relaxed, this small model also made ownership and deadline mistakes. It works as a key-free smoke test. I’d use the configured Groq model for reviewing the longer samples and measure its latency with a key.

## Tradeoffs

**With a full week.** I’d build a small labeled set from real team notes and measure missed actions, misattributed owners and deadlines, and p50/p95 response times against a few providers. That would inform the model and deadline. I’d also add access control and agree on retention for the full-text debug logs before opening the app to a team.

**Decision I’m least confident about.** A single hard deadline gives the UI a predictable response time, but it can discard useful work on a slow provider. I’d check whether users prefer a fast retry or a longer wait for larger notes. Schema validation catches broken structure. Checking that a task is actually grounded in the notes still needs model evaluation.

**Deliberately skipped.** Accounts and team management. They do not help assess the extraction path in this take-home, and the app binds to loopback for review. A shared deployment needs authentication and access control for both the saved notes and the logs.

AI tools assisted with implementation, tests, and documentation. The test suite is included so the behavior can be verified independently.
