export type CompletionShell = "bash" | "zsh" | "fish";

export function isCompletionShell(value: string): value is CompletionShell {
  return value === "bash" || value === "zsh" || value === "fish";
}

export function renderCompletion(shell: CompletionShell, commands: string[]): string {
  const unique = [...new Set(commands.map((row) => row.trim()).filter(Boolean))].sort();
  const first = [...new Set(unique.map((row) => row.split(" ")[0]!).filter(Boolean))].sort();
  if (shell === "fish") {
    const lines = [
      "complete -c locus -f",
      ...first.map((word) => `complete -c locus -n __fish_use_subcommand -a ${word}`),
      ...unique
        .filter((row) => row.includes(" "))
        .map((row) => {
          const parts = row.split(" ");
          const last = parts[parts.length - 1]!;
          const prev = parts.slice(0, -1).join(" ");
          return `complete -c locus -n '__fish_seen_subcommand_from ${prev}' -a ${last}`;
        }),
    ];
    return `${lines.join("\n")}\n`;
  }
  if (shell === "zsh") {
    const words = unique.map((row) => row.replaceAll(" ", "\\ ")).join(" ");
    return `#compdef locus
_arguments "1:command:(${first.join(" ")})" "*::args:->args"
_values 'commands' ${words}
`;
  }
  const list = unique.join(" ");
  return `_locus() {
  local cur="\${COMP_WORDS[COMP_CWORD]}"
  COMPREPLY=($(compgen -W "${list}" -- "$cur"))
}
complete -F _locus locus
`;
}
