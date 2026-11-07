export function HardwareFields(props: {
  cpuCores: number;
  memoryMb: number;
  diskSizeGb: number;
  hint?: string;
  onChange: (next: { cpuCores: number; memoryMb: number; diskSizeGb: number }) => void;
}) {
  const { cpuCores, memoryMb, diskSizeGb, hint, onChange } = props;
  return (
    <>
      <div className="grid-3">
        <div className="field">
          <label>CPU cores</label>
          <input
            type="number"
            min={1}
            value={cpuCores}
            onChange={(e) => onChange({ cpuCores: Number(e.target.value), memoryMb, diskSizeGb })}
          />
        </div>
        <div className="field">
          <label>Memory (MB)</label>
          <input
            type="number"
            min={512}
            step={512}
            value={memoryMb}
            onChange={(e) => onChange({ cpuCores, memoryMb: Number(e.target.value), diskSizeGb })}
          />
        </div>
        <div className="field">
          <label>Disk (GB)</label>
          <input
            type="number"
            min={8}
            value={diskSizeGb}
            onChange={(e) => onChange({ cpuCores, memoryMb, diskSizeGb: Number(e.target.value) })}
          />
        </div>
      </div>
      {hint ? (
        <p className="hint" style={{ margin: "-4px 0 12px" }}>
          {hint}
        </p>
      ) : null}
    </>
  );
}
