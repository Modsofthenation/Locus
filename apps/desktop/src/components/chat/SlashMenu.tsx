import {
  matchSlashMenu,
  sessionRuntime,
  skillSlashName,
  type AgentSession,
  type AgentSkill,
  type SlashMenuItem,
} from "@locus/shared";

export function SlashMenu(props: {
  query: string;
  session: AgentSession;
  skills?: AgentSkill[];
  activeIndex: number;
  onPick: (item: SlashMenuItem) => void;
}) {
  const items = matchSlashMenu(props.query, sessionRuntime(props.session), props.skills);
  if (!items.length) return null;
  return (
    <div className="slash-menu" role="listbox" aria-label="Slash commands" data-testid="slash-menu">
      {items.map((item, index) => {
        const name =
          item.kind === "command"
            ? item.command.name
            : (skillSlashName(item.skill.name) ?? item.skill.name);
        const hint = item.kind === "command" ? item.command.hint : item.skill.hint;
        return (
          <button
            key={item.kind === "command" ? `cmd:${item.command.id}` : `skill:${item.skill.id}`}
            type="button"
            role="option"
            aria-selected={index === props.activeIndex}
            className={index === props.activeIndex ? "active" : ""}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => props.onPick(item)}
          >
            <span className="slash-name">/{name}</span>
            <span className="slash-hint">{hint}</span>
          </button>
        );
      })}
    </div>
  );
}
