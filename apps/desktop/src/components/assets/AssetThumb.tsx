export function AssetThumb(props: { src?: string; compact?: boolean }) {
  const className = `asset-preview-thumb${props.compact ? " is-compact" : ""}${props.src ? "" : " is-empty"}`;
  if (!props.src) {
    return <span className={className} aria-hidden data-testid="asset-preview" />;
  }
  return (
    <img
      className={className}
      src={props.src}
      alt=""
      aria-hidden
      data-testid="asset-preview"
      onError={(event) => {
        event.currentTarget.classList.add("is-empty");
        event.currentTarget.removeAttribute("src");
      }}
    />
  );
}
