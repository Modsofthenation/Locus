import { memo, useEffect, useMemo, useRef, useState } from "react";
import {
  isTaskListToolName,
  isHiddenCursorPlanTool,
  isSpawnAgentToolName,
  matchSubagent,
  parseSubagentKind,
  patchFilesFromTool,
  slackPostDraftText,
  toolActivityGroups,
  toolActivityOpen,
  toolActivityStatus,
  toolActivitySummary,
  toolChipLabel,
  toolChipStatus,
  isAskUserToolName,
  askUserQuestion,
  askUserChoices,
  askUserAllowsFreeText,
  askUserItems,
  askUserIntro,
  formatAskUserReply,
  isPublishTool,
  testGateAnswer,
  testGateSkipRequest,
  formatTestGateDuration,
  TEST_GATE_CHOICES,
  TEST_GATE_CHOICE_LABELS,
  TEST_GATE_PROMPT_TOOL,
  type ChatMessage,
  type SubagentLive,
  type TestGateChoice,
  type ToolCall,
} from "@locus/shared";
import { api } from "@/lib/api";
import { prUrlFromToolOutput } from "@/lib/markdown";
import { screenshotSrc } from "./GuestTimeline";
import { useDialogFocus } from "@/lib/useDialogFocus";
import { showNotice } from "@/lib/notice";
import { IconClose } from "@/components/layout/Icons";
import { BusyButton, InlineError } from "@/components/layout/Skeleton";
import { ToolPatch } from "./PatchCard";
import { SubagentCard } from "./SubagentCard";

export const ToolActivity = memo(function ToolActivity({
  sessionId,
  calls,
  tools,
  subagents,
  onOpenPath,
  onOpenSubagent,
}: {
  sessionId: string;
  calls: ToolCall[];
  tools: ChatMessage[];
  subagents?: SubagentLive[];
  onOpenPath?: (path: string, line?: number) => void;
  onOpenSubagent?: (agent: SubagentLive) => void;
}) {
  const byId = new Map(tools.filter((row) => row.toolCallId).map((row) => [row.toolCallId!, row]));
  return (
    <>
      {toolActivityGroups(calls).map((group) => {
        const visible = group.filter(
          (call) => !isTaskListToolName(call.name) && !isHiddenCursorPlanTool(call.name),
        );
        if (!visible.length) return null;
        const spawnCalls = onOpenSubagent
          ? visible.filter((call) => isSpawnAgentToolName(call.name))
          : [];
        const rest = onOpenSubagent
          ? visible.filter((call) => !isSpawnAgentToolName(call.name))
          : visible;
        const status = toolActivityStatus(rest.length ? rest : visible);
        const needsOpen = toolActivityOpen(rest.length ? rest : visible);
        return (
          <div key={visible.map((call) => call.id).join("-")}>
            {spawnCalls.map((call) => {
              const tool =
                byId.get(call.id) ??
                tools.find((row) => row.toolCalls?.some((item) => item.id === call.id));
              const result = call.result ?? tool?.content;
              const agent = matchSubagent(subagents, call) ?? {
                id: call.id,
                task:
                  typeof call.arguments.task === "string" && call.arguments.task.trim()
                    ? call.arguments.task.trim()
                    : "Subagent",
                status: call.finishedAt ? (call.error ? "error" : "done") : "running",
                lastLine: result,
                kind: parseSubagentKind(call.arguments.kind),
                toolCallId: call.id,
              };
              return <SubagentCard key={call.id} agent={agent} onOpen={onOpenSubagent!} />;
            })}
            {rest.length ? (
              <details
                className="tool-activity"
                data-testid="tool-activity"
                {...(needsOpen ? { open: true } : {})}
              >
                <summary>
                  <span className="tool-activity-label">{toolActivitySummary(rest)}</span>
                  {status ? <span className="tool-activity-status">{status}</span> : null}
                </summary>
                <div className="tool-activity-body">
                  {rest.map((call) => {
                    const result = toolCallResult(call, byId, tools);
                    const error = call.error;
                    const chipOpen = call.approval === "needed" && !call.finishedAt;
                    const askPending =
                      isAskUserToolName(call.name) &&
                      call.approval === "needed" &&
                      !call.finishedAt;
                    return (
                      <div className="tool-call" key={call.id}>
                        <details
                          className={`tool-chip${askPending ? " ask-user-chip" : ""}`}
                          {...(chipOpen ? { open: true } : {})}
                        >
                          <summary>
                            {toolChipLabel(call.name, call.arguments, result, error)}
                            {" · "}
                            {toolChipStatus({ ...call, result, error })}
                          </summary>
                          {askPending ? (
                            <AskUserPrompt sessionId={sessionId} call={call} />
                          ) : call.approval === "needed" && !call.finishedAt ? (
                            <details className="tool-args">
                              <summary>Details</summary>
                              <pre>
                                {JSON.stringify(
                                  toolArgsPreview(call.name, call.arguments, result),
                                  null,
                                  2,
                                )}
                              </pre>
                            </details>
                          ) : null}
                          {result &&
                          !patchFilesFromTool(call.name, call.arguments, result).length ? (
                            <pre>{result}</pre>
                          ) : error ? (
                            <pre>{error}</pre>
                          ) : !call.finishedAt && call.approval !== "needed" ? (
                            <pre>
                              {JSON.stringify(
                                toolArgsPreview(call.name, call.arguments, result),
                                null,
                                2,
                              )}
                            </pre>
                          ) : null}
                        </details>
                      </div>
                    );
                  })}
                </div>
              </details>
            ) : null}
            {rest.map((call) => (
              <ToolFollowup
                key={`${call.id}-followup`}
                sessionId={sessionId}
                call={call}
                result={toolCallResult(call, byId, tools)}
                onOpenPath={onOpenPath}
              />
            ))}
          </div>
        );
      })}
      {tools.map((tool) => (
        <ToolExtras key={`extras-${tool.id}`} sessionId={sessionId} message={tool} />
      ))}
    </>
  );
});

function toolCallResult(
  call: ToolCall,
  byId: Map<string, ChatMessage>,
  tools: ChatMessage[],
): string | undefined {
  const tool =
    byId.get(call.id) ?? tools.find((row) => row.toolCalls?.some((item) => item.id === call.id));
  return call.result ?? tool?.content;
}

const ToolFollowup = memo(function ToolFollowup({
  sessionId,
  call,
  result,
  onOpenPath,
}: {
  sessionId: string;
  call: ToolCall;
  result?: string;
  onOpenPath?: (path: string, line?: number) => void;
}) {
  const pr = call.name === "git_pr" ? prUrlFromToolOutput(result ?? "") : undefined;
  const hasPatch = useMemo(
    () => Boolean(patchFilesFromTool(call.name, call.arguments, result).length),
    [call.name, call.arguments, result],
  );
  const needsApproval =
    call.approval === "needed" && !call.finishedAt && !isAskUserToolName(call.name);
  if (!hasPatch && !pr && !needsApproval) return null;
  return (
    <div className="tool-followup" data-testid="tool-followup">
      {hasPatch ? (
        <ToolPatch
          name={call.name}
          args={call.arguments}
          result={result}
          sessionId={sessionId}
          callId={call.id}
          onOpenPath={onOpenPath}
        />
      ) : null}
      {pr ? (
        <p className="bubble">
          <a href={pr} target="_blank" rel="noreferrer">
            {pr}
          </a>
        </p>
      ) : null}
      {needsApproval ? (
        call.name === "slack_post" ? (
          <SlackPostDraft sessionId={sessionId} call={call} />
        ) : call.name === "brain_brief" ? (
          <BrainBriefDraft sessionId={sessionId} call={call} />
        ) : call.name === TEST_GATE_PROMPT_TOOL ? (
          <TestGatePrompt sessionId={sessionId} call={call} />
        ) : (
          <ApprovalRow sessionId={sessionId} call={call} />
        )
      ) : null}
    </div>
  );
});

function ApprovalRow({ sessionId, call }: { sessionId: string; call: ToolCall }) {
  const callId = call.id;
  const [working, setWorking] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const publish = isPublishTool(call.name);
  const skip = publish ? testGateSkipRequest(call.arguments) : { requested: false };

  async function resolve(
    decision: "approved" | "denied",
    opts: { always?: boolean; answer?: string; busy?: string } = {},
  ) {
    if (working) return;
    setWorking(opts.busy ?? decision);
    setError(null);
    try {
      await api.resolveApproval(sessionId, callId, decision, opts.answer, opts.always);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not update approval");
      setWorking(null);
    }
  }

  return (
    <>
      {skip.requested ? (
        <p className="approval-note" data-testid="approval-skip-request">
          The agent asks to skip the test gate
          {skip.reason ? <>: &ldquo;{skip.reason}&rdquo;</> : "."}
        </p>
      ) : null}
      <div className="approval-row">
        <BusyButton
          className="btn small primary"
          disabled={Boolean(working)}
          busy={working === "approved"}
          busyLabel="Approving…"
          title={publish ? "Approve and run the workspace tests first" : undefined}
          onClick={() => void resolve("approved")}
        >
          {publish ? "Approve, run tests" : "Approve"}
        </BusyButton>
        {publish ? (
          <>
            <BusyButton
              className="btn small"
              disabled={Boolean(working)}
              busy={working === "skip"}
              busyLabel="Approving…"
              title="Publish without running the workspace tests"
              onClick={() =>
                void resolve("approved", { answer: testGateAnswer("skip"), busy: "skip" })
              }
            >
              Approve, skip tests
            </BusyButton>
            <BusyButton
              className="btn small"
              disabled={Boolean(working)}
              busy={working === "defer"}
              busyLabel="Approving…"
              title="Publish now, then run the tests in the background and post the result here"
              onClick={() =>
                void resolve("approved", { answer: testGateAnswer("defer"), busy: "defer" })
              }
            >
              Approve, test after
            </BusyButton>
          </>
        ) : null}
        <BusyButton
          className="btn small"
          disabled={Boolean(working)}
          title="Allow this tool for the rest of this session"
          aria-label="Allow this tool for the rest of this session"
          onClick={() => void resolve("approved", { always: true })}
        >
          Always allow
        </BusyButton>
        <BusyButton
          className="btn small"
          disabled={Boolean(working)}
          busy={working === "denied"}
          busyLabel="Denying…"
          onClick={() => void resolve("denied")}
        >
          Deny
        </BusyButton>
        {error ? <InlineError message={error} /> : null}
      </div>
    </>
  );
}

function useCountdown(deadline: string | undefined): number | undefined {
  const target = deadline ? Date.parse(deadline) : NaN;
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!Number.isFinite(target)) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [target]);
  return Number.isFinite(target) ? Math.max(0, Math.ceil((target - now) / 1000)) : undefined;
}

function formatCountdown(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return m ? `${m}:${String(s).padStart(2, "0")}` : `${s}s`;
}

/** Countdown card before a slow git_push / git_pr test gate; no answer runs the tests. */
function TestGatePrompt({ sessionId, call }: { sessionId: string; call: ToolCall }) {
  const [working, setWorking] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const args = call.arguments ?? {};
  const tool = args.tool === "git_pr" ? "the pull request" : "the push";
  const last = formatTestGateDuration(
    typeof args.lastDurationMs === "number" ? args.lastDurationMs : undefined,
  );
  const reason = typeof args.reason === "string" ? args.reason : undefined;
  const command = typeof args.command === "string" ? args.command : undefined;
  const left = useCountdown(typeof args.deadline === "string" ? args.deadline : undefined);

  async function choose(choice: TestGateChoice | "deny") {
    if (working) return;
    setWorking(choice);
    setError(null);
    try {
      await (choice === "deny"
        ? api.resolveApproval(sessionId, call.id, "denied")
        : api.resolveApproval(sessionId, call.id, "approved", testGateAnswer(choice)));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not send your choice");
      setWorking(null);
    }
  }

  return (
    <div className="test-gate-prompt" data-testid="test-gate-prompt">
      <p className="approval-note">
        {args.skipRequested ? (
          <>
            The agent asks to skip the tests before {tool}
            {reason ? <>: &ldquo;{reason}&rdquo;</> : null}.
          </>
        ) : (
          <>The tests before {tool} are slow.</>
        )}{" "}
        {last ? <>The last run took {last}. </> : null}
        {command ? (
          <>
            Command: <code>{command}</code>.{" "}
          </>
        ) : null}
        {left !== undefined ? (
          <strong>
            {left > 0
              ? `The tests run automatically in ${formatCountdown(left)} if you don't choose.`
              : "Running the tests…"}
          </strong>
        ) : null}
      </p>
      <div className="approval-row">
        {TEST_GATE_CHOICES.map((choice) => (
          <BusyButton
            key={choice}
            className={choice === "run" ? "btn small primary" : "btn small"}
            disabled={Boolean(working)}
            busy={working === choice}
            busyLabel="Sending…"
            onClick={() => void choose(choice)}
          >
            {TEST_GATE_CHOICE_LABELS[choice]}
          </BusyButton>
        ))}
        <BusyButton
          className="btn small"
          disabled={Boolean(working)}
          busy={working === "deny"}
          busyLabel="Cancelling…"
          title={`Don't publish: cancel ${tool}`}
          onClick={() => void choose("deny")}
        >
          Don&apos;t publish
        </BusyButton>
        {error ? <InlineError message={error} /> : null}
      </div>
    </div>
  );
}

function ToolExtras({ sessionId, message }: { sessionId: string; message: ChatMessage }) {
  const shot = screenshotSrc(sessionId, message);
  return (
    <>
      {shot ? <ShotCard sessionId={sessionId} message={message} /> : null}
      {message.artifactName ? (
        <a
          className="bubble-artifact"
          href={`/api/sessions/${sessionId}/artifacts/${encodeURIComponent(message.artifactName)}${message.artifactKind ? `?kind=${message.artifactKind}` : ""}`}
          target="_blank"
          rel="noreferrer"
        >
          {message.artifactName}
        </a>
      ) : null}
      {message.recordingName ? (
        <video
          className="bubble-recording"
          controls
          playsInline
          src={`/api/sessions/${sessionId}/recordings/${encodeURIComponent(message.recordingName)}`}
        >
          Guest recording
        </video>
      ) : null}
    </>
  );
}

function toolArgsPreview(
  name: string,
  args: Record<string, unknown>,
  result?: string,
): Record<string, unknown> {
  if (typeof args.patch !== "string" || !patchFilesFromTool(name, args, result).length) return args;
  return { ...args, patch: `… ${args.patch.split("\n").length} lines` };
}

export function ShotCard({ sessionId, message }: { sessionId: string; message: ChatMessage }) {
  const src = screenshotSrc(sessionId, message);
  const [open, setOpen] = useState(false);
  if (!src) return null;
  const call = message.toolCalls?.[0];
  const title = call?.name ?? "Guest screenshot";
  const status = call
    ? toolChipStatus({
        approval: call.approval,
        finishedAt: call.finishedAt,
        error: call.error,
        result: call.result ?? message.content,
      })
    : "captured";
  const raw =
    message.role === "tool" &&
    message.content.trim() &&
    !patchFilesFromTool(call?.name ?? "", call?.arguments, message.content).length
      ? message.content
      : undefined;
  return (
    <>
      <details className="shot-card" data-testid="shot-card">
        <summary>
          <span className="shot-card-thumb">
            <img alt="" src={src} />
          </span>
          <span className="shot-card-copy">
            <strong>{title}</strong>
            <span>{status}</span>
          </span>
        </summary>
        <button
          type="button"
          className="shot-card-open"
          onClick={() => setOpen(true)}
          title="Open screenshot"
        >
          <img className="shot-card-full" alt="Guest screenshot" src={src} />
        </button>
        {raw ? <pre>{raw}</pre> : null}
      </details>
      {open ? (
        <MediaLightbox src={src} alt="Guest screenshot" onClose={() => setOpen(false)} />
      ) : null}
    </>
  );
}

function MediaLightbox(props: { src: string; alt: string; onClose: () => void }) {
  const dialogRef = useRef<HTMLDivElement>(null);
  useDialogFocus(true, props.onClose, dialogRef);
  return (
    <div
      className="media-lightbox"
      data-testid="media-lightbox"
      role="dialog"
      aria-modal="true"
      aria-label={props.alt}
      ref={dialogRef}
      onClick={props.onClose}
    >
      <button
        type="button"
        className="media-lightbox-close"
        aria-label="Close"
        onClick={(event) => {
          event.stopPropagation();
          props.onClose();
        }}
      >
        <IconClose />
      </button>
      <img
        className="media-lightbox-img"
        src={props.src}
        alt={props.alt}
        onClick={(event) => event.stopPropagation()}
      />
    </div>
  );
}

function SlackPostDraft({ sessionId, call }: { sessionId: string; call: ToolCall }) {
  const initial = slackPostDraftText(call.arguments);
  const [text, setText] = useState(initial);
  const [working, setWorking] = useState(false);

  useEffect(() => {
    setText(slackPostDraftText(call.arguments));
  }, [call.id, call.arguments]);

  async function resolve(decision: "approved" | "denied") {
    if (working) return;
    setWorking(true);
    try {
      await api.resolveApproval(
        sessionId,
        call.id,
        decision,
        decision === "approved" ? text : undefined,
      );
    } catch (err) {
      showNotice(err instanceof Error ? err.message : "Could not resolve draft");
    } finally {
      setWorking(false);
    }
  }

  return (
    <div className="slack-draft" data-testid="slack-draft">
      <div className="slack-draft-head">Draft Slack message</div>
      <p className="hint">Edit, then Send. Locus will not post until you do.</p>
      <textarea
        value={text}
        rows={4}
        data-testid="slack-draft-text"
        onChange={(e) => setText(e.target.value)}
      />
      <div className="row-actions">
        <button
          className="btn small"
          type="button"
          disabled={working}
          onClick={() => void resolve("denied")}
        >
          Deny
        </button>
        <button
          className="btn small primary"
          type="button"
          disabled={working || !text.trim()}
          data-testid="slack-draft-send"
          onClick={() => void resolve("approved")}
        >
          Send
        </button>
      </div>
    </div>
  );
}

function brainBriefDraftText(args: Record<string, unknown> | undefined): string {
  return typeof args?.body === "string" ? args.body : "";
}

function BrainBriefDraft({ sessionId, call }: { sessionId: string; call: ToolCall }) {
  const initial = brainBriefDraftText(call.arguments);
  const [text, setText] = useState(initial);
  const [working, setWorking] = useState(false);
  const issue = typeof call.arguments.issue === "string" ? call.arguments.issue : "issue";

  useEffect(() => {
    setText(brainBriefDraftText(call.arguments));
  }, [call.id, call.arguments]);

  async function resolve(decision: "approved" | "denied") {
    if (working) return;
    setWorking(true);
    try {
      await api.resolveApproval(
        sessionId,
        call.id,
        decision,
        decision === "approved" ? text : undefined,
      );
    } catch (err) {
      showNotice(err instanceof Error ? err.message : "Could not resolve briefing");
    } finally {
      setWorking(false);
    }
  }

  return (
    <div className="slack-draft" data-testid="brain-brief-draft">
      <div className="slack-draft-head">Brain briefing for {issue}</div>
      <p className="hint">Edit, then Approve. Locus will not post until you do.</p>
      <textarea
        value={text}
        rows={8}
        data-testid="brain-brief-text"
        aria-label="Brain briefing"
        onChange={(e) => setText(e.target.value)}
      />
      <div className="row-actions">
        <button
          className="btn small"
          type="button"
          disabled={working}
          onClick={() => void resolve("denied")}
        >
          Deny
        </button>
        <button
          className="btn small primary"
          type="button"
          disabled={working || !text.trim()}
          data-testid="brain-brief-approve"
          onClick={() => void resolve("approved")}
        >
          Approve
        </button>
      </div>
    </div>
  );
}

function AskUserPrompt({ sessionId, call }: { sessionId: string; call: ToolCall }) {
  const items = askUserItems(call.arguments);
  const intro = askUserIntro(call.arguments);
  const series = items.length > 1;
  const [text, setText] = useState("");
  const [picked, setPicked] = useState<Record<string, string>>({});
  const [typed, setTyped] = useState<Record<string, string>>({});

  function answerFor(id: string): string {
    const typedVal = (typed[id] ?? "").trim();
    if (typedVal) return typedVal;
    return (picked[id] ?? "").trim();
  }

  function skip() {
    void api.resolveApproval(sessionId, call.id, "denied");
  }

  if (!series) {
    const question = items[0]?.question || askUserQuestion(call.arguments);
    const choices = items[0]?.choices ?? askUserChoices(call.arguments);
    const allowFree = items[0]?.allowFreeText ?? askUserAllowsFreeText(call.arguments);
    return (
      <div className="ask-user" data-testid="ask-user">
        {question ? <p className="ask-user-q">{question}</p> : null}
        {choices.length ? (
          <div className="ask-user-choices">
            {choices.map((choice) => (
              <button
                key={choice}
                type="button"
                className="ask-user-choice"
                onClick={() => void api.resolveApproval(sessionId, call.id, "approved", choice)}
              >
                {choice}
              </button>
            ))}
          </div>
        ) : null}
        {allowFree ? (
          <form
            className="ask-user-bar"
            onSubmit={(event) => {
              event.preventDefault();
              const answer = text.trim();
              if (!answer) return;
              void api.resolveApproval(sessionId, call.id, "approved", answer);
            }}
          >
            <input
              value={text}
              onChange={(event) => setText(event.target.value)}
              placeholder="Type an answer"
              aria-label="Type an answer"
            />
            <button type="submit" className="btn small primary" disabled={!text.trim()}>
              Send
            </button>
          </form>
        ) : null}
        <div className="ask-user-actions">
          <button type="button" className="btn small ghost" onClick={skip}>
            Skip
          </button>
        </div>
      </div>
    );
  }

  const allAnswered = items.every((item) => answerFor(item.id).length > 0);

  return (
    <div className="ask-user" data-testid="ask-user">
      {intro ? <p className="ask-user-intro">{intro}</p> : null}
      {items.map((item, index) => (
        <div key={item.id} className="ask-user-item">
          <p className="ask-user-q">
            <span className="ask-user-n">{index + 1}</span>
            {item.question}
          </p>
          {item.choices.length ? (
            <div className="ask-user-choices">
              {item.choices.map((choice) => (
                <button
                  key={choice}
                  type="button"
                  className={`ask-user-choice${picked[item.id] === choice ? " picked" : ""}`}
                  aria-pressed={picked[item.id] === choice}
                  onClick={() => setPicked((cur) => ({ ...cur, [item.id]: choice }))}
                >
                  {choice}
                </button>
              ))}
            </div>
          ) : null}
          {item.allowFreeText ? (
            <input
              className="ask-user-input"
              value={typed[item.id] ?? ""}
              onChange={(event) => setTyped((cur) => ({ ...cur, [item.id]: event.target.value }))}
              placeholder={item.choices.length ? "Or type an answer" : "Type an answer"}
              aria-label={item.question}
            />
          ) : null}
        </div>
      ))}
      <div className="ask-user-actions">
        <button
          type="button"
          className="btn small primary"
          disabled={!allAnswered}
          onClick={() => {
            const answers: Record<string, string> = {};
            for (const item of items) answers[item.id] = answerFor(item.id);
            void api.resolveApproval(
              sessionId,
              call.id,
              "approved",
              formatAskUserReply(items, answers),
            );
          }}
        >
          Continue
        </button>
        <button type="button" className="btn small ghost" onClick={skip}>
          Skip
        </button>
      </div>
    </div>
  );
}
