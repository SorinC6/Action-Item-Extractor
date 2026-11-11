"use client";

import {
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import { MAX_NOTE_LENGTH, type ActionItem, type Note } from "../lib/contracts";

const example = `weekly sync tues

- deploy went out friday, mostly fine. two customers hit the timeout thing again. Ana is going to look at the retry logic, thinks it's the connection pool not the retries themselves
- Q3 numbers are in the shared drive, everyone please actually read them before next week
- new starter begins the 14th. someone needs to sort the laptop and the accounts, Tomaz said he'd do accounts but not the laptop
- billing page redesign -- still blocked on copy from marketing. Marko is chasing, said he'd have an answer by Friday
- we skipped the retro again. Let's not skip it again.
- Ana raised that the staging db hasn't been reset since June and it's getting slow. no owner on this yet`;

const icons = {
  arrow: <path d="M5 12h14m-6-6 6 6-6 6" />,
  calendar: (
    <>
      <rect x="4" y="6" width="16" height="14" rx="2" />
      <path d="M8 4v4m8-4v4M4 10h16" />
    </>
  ),
  check: <path d="m5 12 4 4L19 6" />,
  clipboard: (
    <>
      <path d="M9 6H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-3" />
      <rect x="9" y="3" width="6" height="5" rx="1" />
    </>
  ),
  info: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 11v5m0-8h.01" />
    </>
  ),
  list: (
    <>
      <rect x="4" y="3.5" width="16" height="17" rx="3" />
      <path d="m7.5 9 1.5 1.5 2-2.5M13.5 9H17m-9 6h1m4.5 0H17" />
    </>
  ),
  person: (
    <>
      <circle cx="12" cy="8" r="3" />
      <path d="M5 19v-1a4 4 0 0 1 4-4h6a4 4 0 0 1 4 4v1" />
    </>
  ),
} satisfies Record<string, ReactNode>;

function Icon({ name, size = 18 }: { name: keyof typeof icons; size?: number }) {
  return (
    <svg
      aria-hidden="true"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {icons[name]}
    </svg>
  );
}

const filters = [
  { value: "all", label: "All" },
  { value: "open", label: "Open" },
  { value: "done", label: "Done" },
] as const;

type Filter = (typeof filters)[number]["value"];

const numberFormat = new Intl.NumberFormat("en-US");
const sourceDateFormat = new Intl.DateTimeFormat("en", {
  month: "short",
  day: "numeric",
  year: "numeric",
});
const dueDateFormat = new Intl.DateTimeFormat("en", {
  month: "short",
  day: "numeric",
  year: "numeric",
  timeZone: "UTC",
});

function getDueLabel(due: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(due)) return due;
  const date = new Date(`${due}T00:00:00Z`);
  return Number.isNaN(date.getTime()) ? due : dueDateFormat.format(date);
}

function replaceItem(notes: Note[], item: ActionItem) {
  return notes.map((note) => ({
    ...note,
    items: note.items.map((entry) => (entry.id === item.id ? item : entry)),
  }));
}

async function readResponse<T>(response: Response, fallbackError: string): Promise<T> {
  const data = await response.json().catch(() => null);
  if (!response.ok || !data) {
    throw new Error(typeof data?.error === "string" ? data.error : fallbackError);
  }
  return data as T;
}

export default function Workspace() {
  const [text, setText] = useState("");
  const [notes, setNotes] = useState<Note[]>([]);
  const [loadingNotes, setLoadingNotes] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState("");
  const [formStatus, setFormStatus] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [pendingItems, setPendingItems] = useState<Set<string>>(new Set());
  const [itemError, setItemError] = useState("");
  const [itemStatus, setItemStatus] = useState("");
  const textArea = useRef<HTMLTextAreaElement>(null);
  const form = useRef<HTMLFormElement>(null);
  const submittingRef = useRef(false);
  const pendingItemsRef = useRef(new Set<string>());
  const filterButtons = useRef<Partial<Record<Filter, HTMLButtonElement>>>({});

  useEffect(() => {
    const controller = new AbortController();

    async function loadNotes() {
      try {
        const response = await fetch("/api/notes", { signal: controller.signal });
        const data = await readResponse<{ notes: Note[] }>(
          response,
          "Couldn’t load saved action items.",
        );
        if (controller.signal.aborted) return;
        setNotes((current) => {
          const knownIds = new Set(current.map((note) => note.id));
          return [...current, ...data.notes.filter((note) => !knownIds.has(note.id))];
        });
      } catch (error) {
        if (controller.signal.aborted) return;
        setLoadError(error instanceof Error ? error.message : "Couldn’t load saved action items.");
      } finally {
        if (!controller.signal.aborted) setLoadingNotes(false);
      }
    }

    void loadNotes();
    return () => controller.abort();
  }, [loadAttempt]);

  function updateText(value: string) {
    setText(value);
    setFormError("");
    setFormStatus("");
  }

  async function pasteNotes() {
    try {
      const pasted = await navigator.clipboard.readText();
      const field = textArea.current;
      if (!field) return;
      const { selectionStart, selectionEnd, value } = field;
      const nextText = value.slice(0, selectionStart) + pasted + value.slice(selectionEnd);
      if (nextText.length > MAX_NOTE_LENGTH) {
        setFormError(`Notes can contain up to ${numberFormat.format(MAX_NOTE_LENGTH)} characters.`);
        return;
      }
      updateText(nextText);
      field.focus();
      requestAnimationFrame(() => {
        const cursor = selectionStart + pasted.length;
        field.setSelectionRange(cursor, cursor);
      });
    } catch {
      setFormError("Clipboard unavailable. Paste directly into the notes field.");
      textArea.current?.focus();
    }
  }

  async function extract(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!text.trim() || submittingRef.current) return;
    const submittedText = text;
    submittingRef.current = true;
    setSubmitting(true);
    setFormError("");
    setFormStatus("");

    try {
      const response = await fetch("/notes/extract", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: submittedText }),
      });
      const { note } = await readResponse<{ note: Note }>(
        response,
        "Couldn’t extract action items. Try again.",
      );
      setNotes((current) => [note, ...current.filter(({ id }) => id !== note.id)]);
      setText((current) => (current === submittedText ? "" : current));
      setFilter("all");
      const count = note.items.length;
      setFormStatus(
        count === 0
          ? "Notes saved. No action items found."
          : `Saved ${count} action ${count === 1 ? "item" : "items"}.`,
      );
    } catch (error) {
      setFormError(error instanceof Error ? error.message : "Couldn’t extract action items.");
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
    }
  }

  async function toggleItem(item: ActionItem, checkbox: HTMLInputElement) {
    if (pendingItemsRef.current.has(item.id)) return;
    pendingItemsRef.current.add(item.id);
    setPendingItems(new Set(pendingItemsRef.current));
    setItemError("");
    setItemStatus("");
    const updated = { ...item, done: !item.done };
    if (filter !== "all" && document.activeElement === checkbox) {
      filterButtons.current[filter]?.focus();
    }
    setNotes((current) => replaceItem(current, updated));

    try {
      const response = await fetch(`/api/items/${encodeURIComponent(item.id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ done: updated.done }),
      });
      const { item: savedItem } = await readResponse<{ item: ActionItem }>(
        response,
        "Couldn’t update the action item. Try again.",
      );
      setNotes((current) => replaceItem(current, savedItem));
      setItemStatus(savedItem.done ? "Action item marked done." : "Action item reopened.");
    } catch (error) {
      setNotes((current) => replaceItem(current, item));
      setItemError(error instanceof Error ? error.message : "Couldn’t update the action item.");
    } finally {
      pendingItemsRef.current.delete(item.id);
      setPendingItems(new Set(pendingItemsRef.current));
    }
  }

  const items = notes.flatMap((note) => note.items);
  const doneCount = items.filter(({ done }) => done).length;
  const counts = { all: items.length, open: items.length - doneCount, done: doneCount };
  const visibleNotes = notes
    .map((note) => ({
      ...note,
      items: note.items.filter(({ done }) => filter === "all" || done === (filter === "done")),
    }))
    .filter((note) => note.items.length > 0);

  return (
    <div className="workspace">
      <section className="panel composer" aria-labelledby="notes-heading">
        <form ref={form} onSubmit={extract}>
          <div className="panel-heading">
            <h2 id="notes-heading">
              <label htmlFor="meeting-notes">Meeting notes</label>
            </h2>
            <div className="composer-tools">
              {text.length ? (
                <button
                  type="button"
                  className="text-button"
                  onClick={() => {
                    updateText("");
                    textArea.current?.focus();
                  }}
                >
                  Clear
                </button>
              ) : (
                <button
                  type="button"
                  className="text-button"
                  onClick={() => {
                    updateText(example);
                    textArea.current?.focus();
                  }}
                >
                  Use example
                </button>
              )}
              <button type="button" className="secondary-button" onClick={pasteNotes}>
                <Icon name="clipboard" size={15} />
                Paste
              </button>
            </div>
          </div>
          <div className="editor">
            <textarea
              id="meeting-notes"
              ref={textArea}
              value={text}
              maxLength={MAX_NOTE_LENGTH}
              aria-describedby="character-count note-notice"
              placeholder="Paste a transcript, rough bullets, or meeting notes…"
              onChange={(event) => updateText(event.target.value)}
              onKeyDown={(event) => {
                if (
                  event.key === "Enter" &&
                  !event.nativeEvent.isComposing &&
                  (event.metaKey || event.ctrlKey)
                ) {
                  event.preventDefault();
                  form.current?.requestSubmit();
                }
              }}
            />
            <div id="character-count" className="character-count">
              {numberFormat.format(text.length)} / {numberFormat.format(MAX_NOTE_LENGTH)} characters
            </div>
          </div>
          <p id="note-notice" className="note-notice">
            <Icon name="info" size={16} />
            <span>Notes are sent to the configured AI model and logged for debugging.</span>
          </p>
          {formError && (
            <p className="message error" role="alert">
              {formError}
            </p>
          )}
          <div className="composer-footer">
            <p className="form-status" role="status">{formStatus}</p>
            <button
              type="submit"
              className="primary-button"
              disabled={!text.trim() || submitting}
            >
              {submitting ? "Extracting…" : "Extract action items"}
              {submitting ? <span className="spinner" aria-hidden="true" /> : <Icon name="arrow" />}
            </button>
          </div>
        </form>
      </section>

      <section className="panel results" aria-labelledby="actions-heading">
        <div className="panel-heading">
          <h2 id="actions-heading">Action items</h2>
        </div>
        <div className="results-body">
          {items.length > 0 && (
            <div className="filters" role="group" aria-label="Filter action items">
              {filters.map(({ value, label }) => (
                <button
                  key={value}
                  type="button"
                  aria-pressed={filter === value}
                  ref={(button) => {
                    if (button) filterButtons.current[value] = button;
                  }}
                  onClick={() => setFilter(value)}
                >
                  {label} <span>{counts[value]}</span>
                </button>
              ))}
            </div>
          )}

          {loadError && (
            <div className="message error list-message" role="alert">
              <span>{loadError}</span>
              <button
                type="button"
                className="text-button"
                onClick={() => {
                  setLoadError("");
                  setLoadingNotes(true);
                  setLoadAttempt((attempt) => attempt + 1);
                }}
              >
                Retry
              </button>
            </div>
          )}
          {itemError && <p className="message error list-message" role="alert">{itemError}</p>}
          <span className="sr-only" role="status">{itemStatus}</span>

          {visibleNotes.length > 0 ? (
            <div className="note-groups">
              {visibleNotes.map((note) => (
                <section className="note-group" key={note.id} aria-labelledby={`note-${note.id}`}>
                  <h3 id={`note-${note.id}`} className="note-source">
                    <span>{note.text.trim().split("\n")[0]}</span>
                    <time dateTime={note.createdAt}>
                      {sourceDateFormat.format(new Date(note.createdAt))}
                    </time>
                  </h3>
                  <ul className="item-list">
                    {note.items.map((item) => (
                      <li className="item-row" key={item.id} data-done={item.done}>
                        <label className="item-label">
                          <input
                            className="item-checkbox"
                            type="checkbox"
                            checked={item.done}
                            aria-disabled={pendingItems.has(item.id)}
                            onChange={(event) => void toggleItem(item, event.currentTarget)}
                          />
                          <span className="item-checkmark" aria-hidden="true">
                            <Icon name="check" size={13} />
                          </span>
                          <span className="item-title">{item.title}</span>
                        </label>
                        <div className="item-details">
                          <span>
                            <Icon name="person" size={15} />
                            {item.owner || "Unassigned"}
                          </span>
                          <span>
                            <Icon name="calendar" size={15} />
                            {item.due ? getDueLabel(item.due) : "No due date"}
                          </span>
                        </div>
                      </li>
                    ))}
                  </ul>
                </section>
              ))}
            </div>
          ) : (
            <div className="empty">
              <span className="empty-icon" aria-hidden="true">
                {loadingNotes ? <span className="spinner" /> : <Icon name="list" size={27} />}
              </span>
              <p className="empty-title">
                {loadingNotes
                  ? "Loading action items…"
                  : loadError
                    ? "Saved items are unavailable"
                    : filter === "open"
                      ? "No open action items"
                      : filter === "done"
                        ? "No completed action items"
                        : "No action items yet"}
              </p>
              {!loadingNotes && !loadError && filter === "all" && (
                <p>Extract your meeting notes to see tasks, owners, and due dates here.</p>
              )}
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
