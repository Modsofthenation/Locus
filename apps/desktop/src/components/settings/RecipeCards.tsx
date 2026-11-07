import { recipeShortcut, type AgentRecipe, type FirstTask } from "@locus/shared";
import { IconPlus } from "@/components/layout/Icons";

export { recipeShortcut };

export function RecipeCards(props: {
  recipes: AgentRecipe[];
  selectedId: string | null;
  onSelect: (recipe: AgentRecipe) => void;
  label?: string;
  compact?: boolean;
  pills?: boolean;
}) {
  if (!props.recipes.length) return null;
  const variant = props.pills ? " pills" : props.compact ? " compact" : "";
  return (
    <div
      className={`recipe-grid${variant}`}
      role="group"
      aria-label={props.label ?? "Agent recipes"}
    >
      {props.recipes.map((recipe) => {
        const shortcut = recipeShortcut(recipe);
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
    </div>
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
