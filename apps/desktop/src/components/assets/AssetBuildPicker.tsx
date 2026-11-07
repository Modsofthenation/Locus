import {
  ASSET_POLY_BUDGETS,
  ASSET_QUALITY_TIERS,
  ASSET_RESOLUTIONS,
  ASSET_REST_POSES,
  ASSET_TOPOLOGY_MODES,
  formatAssetPolyBudgetLabel,
  formatAssetQualityLabel,
  formatAssetResolutionLabel,
  formatAssetRestPoseLabel,
  formatAssetTopologyLabel,
  resolveAssetBuild,
  type AssetBuild,
  type AssetPolyBudget,
  type AssetQualityTier,
  type AssetResolution,
  type AssetRestPose,
  type AssetTopologyMode,
} from "@locus/shared";

export function AssetBuildPicker(props: {
  value?: AssetBuild | null;
  onChange: (next: AssetBuild) => void;
  compact?: boolean;
  /** Rest pose, poly budget, and printability are 3D-only. Hidden on sprite studios. */
  mesh?: boolean;
}) {
  const build = resolveAssetBuild(props.value);
  const mesh = props.mesh !== false;

  function patch(partial: Partial<AssetBuild>) {
    props.onChange({ ...build, ...partial });
  }

  return (
    <div
      className={`asset-build-fields${props.compact ? " compact" : ""}`}
      aria-label="Build settings"
    >
      <Cluster
        label="Topology"
        value={build.topology}
        options={ASSET_TOPOLOGY_MODES.map((id) => ({ id, title: formatAssetTopologyLabel(id) }))}
        onChange={(topology: AssetTopologyMode) => patch({ topology })}
      />
      <Cluster
        label="Quality"
        value={build.quality}
        options={ASSET_QUALITY_TIERS.map((id) => ({ id, title: formatAssetQualityLabel(id) }))}
        onChange={(quality: AssetQualityTier) => patch({ quality })}
      />
      <Cluster
        label="Resolution"
        value={build.resolution}
        options={ASSET_RESOLUTIONS.map((id) => ({ id, title: formatAssetResolutionLabel(id) }))}
        onChange={(resolution: AssetResolution) => patch({ resolution })}
      />
      {mesh ? (
        <>
          <Cluster
            label="Rest pose"
            value={build.restPose}
            options={ASSET_REST_POSES.map((id) => ({ id, title: formatAssetRestPoseLabel(id) }))}
            onChange={(restPose: AssetRestPose) => patch({ restPose })}
          />
          <Cluster
            label="Poly budget"
            value={build.polyBudget}
            options={ASSET_POLY_BUDGETS.map((id) => ({
              id,
              title: formatAssetPolyBudgetLabel(id),
            }))}
            onChange={(polyBudget: AssetPolyBudget) => patch({ polyBudget })}
          />
        </>
      ) : null}
      <div className="asset-build-toggles" role="group" aria-label="Generation toggles">
        <Toggle
          label="Texture"
          pressed={build.texture}
          onClick={() => patch({ texture: !build.texture })}
        />
        <Toggle
          label="Split"
          pressed={build.split}
          onClick={() => patch({ split: !build.split })}
        />
        <Toggle
          label="Multi-view"
          pressed={build.multiView}
          onClick={() => patch({ multiView: !build.multiView })}
        />
        <Toggle
          label="Enhance"
          pressed={build.enhance}
          onClick={() => patch({ enhance: !build.enhance })}
        />
        {mesh ? (
          <Toggle
            label="Printability"
            pressed={build.printable}
            onClick={() => patch({ printable: !build.printable })}
          />
        ) : null}
      </div>
    </div>
  );
}

function Cluster<T extends string>(props: {
  label: string;
  value: T;
  options: { id: T; title: string }[];
  onChange: (id: T) => void;
}) {
  return (
    <div className="asset-build-row">
      <span className="asset-build-label">{props.label}</span>
      <div className="control-cluster" role="group" aria-label={props.label}>
        {props.options.map((opt) => (
          <button
            key={opt.id}
            type="button"
            className={`btn small ${props.value === opt.id ? "on" : ""}`}
            aria-pressed={props.value === opt.id}
            onClick={() => props.onChange(opt.id)}
          >
            {opt.title}
          </button>
        ))}
      </div>
    </div>
  );
}

function Toggle(props: { label: string; pressed: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      className={`btn small ${props.pressed ? "on" : ""}`}
      aria-pressed={props.pressed}
      onClick={props.onClick}
    >
      {props.label}
    </button>
  );
}
