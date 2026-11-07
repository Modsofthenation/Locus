import { EXPLORE_SURFACES } from "@/lib/discoverability";
import { useStore } from "@/state/store";

/**
 * Quiet empty-state secondary nav — always visible text links (Linear / Notion style).
 * No disclosure toggle: destinations stay scannable without layout choreography.
 */
export function ExploreSurfaces() {
  const { dispatch } = useStore();
  return (
    <nav className="explore-surfaces" aria-label="Also try" data-testid="explore-surfaces">
      <span className="explore-surfaces-label">Also try</span>
      <ul className="explore-surface-links">
        {EXPLORE_SURFACES.map((row) => (
          <li key={row.id}>
            <button
              type="button"
              className="explore-surface-link"
              title={row.blurb}
              data-testid={`explore-surface-${row.id}`}
              onClick={() => dispatch({ type: "section", section: row.section })}
            >
              {row.title}
            </button>
          </li>
        ))}
      </ul>
    </nav>
  );
}
