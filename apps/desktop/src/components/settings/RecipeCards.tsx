import { recipeShortcut, type AgentRecipe, type FirstTask } from "@locus/shared";
import { useEffect, useState, type ReactNode } from "react";
import { IconPlus } from "@/components/layout/Icons";

export { recipeShortcut };

/** True while Alt / Option is held, so letter hints can stay hidden until asked for. */
export function useAltHeld(enabled = true): boolean {
  const [held, setHeld] = useState(false);
  useEffect(() => {
    if (!enabled) return;
    function onDown(event: KeyboardEvent) {
      if (event.key === "Alt") setHeld(true);
    }
    function onUp(event: KeyboardEvent) {
      if (event.key === "Alt") setHeld(false);
    }
    function onBlur() {
      setHeld(false);
    }
    window.addEventListener("keydown", onDown);
    window.addEventListener("keyup", onUp);
    window.addEventListener("blur", onBlur);
    return () => {
      window.removeEventListener("keydown", onDown);
      window.removeEventListener("keyup", onUp);
      window.removeEventListener("blur", onBlur);
    };
  }, [enabled]);
  return held;
}

export function RecipeCards(props: {
  recipes: AgentRecipe[];
  selectedId: string | null;
  onSelect: (recipe: AgentRecipe) => void;
  label?: string;
  compact?: boolean;
  pills?: boolean;
  /** Pill letter hints (only where the screen handles the keys). Shown on hover, focus, or Alt. */
  shortcuts?: boolean;
  /** Show this many pills, then a "More…" toggle for the rest (and `more`). */
  limit?: number;
  /** Extra rows revealed with "More…". */
  more?: ReactNode;
}) {
  const [expanded, setExpanded] = useState(false);
  const showKeys = Boolean(props.pills && props.shortcuts);
  const altHeld = useAltHeld(showKeys);
  if (!props.recipes.length) return null;
  const variant = props.pills ? " pills" : props.compact ? " compact" : "";
  const limit = props.limit && props.limit > 0 ? props.limit : undefined;
  const hasMore = Boolean(limit && (props.recipes.length > limit || props.more));
  const shown =
    limit && !expanded
      ? props.recipes.filter((row, index) => index < limit || row.id === props.selectedId)
      : props.recipes;
  return (
    <>
      <div
        className={`recipe-grid${variant}${altHeld ? " show-keys" : ""}`}
        role="group"
        aria-label={props.label ?? "Agent recipes"}
      >
        {shown.map((recipe) => {
          const shortcut = showKeys ? recipeShortcut(recipe) : "";
          return (
            <button
              key={recipe.id}
              type="button"
              title={props.pills && shortcut ? `${recipe.blurb} (${shortcut})` : recipe.blurb}
              aria-keyshortcuts={props.pills && shortcut ? shortcut : undefined}
              aria-pressed={props.selectedId === recipe.id}
              className={`os-card ${props.selectedId === recipe.id ? "active" : ""}`}
              onClick={() => props.onSelect(recipe)}
            >
              {props.pills ? (
                <>
                  <h3>{recipe.title}</h3>
                  {shortcut ? <kbd>{shortcut}</kbd> : null}
                </>
              ) : props.compact ? (
                <>
                  <span className="recipe-tile" aria-hidden>
                    {recipe.title.slice(0, 1)}
                  </span>
                  <span className="recipe-copy">
                    <h3>{recipe.title}</h3>
                    <p>{recipe.blurb}</p>
                  </span>
                  <span className="recipe-add" aria-hidden>
                    <IconPlus />
                  </span>
                </>
              ) : (
                <>
                  <h3>{recipe.title}</h3>
                  <p>{recipe.blurb}</p>
                </>
              )}
            </button>
          );
        })}
        {hasMore ? (
          <button
            type="button"
            className="os-card recipe-more"
            aria-expanded={expanded}
            onClick={() => setExpanded((open) => !open)}
          >
            <h3>{expanded ? "Fewer" : "More…"}</h3>
          </button>
        ) : null}
      </div>
      {expanded ? props.more : null}
    </>
  );
}

export function FirstTaskPills(props: {
  tasks: readonly FirstTask[];
  selectedId: string | null;
  onSelect: (task: FirstTask) => void;
  label?: string;
}) {
  if (!props.tasks.length) return null;
  const label = props.label ?? "Try a first task";
  return (
    <div className="first-task">
      <p className="design-start-from-label">{label}</p>
      <div className="recipe-grid pills" role="group" aria-label={label}>
        {props.tasks.map((task) => (
          <button
            key={task.id}
            type="button"
            title={task.blurb}
            aria-pressed={props.selectedId === task.id}
            className={`os-card ${props.selectedId === task.id ? "active" : ""}`}
            onClick={() => props.onSelect(task)}
          >
            <h3>{task.title}</h3>
          </button>
        ))}
      </div>
    </div>
  );
}
