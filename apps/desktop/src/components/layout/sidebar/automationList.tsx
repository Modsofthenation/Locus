import {
  automationLastFact,
  automationLatestRun,
  clipFact,
  formatNextFire,
  formatSchedule,
  type Automation,
  type AutomationRun,
} from "@locus/shared";
import { api } from "@/lib/api";
import { formatWhen } from "@/components/automations/Automations";
import { MenuItem, MenuSep, OverflowMenu } from "../OverflowMenu";

export function automationCardMeta(
  item: Automation,
  runs: AutomationRun[],
): { last: string | undefined; next: string } {
  const latest = automationLatestRun(runs, item.id);
  const fact = automationLastFact(item);
  const lastAt = latest?.startedAt ?? item.lastRunAt;
  const last = [lastAt ? `Last ${formatWhen(lastAt)}` : null, fact ? clipFact(fact, 48) : null]
    .filter(Boolean)
    .join(" · ");
  const next = formatNextFire(item);
  const nextLine = !item.enabled
    ? "Paused"
    : next === "On webhook"
      ? "On webhook"
      : next
        ? `Next ${formatWhen(next)}`
        : formatSchedule(item.schedule);
  return { last: last || undefined, next: nextLine };
}

export function AutomationListItem(props: {
  item: Automation;
  runs: AutomationRun[];
  selected: boolean;
  unread: boolean;
  onSelect: (id: string) => void;
  onPauseToggle: (item: Automation) => void;
  onDuplicate: (item: Automation) => void;
  onSettings: (item: Automation) => void;
  onDelete: (item: Automation) => void;
}) {
  const latest = automationLatestRun(props.runs, props.item.id);
  const card = automationCardMeta(props.item, props.runs);
  const live = latest?.status === "running" || latest?.status === "queued";
  const dot = live
    ? "running"
    : latest?.status === "failed"
      ? "error"
      : props.item.enabled
        ? "idle"
        : "stopped";
  const menu = (
    <OverflowMenu title={`More for ${props.item.name}`} toggleClassName="btn icon ghost small">
      <MenuItem onClick={() => props.onPauseToggle(props.item)}>
        {props.item.enabled ? "Pause" : "Enable"}
      </MenuItem>
      <MenuItem onClick={() => props.onDuplicate(props.item)}>Duplicate</MenuItem>
      <MenuItem onClick={() => props.onSettings(props.item)}>Settings</MenuItem>
      <MenuSep />
      <MenuItem danger onClick={() => props.onDelete(props.item)}>
        Delete
      </MenuItem>
    </OverflowMenu>
  );
  return (
    <div
      className={`session-item has-menu ${props.selected ? "active" : ""} ${props.unread ? "unread" : ""}`}
      title={props.item.name}
    >
      <button
        type="button"
        className="session-item-open"
        title={props.item.name}
        onClick={() => props.onSelect(props.item.id)}
      >
        <span className={`dot ${dot}`} />
        <span>
          <div className="title">
            <span className="title-text">{props.item.name}</span>
            {latest ? (
              <span className={`status-chip ${latest.status}`}>{latest.status}</span>
            ) : null}
            {props.unread ? <span className="unread-dot" aria-label="Unread" /> : null}
          </div>
          {card.last ? <div className="meta">{card.last}</div> : null}
          <div className="meta">{card.next}</div>
        </span>
      </button>
      {menu}
    </div>
  );
}

export async function patchListedAutomations(
  items: Automation[],
  enabled: boolean,
  dispatch: (action: { type: "automation"; automation: Automation }) => void,
): Promise<{ ok: number; failed: number; error?: string }> {
  const results = await Promise.allSettled(
    items.map((a) =>
      api.patchAutomation(a.id, { enabled }).then((automation) => {
        dispatch({ type: "automation", automation });
        return automation;
      }),
    ),
  );
  let ok = 0;
  let failed = 0;
  let error: string | undefined;
  for (const result of results) {
    if (result.status === "fulfilled") ok += 1;
    else {
      failed += 1;
      if (!error) {
        error = result.reason instanceof Error ? result.reason.message : "Could not update jobs";
      }
    }
  }
  return { ok, failed, error };
}
