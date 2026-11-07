import { diagramKindLabel, mermaidSvg } from "@/lib/mermaidDiagram";

export function MermaidDiagram({
  source,
  kind,
  caption,
}: {
  source: string;
  kind?: string;
  caption?: string;
}) {
  const svg = mermaidSvg(source);
  return (
    <figure className="pr-stack-diagram" data-testid="pr-stack-diagram" data-kind={kind}>
      <figcaption className="pr-stack-diagram-caption">
        <span className="eyebrow">{diagramKindLabel(kind)}</span>
        {caption ? <span className="hint">{caption}</span> : null}
      </figcaption>
      {svg ? (
        <div className="pr-stack-diagram-canvas" dangerouslySetInnerHTML={{ __html: svg }} />
      ) : (
        <pre>{source}</pre>
      )}
    </figure>
  );
}
