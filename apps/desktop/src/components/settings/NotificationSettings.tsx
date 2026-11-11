import type { LocusConfig } from "@locus/shared";

type NotifyKey = "notifyAgents" | "notifyNeedsYou" | "notifySlack" | "notifyAutomations";

export type NotifyPrefs = Pick<
  LocusConfig,
  NotifyKey | "notifyAutomationsFailedOnly" | "notifyQuietStart" | "notifyQuietEnd"
>;

const SOURCES: {
  key: NotifyKey;
  testId: string;
  title: string;
  hint: string;
}[] = [
  {
    key: "notifyAgents",
    testId: "notify-agents",
    title: "Agent turns",
    hint: "When a turn finishes in the background.",
  },
  {
    key: "notifyNeedsYou",
    testId: "notify-needs-you",
    title: "Needs you",
    hint: "When a session is waiting for approval or an answer.",
  },
  {
    key: "notifySlack",
    testId: "notify-slack",
    title: "Slack Activity",
    hint: "Mentions, thread replies, and unread DMs.",
  },
  {
    key: "notifyAutomations",
    testId: "notify-automations",
    title: "Jobs",
    hint: "When a scheduled job finishes.",
  },
];

const DEFAULT_QUIET_START = "22:00";
const DEFAULT_QUIET_END = "08:00";

export function NotificationSettings(props: {
  prefs: NotifyPrefs;
  onChange: (patch: Partial<NotifyPrefs>) => void;
}) {
  const quietOn = Boolean(props.prefs.notifyQuietStart || props.prefs.notifyQuietEnd);
  const start = props.prefs.notifyQuietStart ?? "";
  const end = props.prefs.notifyQuietEnd ?? "";

  return (
    <div className="notify-layout">
      <p className="notify-lead">
        Desktop alerts for turns, Needs you, Slack Activity, and jobs. Permission is requested the
        first time one of these would fire — never if every source is off.
      </p>

      <section className="notify-card">
        <header className="notify-card-head">
          <div className="notify-card-copy">
            <h3>Desktop alerts</h3>
            <p>
              Each source can fire on its own. Turning every source off skips the permission prompt.
            </p>
          </div>
        </header>
        <ul className="notify-sources">
          {SOURCES.map((row) => {
            const on = props.prefs[row.key] !== false;
            return (
              <li key={row.key} className="notify-row">
                <div className="notify-row-copy">
                  <strong>{row.title}</strong>
                  <span>{row.hint}</span>
                </div>
                <button
                  type="button"
                  className={`settings-switch ${on ? "on" : ""}`}
                  role="switch"
                  aria-checked={on}
                  aria-label={row.title}
                  data-testid={row.testId}
                  onClick={() => props.onChange({ [row.key]: !on })}
                />
              </li>
            );
          })}
          {props.prefs.notifyAutomations !== false ? (
            <li className="notify-row">
              <div className="notify-row-copy">
                <strong>Failures only</strong>
                <span>Skip success alerts. Slack and notify webhooks follow this too.</span>
              </div>
              <button
                type="button"
                className={`settings-switch ${props.prefs.notifyAutomationsFailedOnly ? "on" : ""}`}
                role="switch"
                aria-checked={Boolean(props.prefs.notifyAutomationsFailedOnly)}
                aria-label="Failures only"
                data-testid="notify-automations-failed-only"
                onClick={() =>
                  props.onChange({
                    notifyAutomationsFailedOnly: !props.prefs.notifyAutomationsFailedOnly,
                  })
                }
              />
            </li>
          ) : null}
        </ul>
      </section>

      <section className="notify-card" data-testid="quiet-hours">
        <header className="notify-card-head notify-quiet-head">
          <div className="notify-card-copy">
            <h3>Quiet hours</h3>
            <p>Mute desktop alerts. Overnight ranges wrap past midnight.</p>
          </div>
          <button
            type="button"
            className={`settings-switch ${quietOn ? "on" : ""}`}
            role="switch"
            aria-checked={quietOn}
            aria-label="Quiet hours"
            data-testid="notify-quiet"
            onClick={() =>
              props.onChange(
                quietOn
                  ? { notifyQuietStart: undefined, notifyQuietEnd: undefined }
                  : {
                      notifyQuietStart: start || DEFAULT_QUIET_START,
                      notifyQuietEnd: end || DEFAULT_QUIET_END,
                    },
              )
            }
          />
        </header>
        {quietOn ? (
          <div className="notify-quiet-body">
            <div className="notify-quiet-times">
              <div className="field">
                <label htmlFor="quiet-start">From</label>
                <input
                  id="quiet-start"
                  type="time"
                  data-testid="notify-quiet-start"
                  value={start}
                  onChange={(e) =>
                    props.onChange({ notifyQuietStart: e.target.value || undefined })
                  }
                />
              </div>
              <div className="field">
                <label htmlFor="quiet-end">Until</label>
                <input
                  id="quiet-end"
                  type="time"
                  data-testid="notify-quiet-end"
                  value={end}
                  onChange={(e) => props.onChange({ notifyQuietEnd: e.target.value || undefined })}
                />
              </div>
            </div>
            <p className="notify-quiet-status">{quietHoursSummary(start, end)}</p>
          </div>
        ) : (
          <p className="notify-quiet-status notify-quiet-off">Off — alerts can fire at any time.</p>
        )}
      </section>
    </div>
  );
}

function quietHoursSummary(start: string, end: string): string {
  if (!start || !end) return "Pick a start and end time to mute alerts.";
  if (start === end) return "Start and end are the same, so quiet hours stay off.";
  const overnight = start > end;
  return overnight
    ? `Alerts muted from ${start} until ${end} (overnight).`
    : `Alerts muted from ${start} until ${end}.`;
}
