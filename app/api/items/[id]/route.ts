import { z } from "zod";
import { setItemDone } from "@/lib/db";
import { jsonError, readJsonRequest, RequestBodyError } from "@/lib/http";

export const runtime = "nodejs";

const completionSchema = z.strictObject({ done: z.boolean() });

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const input = completionSchema.safeParse(await readJsonRequest(request, 1024, request.signal));
    if (!input.success) return jsonError("Only a boolean done field can be updated.", 400);

    const { id } = await params;
    const item = setItemDone(id, input.data.done);
    if (!item) return jsonError("Action item not found.", 404);
    return Response.json({ item }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof RequestBodyError) return jsonError(error.message, error.status);
    console.error("Could not update action item.", error);
    return jsonError("The action item could not be updated. Try again.", 500);
  }
}
