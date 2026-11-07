import { Component, type ErrorInfo, type ReactNode } from "react";
import { Mascot } from "./Mascot";
import {
  crashFromUnknown,
  crashFromWindowError,
  mergeCrash,
  restartFrontend,
  type CrashError,
} from "@/lib/crash";

export function CrashScreen(props: {
  errors: CrashError[];
  componentStack?: string;
  onRestart?: () => void;
}) {
  const errors = props.errors.length ? props.errors : [{ id: "crash", title: "Unknown error" }];
  const primary = errors[0]!;
  const restart = props.onRestart ?? restartFrontend;

  return (
    <div className="crash-screen" role="alert" aria-live="assertive" data-testid="crash-screen">
      <div className="crash-screen-card">
        <Mascot pose="sad" title="Locus is sad" />
        <h1>The UI crashed</h1>
        <p className="crash-screen-error">{primary.title}</p>
        <button
          type="button"
          className="btn primary"
          data-testid="crash-restart"
          onClick={() => restart()}
        >
          Restart
        </button>
        <div className="crash-screen-traces">
          {errors.map((err, index) => (
            <details
              key={err.id}
              className="log-blob danger"
              data-testid={index === 0 ? "crash-stack" : `crash-stack-${index + 1}`}
            >
              <summary>
                <span>{errors.length > 1 ? err.title : "Stack trace"}</span>
              </summary>
              <pre>{err.stack?.trim() || "No stack trace"}</pre>
            </details>
          ))}
          {props.componentStack?.trim() ? (
            <details className="log-blob" data-testid="crash-component-stack">
              <summary>
                <span>Component stack</span>
              </summary>
              <pre>{props.componentStack.trim()}</pre>
            </details>
          ) : null}
        </div>
      </div>
    </div>
  );
}

type BoundaryState = {
  crashed: boolean;
  renderError?: CrashError;
  errors: CrashError[];
  componentStack?: string;
};

type BoundaryProps = {
  children: ReactNode;
  onRestart?: () => void;
};

export class ErrorBoundary extends Component<BoundaryProps, BoundaryState> {
  state: BoundaryState = { crashed: false, errors: [] };

  static getDerivedStateFromError(error: unknown): Partial<BoundaryState> {
    return { crashed: true, renderError: crashFromUnknown(error) };
  }

  componentDidCatch(error: unknown, info: ErrorInfo) {
    this.pushCrash(crashFromUnknown(error), info.componentStack?.trim() || undefined);
  }

  componentDidMount() {
    window.addEventListener("error", this.onWindowError);
  }

  componentWillUnmount() {
    window.removeEventListener("error", this.onWindowError);
  }

  private onWindowError = (event: ErrorEvent) => {
    const crash = crashFromWindowError(event);
    if (!crash) return;
    this.pushCrash(crash);
  };

  private pushCrash = (crash: CrashError, componentStack?: string) => {
    this.setState((prev) => {
      const errors = mergeCrash(prev.errors, crash);
      const sameList = errors === prev.errors;
      const nextStack = componentStack || prev.componentStack;
      if (sameList && nextStack === prev.componentStack && prev.crashed) return prev;
      return {
        crashed: true,
        errors,
        componentStack: nextStack,
        renderError: prev.renderError,
      };
    });
  };

  render() {
    if (!this.state.crashed && this.state.errors.length === 0) return this.props.children;
    const errors = this.state.errors.length
      ? this.state.errors
      : this.state.renderError
        ? [this.state.renderError]
        : [{ id: "crash", title: "The UI crashed" }];
    return (
      <CrashScreen
        errors={errors}
        componentStack={this.state.componentStack}
        onRestart={this.props.onRestart}
      />
    );
  }
}
