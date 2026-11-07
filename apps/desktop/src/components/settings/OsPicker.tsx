import { configuredGuestOsOptions, type GuestOs } from "@locus/shared";

type IsoTemplate = { os: GuestOs; isoPath: string };

export function OsPicker(props: {
  value: GuestOs;
  onChange: (os: GuestOs) => void;
  templates?: IsoTemplate[];
}) {
  const options = configuredGuestOsOptions(props.templates);
  if (options.length <= 1) return null;
  return (
    <div className="os-grid">
      {options.map((opt) => (
        <button
          key={opt.os}
          type="button"
          className={`os-card ${props.value === opt.os ? "active" : ""}`}
          onClick={() => props.onChange(opt.os)}
        >
          <h3>{opt.name}</h3>
          <p>{opt.summary}</p>
        </button>
      ))}
    </div>
  );
}

export function OsSoloHint(props: { templates?: IsoTemplate[]; os: GuestOs }) {
  const options = configuredGuestOsOptions(props.templates);
  if (options.length > 1) return null;
  if (options.length === 1) {
    return <p className="os-solo-hint">Using {options[0]!.name}</p>;
  }
  return <p className="os-solo-hint">Add a guest ISO in Settings → Machines.</p>;
}
