import { listNotes } from "@/lib/db";
import { jsonError } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET() {
  try {
    return Response.json({ notes: listNotes() }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("Could not list notes.", error);
    return jsonError("Saved action items could not be loaded. Try again.", 500);
  }
}
