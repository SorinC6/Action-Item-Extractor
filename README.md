# Action Item Extractor

Paste rough meeting notes and get a saved checklist of tasks, owners, and deadlines. Check off completed tasks or reopen them. The original notes and the extracted fields are preserved.

## Run locally

You’ll need **Node.js 24** and npm. SQLite is built into Node, so there is no database server to install. Open a terminal in the unzipped project folder.

```sh
npm ci
cp .env.example .env.local
```

For the hosted option, put your [Groq key](https://console.groq.com/keys) in `LLM_API_KEY` in `.env.local`. The example uses GPT-OSS 20B, which is listed in [Groq’s free-tier limits](https://console.groq.com/docs/rate-limits). For the measured setup without an API key, use the local model below.

```sh
npm run dev
```

Open [http://127.0.0.1:3000](http://127.0.0.1:3000). Select **Use example** or paste your own notes, extract, then check off an item and refresh. The SQLite file is created at `data/action-items.sqlite` and reused across restarts. Set `DATABASE_PATH` to use a separate file.

For a production build, run `npm run build` followed by `npm start`. Use this mode to measure latency without development compilation.

### Run with the verified local model

Download [llama.cpp b12283](https://github.com/ggml-org/llama.cpp/releases/tag/b12283) for your OS and these two matching model files (about 4.7 GB total): [Gemma 4 E4B IT Q4_0](https://huggingface.co/ggml-org/gemma-4-E4B-it-GGUF/resolve/27cd6836f8e2a6e5e6b57ea0e77fa72490706985/gemma-4-E4B-it-Q4_0.gguf) and its [draft model](https://huggingface.co/ggml-org/gemma-4-E4B-it-GGUF/resolve/27cd6836f8e2a6e5e6b57ea0e77fa72490706985/mtp-gemma-4-E4B-it-Q4_0.gguf). From the directory containing the two files, run this with `llama-server` on your path:

```sh
llama-server -m gemma-4-E4B-it-Q4_0.gguf -md mtp-gemma-4-E4B-it-Q4_0.gguf \
  --spec-type draft-mtp --spec-draft-n-max 6 --reasoning off \
  --host 127.0.0.1 --port 11441 --alias gemma-4-e4b --offline --no-webui \
  --n-gpu-layers all --parallel 1 -c 8192 --swa-full --cache-ram 0 --ctx-checkpoints 0
```

In the app's `.env.local`, set:

```dotenv
LLM_BASE_URL=http://127.0.0.1:11441/v1
LLM_MODEL=gemma-4-e4b
LLM_OUTPUT_MODE=llama-compact
LLM_API_KEY=
```

Run `npm run dev` to use the app. Before trying a full note, submit a short note such as “Mia will send the agenda by Tuesday,” or run the live check below, which warms the model for you. Other OpenAI-compatible servers can use `LLM_OUTPUT_MODE=object` with their own base URL and model.

## API and data

- **`POST /notes/extract`** accepts `{"text":"Ana will check export timings by Friday."}`. A successful response is HTTP 201 with a `note` containing `id`, `text`, `createdAt`, and `items`. Each item has `title`, `owner`, `due`, `id`, and `done`. Missing owners and deadlines are `null`; a valid empty list saves the note with zero items. Relative deadlines stay as written.
- **`GET /api/notes`** returns saved notes with their items, newest first.
- **`PATCH /api/items/:id`** accepts only `{"done":true}` or `{"done":false}`. The app has no endpoint for editing extracted content.

The server validates the entire model result before opening a SQLite transaction. Missing fields, extra fields, incomplete output, or a malformed item reject the whole extraction. Inserting the note and every item is one transaction. Invalid input returns 400, unusable output returns 422, a provider failure returns 502, and a deadline returns 504. Missing provider configuration returns 503. A write failure returns 500 and rolls back any partial insert. The UI keeps the text available to retry after an error.

Object mode returns named JSON fields. The local model returns compact `[title, owner, deadline]` rows to avoid decoding repeated keys. The server maps rows to the same API shape and treats JSON `null` and the string `"null"` as missing values in those rows. The original response is logged unchanged.

Each extraction request writes a JSON log line to the server terminal with the original `noteText`, full `rawResponse` body and exact `modelOutput` when received, timing, outcome, and a request ID. If a response stops midway, the line records the received prefix and flags it as truncated. Failed extraction data stays out of SQLite. **The logs contain meeting content.** Keep them local and use sample notes for review. The app sends notes to the provider configured in `.env.local`.

## Checks

```sh
npm run lint
npm test
```

The test command builds the app and starts it on a temporary port against a local provider fixture. It needs no API key. It covers the exact extraction endpoint, invalid output and timeout rejection, preservation of the raw audit response, completion-only updates, and persistence after a restart. The fixture lives in the test suite. The normal app always calls the configured model.

The extraction budget defaults to **1,700 ms** for object mode and **1,825 ms** for the compact local mode, leaving time for the database transaction and HTTP response. The server aborts slow upstream work and skips automatic retries. A provider’s queue, cold start, or a long output can exceed the budget.

### Live model check

With the local model running and configured in `.env.local`:

```sh
npm run test:live
```

The live check builds the production app, warms the model with a different note, then alternates the [full weekly sync](tests/fixtures/weekly-sync.txt) and [full customer call](tests/fixtures/customer-call.txt) five times each. It requires HTTP 201 in under 2 seconds, checks the tasks, owners and deadlines, and reads the saved notes back from a temporary SQLite database.

On an Apple M1 Pro with 16 GB RAM, the weekly sync returned **7 tasks in 1.59–1.64 s** and the customer call returned **3 tasks in 1.20–1.25 s**, measured from the HTTP request through the full response body. The model reuses the shared prompt prefix; every note is processed and generated anew. These are warm, serial results for this setup. Other hardware and providers can differ.

## Tradeoffs

**With a full week.** I’d build a small labeled set from real team notes and measure missed actions, misattributed owners and deadlines, and p50/p95 response times against a few providers. That would inform the model and deadline. I’d also add access control and agree on retention for the full-text debug logs before opening the app to a team.

**Decision I’m least confident about.** A single hard deadline gives the UI a predictable response time, but it can discard useful work on a slow provider. I’d check whether users prefer a fast retry or a longer wait for larger notes. Schema validation catches broken structure. Checking that a task is actually grounded in the notes still needs model evaluation.

**Deliberately skipped.** Accounts and team management. They do not help assess the extraction path in this take-home, and the app binds to loopback for review. A shared deployment needs authentication and access control for both the saved notes and the logs.

AI tools assisted with implementation, tests, and documentation. The test suite is included so the behavior can be verified independently.
