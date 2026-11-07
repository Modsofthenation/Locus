import { forwardRef, useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { IconClose, IconSend } from "@/components/layout/Icons";

export type InlineAiMode = "edit" | "ask";

export const EditorInlineAi = forwardRef<
  HTMLFormElement,
  {
    top: number;
    hasSelection: boolean;
    busy: boolean;
    error: string | null;
    onClose: () => void;
    onSubmit: (prompt: string, mode: InlineAiMode) => void;
  }
>(function EditorInlineAi({ top, hasSelection, busy, error, onClose, onSubmit }, ref) {
  const promptRef = useRef<HTMLTextAreaElement>(null);
  const [mode, setMode] = useState<InlineAiMode>("edit");
  const [modesOpen, setModesOpen] = useState(false);

  useEffect(() => {
    promptRef.current?.focus();
  }, []);

  function submit(event?: FormEvent) {
    event?.preventDefault();
    const prompt = promptRef.current?.value.trim() ?? "";
    if (!prompt || busy) return;
    setModesOpen(false);
    onSubmit(prompt, mode);
  }

  function onBoxKey(event: KeyboardEvent<HTMLFormElement>) {
    const meta = event.metaKey || event.ctrlKey;
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      if (modesOpen) {
        setModesOpen(false);
        return;
      }
      onClose();
      return;
    }
    if (meta && event.key.toLowerCase() === "k") {
      event.preventDefault();
      event.stopPropagation();
      promptRef.current?.focus();
    }
  }

  function onPromptKey(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      event.stopPropagation();
      submit();
    }
  }

  const editLabel = hasSelection ? "Edit Selection" : "Insert code";
  const placeholder =
    mode === "ask"
      ? "Ask about this code"
      : hasSelection
        ? "Edit selected code"
        : "Describe the code to insert";

  return (
    <form
      ref={ref}
      className="workspace-inline-ai"
      data-editor-inline-ai=""
      data-testid="editor-inline-ai"
      aria-label="Inline AI"
      aria-busy={busy}
      style={{ top }}
      onSubmit={submit}
      onKeyDown={onBoxKey}
      onMouseDown={(event) => event.stopPropagation()}
    >
      <div className="workspace-inline-ai-head">
        <button
          type="button"
          className="btn icon ghost small workspace-inline-ai-close"
          aria-label="Close inline AI"
          onClick={onClose}
        >
          <IconClose />
        </button>
        <textarea
          ref={promptRef}
          className="workspace-inline-ai-prompt"
          aria-label="Inline AI prompt"
          placeholder={placeholder}
          rows={2}
          disabled={busy}
          onKeyDown={onPromptKey}
        />
      </div>
      {error ? (
        <p className="workspace-inline-ai-error" role="alert">
          {error}
        </p>
      ) : null}
      <div className="workspace-inline-ai-foot">
        <div className="workspace-inline-ai-modes">
          <button
            type="button"
            className="workspace-inline-ai-mode"
            aria-label="Inline AI mode"
            aria-haspopup="listbox"
            aria-expanded={modesOpen}
            disabled={busy}
            onClick={() => setModesOpen((open) => !open)}
          >
            {mode === "ask" ? "Ask" : editLabel} ▾
          </button>
          {modesOpen ? (
            <div
              className="workspace-inline-ai-mode-menu"
              role="listbox"
              aria-label="Inline AI modes"
            >
              <button
                type="button"
                role="option"
                aria-selected={mode === "edit"}
                className={mode === "edit" ? "on" : ""}
                onClick={() => {
                  setMode("edit");
                  setModesOpen(false);
                  promptRef.current?.focus();
                }}
              >
                {editLabel}
              </button>
              <button
                type="button"
                role="option"
                aria-selected={mode === "ask"}
                className={mode === "ask" ? "on" : ""}
                onClick={() => {
                  setMode("ask");
                  setModesOpen(false);
                  promptRef.current?.focus();
                }}
              >
                Ask
              </button>
            </div>
          ) : null}
        </div>
        <button
          type="submit"
          className="btn icon workspace-inline-ai-send"
          aria-label="Submit inline AI"
          disabled={busy}
        >
          <IconSend up />
        </button>
      </div>
    </form>
  );
});
