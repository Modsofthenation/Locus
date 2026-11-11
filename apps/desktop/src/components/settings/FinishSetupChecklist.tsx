import type { SetupStatus } from "@locus/shared";
import { setupTodos } from "@locus/shared";
import type { ReactNode } from "react";
import { SetupBanner } from "@/components/layout/SetupBanner";

type ChecklistTodo = {
  id: string;
  label: string;
  done: boolean;
  optional?: boolean;
};

export const FINISH_SETUP_DISMISSED_KEY = "locus.finishSetupDismissed";

export function loadFinishSetupDismissed(
  storage: Pick<Storage, "getItem"> | undefined = globalThis.localStorage,
): boolean {
  return storage?.getItem(FINISH_SETUP_DISMISSED_KEY) === "1";
}

export function saveFinishSetupDismissed(
  dismissed: boolean,
  storage: Pick<Storage, "setItem" | "removeItem"> | undefined = globalThis.localStorage,
): void {
  if (!storage) return;
  if (dismissed) storage.setItem(FINISH_SETUP_DISMISSED_KEY, "1");
  else storage.removeItem(FINISH_SETUP_DISMISSED_KEY);
}

function remainingSummary(todos: ChecklistTodo[]): string {
  const open = todos.filter((row) => !row.done);
  const required = open.filter((row) => !row.optional);
  return (required.length ? required : open).map((row) => row.label).join(", ");
}

export function FinishSetupChecklist({
  setup,
  onFinish,
  extras,
  extraActions,
  dismissed,
  onDismiss,
}: {
  setup: SetupStatus;
  onFinish: () => void;
  extras?: ChecklistTodo[];
  extraActions?: ReactNode;
  dismissed?: boolean;
  onDismiss?: () => void;
}) {
  if (!setup.setupCompleted || dismissed) return null;
  const todos = [...setupTodos(setup), ...(extras ?? [])];
  if (todos.every((row) => row.done) && !extraActions) return null;
  const summary = remainingSummary(todos);
  return (
    <SetupBanner
      title="Finish setup"
      detail={summary || undefined}
      testId="finish-setup-checklist"
      onDismiss={onDismiss}
    >
      {extraActions}
      <button type="button" className="btn small primary" onClick={onFinish}>
        Continue
      </button>
    </SetupBanner>
  );
}
