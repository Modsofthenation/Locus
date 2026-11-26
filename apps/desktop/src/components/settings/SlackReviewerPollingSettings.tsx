import { useEffect, useState } from "react";
import {
  clampSlackReviewerPolling,
  formatSlackPollInterval,
  parseSlackReviewerPolling,
  SLACK_REVIEWER_POLLING_LIMITS,
  type SlackReviewer,
  type SlackReviewerPollMode,
  type SlackReviewerPollStatus,
  type SlackReviewerPolling,
  type SlackReviewerPollingNumberField,
} from "@locus/shared";
import { Select, type SelectOption } from "@/components/layout/Select";
import { SettingsToggleRow } from "./SettingsBits";

const MODE_OPTIONS: SelectOption<SlackReviewerPollMode>[] = [
  {
    value: "fixed",
    label: "Fixed",
    hint: "Every read runs at the interval below.",
  },
  {
    value: "adaptive",
    label: "Adaptive",
    hint: "Slows down while nothing happens, back to the interval below as soon as something does.",
  },
  {
    value: "smart",
    label: "Smart",
    hint: "Adaptive, plus full speed while a review runs and slowest outside active hours.",
  },
];

const HOUR_OPTIONS: SelectOption[] = Array.from({ length: 25 }, (_, hour) => ({
  value: String(hour),
  label: `${String(hour).padStart(2, "0")}:00`,
}));

/** Reviews → Diagnostics → Polling: one policy for every reviewer. */
export function SlackReviewerPollingSettings(props: {
  polling: SlackReviewerPolling | undefined;
  /** What each enabled reviewer polls at now, from the server. */
  status?: Record<string, SlackReviewerPollStatus>;
  reviewers: SlackReviewer[];
  onChange: (next: SlackReviewerPolling) => void;
}) {
  const polling = props.polling ?? parseSlackReviewerPolling(undefined);
  const patch = (next: Partial<SlackReviewerPolling>) => props.onChange({ ...polling, ...next });
  const adaptive = polling.mode !== "fixed";
  const modeLabel = MODE_OPTIONS.find((row) => row.value === polling.mode)?.label;
  const rows = props.reviewers.filter((row) => props.status?.[row.id]);

  return (
    <details className="slack-reviewer-details" data-testid="slack-reviewer-polling">
      <summary>
        Polling · {modeLabel} · channels every {polling.channelSec}s
        {adaptive
          ? ` (up to ${formatSlackPollInterval(polling.channelSec * 1_000 * polling.maxBackoff)})`
          : ""}
      </summary>
      <p className="hint">
        How often reviewers read Slack and your Git host. With Socket Mode on, new messages are read
        as they arrive and the channel and threads are only swept every 5 and 10 minutes in case an
        event was missed; these settings apply when it is off or quiet. Auto-review always polls.
      </p>
      <div className="field">
        <label htmlFor="reviewer-poll-mode">Mode</label>
        <Select
          id="reviewer-poll-mode"
          ariaLabel="Polling mode"
          testId="slack-reviewer-poll-mode"
          value={polling.mode}
          options={MODE_OPTIONS}
          onChange={(mode) => patch({ mode })}
        />
        <span className="hint">{MODE_OPTIONS.find((row) => row.value === polling.mode)?.hint}</span>
      </div>
      <div className="grid-2">
        <PollNumber
          label="Channel, seconds"
          field="channelSec"
          value={polling.channelSec}
          hint="One Slack call per reviewer each time."
          onCommit={(channelSec) => patch({ channelSec })}
        />
        <PollNumber
          label="Review threads, seconds"
          field="threadSec"
          value={polling.threadSec}
          hint="One Slack call per watched thread each time."
          onCommit={(threadSec) => patch({ threadSec })}
        />
        <PollNumber
          label="Auto-review repositories, minutes"
          field="autoReviewSec"
          value={Math.round(polling.autoReviewSec / 60)}
          scale={60}
          hint="One forge call per repository each time."
          onCommit={(autoReviewSec) => patch({ autoReviewSec })}
        />
        {adaptive ? (
          <PollNumber
            label="Slow down up to, ×"
            field="maxBackoff"
            value={polling.maxBackoff}
            hint={`Each quiet poll waits 1.5× longer, up to this many times the interval (channels every ${formatSlackPollInterval(polling.channelSec * 1_000 * polling.maxBackoff)} at most).`}
            onCommit={(maxBackoff) => patch({ maxBackoff })}
          />
        ) : null}
      </div>
      {polling.mode === "smart" ? (
        <>
          <div className="grid-2">
            <div className="field">
              <label htmlFor="reviewer-poll-start">Active from</label>
              <Select
                id="reviewer-poll-start"
                ariaLabel="Active hours start"
                testId="slack-reviewer-poll-start"
                value={String(polling.activeHours.start)}
                options={HOUR_OPTIONS.slice(0, 24)}
                onChange={(value) =>
                  patch({ activeHours: { ...polling.activeHours, start: Number(value) } })
                }
              />
            </div>
            <div className="field">
              <label htmlFor="reviewer-poll-end">Until</label>
              <Select
                id="reviewer-poll-end"
                ariaLabel="Active hours end"
                testId="slack-reviewer-poll-end"
                value={String(polling.activeHours.end)}
                options={HOUR_OPTIONS.slice(1)}
                onChange={(value) =>
                  patch({ activeHours: { ...polling.activeHours, end: Number(value) } })
                }
              />
            </div>
          </div>
          <SettingsToggleRow
            label="Weekdays only"
            hint="Saturday and Sunday count as outside active hours. Times are this computer's local time."
            on={polling.activeHours.weekdaysOnly}
            testId="slack-reviewer-poll-weekdays"
            onChange={(weekdaysOnly) =>
              patch({ activeHours: { ...polling.activeHours, weekdaysOnly } })
            }
          />
          <p className="hint">
            Outside active hours a quiet reviewer drops straight to its slowest interval; any new
            post or reply brings it back. While a review is queued, running, or finished in the last
            10 minutes, its threads and channel stay at full speed so replies are picked up quickly.
          </p>
        </>
      ) : null}
      {rows.length ? (
        <ul className="hint slack-reviewer-poll-status" data-testid="slack-reviewer-poll-status">
          {rows.map((reviewer) => {
            const row = props.status![reviewer.id]!;
            const parts = [
              row.channelMs !== undefined
                ? `channel every ${formatSlackPollInterval(row.channelMs)}`
                : undefined,
              row.threadsMs !== undefined
                ? `threads every ${formatSlackPollInterval(row.threadsMs)}`
                : undefined,
              row.autoReviewMs !== undefined
                ? `repos every ${formatSlackPollInterval(row.autoReviewMs)}`
                : undefined,
            ].filter(Boolean);
            const why = row.events
              ? "Socket Mode"
              : row.busy
                ? "review in progress"
                : row.offHours
                  ? "outside active hours"
                  : undefined;
            return (
              <li key={reviewer.id}>
                <strong>{reviewer.name || "PR reviewer"}</strong>: {parts.join(" · ")}
                {why ? ` (${why})` : ""}
              </li>
            );
          })}
        </ul>
      ) : null}
    </details>
  );
}

function PollNumber(props: {
  label: string;
  field: SlackReviewerPollingNumberField;
  value: number;
  /** Shown value × scale = stored value (minutes on screen, seconds stored). */
  scale?: number;
  hint?: string;
  onCommit: (value: number) => void;
}) {
  const scale = props.scale ?? 1;
  const [text, setText] = useState(String(props.value));
  useEffect(() => setText(String(props.value)), [props.value]);
  const [min, max] = SLACK_REVIEWER_POLLING_LIMITS[props.field];
  const commit = () => {
    const stored = clampSlackReviewerPolling(props.field, Number(text) * scale);
    setText(String(Math.round(stored / scale)));
    if (stored !== props.value * scale) props.onCommit(stored);
  };
  const id = `reviewer-poll-${props.field}`;
  return (
    <div className="field">
      <label htmlFor={id}>{props.label}</label>
      <input
        id={id}
        data-testid={`slack-reviewer-poll-${props.field}`}
        type="number"
        inputMode="numeric"
        min={Math.ceil(min / scale)}
        max={Math.floor(max / scale)}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") commit();
        }}
      />
      {props.hint ? <span className="hint">{props.hint}</span> : null}
    </div>
  );
}
