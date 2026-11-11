export const MAX_NOTE_LENGTH = 12_000;

export type ExtractedItem = {
  title: string;
  owner: string | null;
  due: string | null;
};

export type ActionItem = ExtractedItem & {
  id: string;
  done: boolean;
};

export type Note = {
  id: string;
  text: string;
  createdAt: string;
  items: ActionItem[];
};
