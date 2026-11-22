import {
  LAUNCH_TARGETS,
  NATIVE_ENGINES,
  type LaunchTarget,
  type NativeEngine,
  type NativeReadiness,
  type NativeStarter,
  type ProjectAction,
  type TargetSurface,
} from "./launchTargets";

/** "Build with" — pick the web canvas or a native tool before anything else on the launch screen. */
export function LaunchTargetPicker(props: {
  surface: TargetSurface;
  value: LaunchTarget;
  onChange: (next: LaunchTarget) => void;
  /** Native targets need Host agents; managed policy can block them. */
  nativeDisabledReason?: string;
}) {
  const options = LAUNCH_TARGETS[props.surface];
  return (
    <div className="launch-target" data-testid="launch-target">
      <div className="launch-kicker">Build with</div>
      <div
        className="launch-target-row"
        role="radiogroup"
        aria-label={props.surface === "game" ? "Game engine" : "Asset builder"}
        style={{ ["--launch-target-count" as string]: options.length }}
      >
        {options.map((option) => {
          const active = props.value === option.id;
          const disabled = option.id !== "web" && Boolean(props.nativeDisabledReason);
          return (
            <button
              key={option.id}
              type="button"
              role="radio"
              aria-checked={active}
              disabled={disabled}
              title={disabled ? props.nativeDisabledReason : undefined}
              data-target={option.id}
              className={`launch-target-option${active ? " active" : ""}`}
              onClick={() => props.onChange(option.id)}
            >
              <span className="launch-target-title">{option.title}</span>
              <span className="launch-target-detail">{option.detail}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

/** Create-vs-open toggle, what the engine needs, and why Send is blocked (if it is). */
export function NativeProjectSetup(props: {
  engine: NativeEngine;
  action: ProjectAction;
  onAction: (next: ProjectAction) => void;
  readiness: NativeReadiness;
}) {
  const info = NATIVE_ENGINES[props.engine];
  return (
    <div className="native-setup" data-testid="native-setup" data-engine={props.engine}>
      <div className="native-setup-head">
        <div
          className="native-setup-actions"
          role="radiogroup"
          aria-label={`${info.name} project action`}
        >
          {(["create", "edit"] as const).map((action) => (
            <button
              key={action}
              type="button"
              role="radio"
              aria-checked={props.action === action}
              className={props.action === action ? "active" : ""}
              onClick={() => props.onAction(action)}
            >
              {info.actions[action].label}
            </button>
          ))}
        </div>
        <span className="native-setup-requires">Needs {info.requires}</span>
      </div>
      <ul className="native-setup-checks" aria-label="Before you start">
        {props.readiness.checks.map((check) => (
          <li key={check.id} className={check.ok ? "ok" : "todo"}>
            <span className="native-setup-mark" aria-hidden="true">
              {check.ok ? "✓" : "•"}
            </span>
            <span>{check.label}</span>
            <span className="native-setup-sr">{check.ok ? " (done)" : " (needed)"}</span>
          </li>
        ))}
      </ul>
      {props.readiness.blocker ? (
        <p className="native-setup-blocker" role="status" data-testid="native-setup-blocker">
          {props.readiness.blocker}
        </p>
      ) : null}
    </div>
  );
}

export function NativeStarters(props: {
  engine: NativeEngine;
  action: ProjectAction;
  selectedId: string | null;
  onPick: (starter: NativeStarter) => void;
}) {
  const info = NATIVE_ENGINES[props.engine];
  const starters = info.actions[props.action].starters;
  return (
    <div className="recipe-grid pills" role="group" aria-label={`${info.name} starters`}>
      {starters.map((starter) => (
        <button
          key={starter.id}
          type="button"
          title={starter.prompt}
          aria-pressed={props.selectedId === starter.id}
          className={`os-card ${props.selectedId === starter.id ? "active" : ""}`}
          onClick={() => props.onPick(starter)}
        >
          <h3>{starter.title}</h3>
        </button>
      ))}
    </div>
  );
}
