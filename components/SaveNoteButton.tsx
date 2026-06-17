"use client";

// A single "save this reply to your notes" affordance under an Advisor message.
// Deliberate user save (distinct from feedback) — persists a journal note.
export interface SaveNoteButtonProps {
  saved?: boolean;
  onSave?: () => void;
}

export function SaveNoteButton({ saved = false, onSave }: SaveNoteButtonProps) {
  return (
    <div className="feedback-row">
      <button
        type="button"
        data-rating="save"
        data-active={saved}
        onClick={onSave}
        disabled={saved}
        aria-label={saved ? "Saved to your notes" : "Save to your notes"}
        title={saved ? "Saved to your notes" : "Save to your notes"}
      >
        <svg
          width="13"
          height="13"
          viewBox="0 0 24 24"
          fill={saved ? "currentColor" : "none"}
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M19 21l-7-5-7 5V5a2 2 0 012-2h10a2 2 0 012 2z" />
        </svg>
        <span className="fb-label">{saved ? "Saved" : "Save"}</span>
      </button>
    </div>
  );
}
