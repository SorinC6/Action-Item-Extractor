export class BodyTooLargeError extends Error {}

export async function readText(
  body: ReadableStream<Uint8Array> | null,
  maxBytes: number,
  signal?: AbortSignal,
  onText?: (chunk: string) => void,
): Promise<string> {
  signal?.throwIfAborted();
  if (!body) return "";

  const reader = body.getReader();
  const decoder = new TextDecoder();
  let size = 0;
  let text = "";

  function append(chunk: string) {
    text += chunk;
    if (chunk) onText?.(chunk);
  }

  function cancel() {
    void reader.cancel().catch(() => {});
  }

  signal?.addEventListener("abort", cancel, { once: true });
  try {
    while (true) {
      const { done, value } = await reader.read();
      signal?.throwIfAborted();
      if (done) break;

      const remaining = maxBytes - size;
      append(decoder.decode(value.subarray(0, remaining), { stream: true }));
      if (value.byteLength > remaining) {
        cancel();
        throw new BodyTooLargeError();
      }
      size += value.byteLength;
    }
  } finally {
    append(decoder.decode());
    signal?.removeEventListener("abort", cancel);
    reader.releaseLock();
  }
  return text;
}

export class RequestBodyError extends Error {
  constructor(message: string, readonly status = 400) {
    super(message);
  }
}

export async function readJsonRequest(
  request: Request,
  maxBytes: number,
  signal?: AbortSignal,
): Promise<unknown> {
  const contentType = request.headers.get("content-type")?.split(";")[0].trim().toLowerCase();
  if (contentType !== "application/json") {
    throw new RequestBodyError("Send the request as JSON.", 415);
  }

  try {
    const body = await readText(request.body, maxBytes, signal);
    return JSON.parse(body) as unknown;
  } catch (error) {
    if (signal?.aborted) throw error;
    if (error instanceof BodyTooLargeError) {
      throw new RequestBodyError("The request is too large.", 413);
    }
    throw new RequestBodyError("The request contains invalid JSON.");
  }
}

export function jsonError(error: string, status: number) {
  return Response.json({ error }, { status, headers: { "Cache-Control": "no-store" } });
}
