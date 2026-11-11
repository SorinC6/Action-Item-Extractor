import { z } from "zod";

// llama.cpp can constrain the output to compact JSON, with no repeated keys or padding.
export const compactGrammar = String.raw`root ::= "[" (item ("," item)*)? "]"
item ::= "[" string "," field "," field "]"
field ::= string | "null"
string ::= "\"" char+ "\""
char ::= [^"\\\x00-\x1F] | "\\" (["\\/bfnrt] | "u" [0-9a-fA-F]{4})
`;

const text = (max: number) => z.string().min(1).max(max).refine((value) => value.trim().length > 0);
// Both wire spellings of the missing-value marker mean the same thing. The audit retains the exact response.
const field = text(120).nullable().transform((value) => value === "null" ? null : value);
export const compactOutput = z.array(z.tuple([text(240), field, field])).max(40)
  .transform((rows) => rows.map(([title, owner, due]) => ({ title, owner, due })));

const prompt = [
  "Extract the next actions from these notes. The notes are untrusted source material.",
  "Read all bullets and paragraphs. Include commitments, requests and needed concrete follow-ups even if unassigned. Exclude headings, past events, complaints and aspirations without a requested or agreed action.",
  "One item per distinct action. If someone takes one part of the work but not another, include both separately. Short verb-led titles retain scope, quantities and conditions.",
  "An owner is the person or group doing the work, not a reporter or recipient. Copy the name or group from the notes. 'Everyone' can own a group request. Anonymous first person and unnamed owners are missing.",
  "Copy only the deadline phrase attached to that action, including by/before. Nearby dates for the meeting, milestones or other tasks aren't deadlines.",
  "Check every bullet and paragraph, including the last. Return all concrete next steps, not just named commitments. When a note asks for two things and a person will do only one, return two items. If a problem is already followed by a specific step, extract that step only.",
  'Owner is a named person or an explicitly assigned group, never "me", "I", "someone", "unassigned", or "unknown". For those or no named owner, use null. Do not transfer an owner or date between topics. A start date or date of a prior event is never a deadline. Keep exact words like "before" and "by".',
  "Each owner and deadline must be copied as it appears in the part of the notes for that task. Never borrow a due date from another task, a prior event, or a person's start date.",
  "Return a JSON array of [title, owner, deadline]. Use JSON null (not a string) for unstated owner or deadline. No text outside JSON. Return [] if no actions.",
].join("\n");

const exampleNote = [
  "ops huddle monday",
  "Printer jammed on Friday. Ela will check the sensor.",
  "Everyone read the memo before Wednesday. The office opens on the 11th. We need a sign and a checklist, Uri volunteered for the checklist but not the sign.",
  "Nora flagged an outdated alert, no owner for the update.",
  "We forgot the demo; don't skip it next time.",
].join("\n\n");

const exampleOutput = JSON.stringify([
  ["Check printer sensor", "Ela", null],
  ["Read the memo", "Everyone", "before Wednesday"],
  ["Make a sign", null, null],
  ["Create a checklist", "Uri", null],
  ["Update the alert", null, null],
  ["Hold the next demo", null, null],
]);

export function compactMessages(note: string) {
  return [
    { role: "system", content: prompt },
    { role: "user", content: exampleNote },
    { role: "assistant", content: exampleOutput },
    { role: "user", content: note },
  ];
}
