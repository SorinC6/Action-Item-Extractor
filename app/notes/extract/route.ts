import { randomUUID } from "node:crypto";
import { z } from "zod";
import { MAX_NOTE_LENGTH } from "@/lib/contracts";
import { saveExtraction } from "@/lib/db";
import {
  DEFAULT_TIMEOUT_MS,
  ExtractionError,
  extractItems,
  timeoutError,
  type ExtractionAudit,
} from "@/lib/extractor";
import { jsonError, readJsonRequest, RequestBodyError } from "@/lib/http";

export const runtime = "nodejs";

const requestSchema = z.strictObject({
  text: z.string().max(MAX_NOTE_LENGTH).refine((text) => text.trim().length > 0),
});

export async function POST(request: Request) {
  const startedAt = performance.now();
  const requestId = randomUUID();
  const audit: ExtractionAudit = {
    model: null, providerStatus: null, rawResponse: null, rawResponseTruncated: false, modelOutput: null,
  };
  let noteText: string | null = null;
  let outcome = "invalid_request";
  let detail: string | undefined;
  let noteId: string | undefined;
  let itemCount: number | undefined;

  try {
    const bodySignal = AbortSignal.any([AbortSignal.timeout(DEFAULT_TIMEOUT_MS), request.signal]);
    let body: unknown;
    try {
      // A UTF-16 code unit can use up to six bytes when escaped in JSON.
      body = await readJsonRequest(request, MAX_NOTE_LENGTH * 6 + 1024, bodySignal);
    } catch (error) {
      if (bodySignal.aborted) throw timeoutError();
      throw error;
    }
    if (typeof body === "object" && body !== null && "text" in body && typeof body.text === "string") {
      noteText = body.text;
    }

    const input = requestSchema.safeParse(body);
    if (!input.success) {
      throw new RequestBodyError(`Provide meeting notes as text with 1 to ${MAX_NOTE_LENGTH.toLocaleString("en-US")} characters.`);
    }

    const items = await extractItems(input.data.text, startedAt, request.signal, audit);
    const note = saveExtraction(input.data.text, items);
    outcome = "saved";
    noteId = note.id;
    itemCount = note.items.length;
    return Response.json({ note }, { status: 201, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof RequestBodyError) return jsonError(error.message, error.status);
    if (error instanceof ExtractionError) {
      outcome = error.outcome;
      detail = error.detail;
      return jsonError(error.message, error.status);
    }
    outcome = "storage_error";
    detail = error instanceof Error ? error.message : "Unknown storage error.";
    return jsonError("The extraction could not be saved. Try again.", 500);
  } finally {
    console.info(JSON.stringify({
      event: "note_extraction",
      at: new Date().toISOString(),
      requestId,
      noteText,
      ...audit,
      outcome,
      elapsedMs: Math.round(performance.now() - startedAt),
      detail,
      noteId,
      itemCount,
    }));
  }
}
