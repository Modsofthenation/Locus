import { useEffect, useState } from "react";
import {
  bindDialogHost,
  type AlertOptions,
  type ConfirmOptions,
  type PromptOptions,
} from "@/lib/dialog";
import { ConfirmModal } from "./ConfirmModal";
import { PromptModal } from "./PromptModal";

type Pending =
  | { kind: "confirm"; opts: ConfirmOptions; resolve: (ok: boolean) => void }
  | { kind: "prompt"; opts: PromptOptions; resolve: (value: string | null) => void }
  | { kind: "alert"; opts: AlertOptions; resolve: () => void };

export function DialogHost() {
  const [pending, setPending] = useState<Pending | null>(null);

  useEffect(() => {
    bindDialogHost({
      confirm: (opts) =>
        new Promise((resolve) => {
          setPending({ kind: "confirm", opts, resolve });
        }),
      prompt: (opts) =>
        new Promise((resolve) => {
          setPending({ kind: "prompt", opts, resolve });
        }),
      alert: (opts) =>
        new Promise((resolve) => {
          setPending({ kind: "alert", opts, resolve });
        }),
    });
    return () => bindDialogHost(null);
  }, []);

  if (!pending) return null;

  if (pending.kind === "confirm") {
    return (
      <ConfirmModal
        title={pending.opts.title}
        body={pending.opts.body}
        confirmLabel={pending.opts.confirmLabel ?? "OK"}
        danger={pending.opts.danger}
        onCancel={() => {
          pending.resolve(false);
          setPending(null);
        }}
        onConfirm={() => {
          pending.resolve(true);
          setPending(null);
        }}
      />
    );
  }

  if (pending.kind === "prompt") {
    return (
      <PromptModal
        title={pending.opts.title}
        body={pending.opts.body}
        value={pending.opts.value}
        confirmLabel={pending.opts.confirmLabel}
        onCancel={() => {
          pending.resolve(null);
          setPending(null);
        }}
        onConfirm={(value) => {
          pending.resolve(value);
          setPending(null);
        }}
      />
    );
  }

  return (
    <ConfirmModal
      title={pending.opts.title ?? "Notice"}
      body={pending.opts.body}
      confirmLabel="OK"
      onCancel={() => {
        pending.resolve();
        setPending(null);
      }}
      onConfirm={() => {
        pending.resolve();
        setPending(null);
      }}
    />
  );
}
