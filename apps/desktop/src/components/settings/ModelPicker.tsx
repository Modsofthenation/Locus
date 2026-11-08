import {
  cursorModelCapabilities,
  cursorModelPickerIds,
  cursorModelSelectValue,
  codexCliReasoningEfforts,
  formatCursorModelId,
  formatRatePair,
  formatUsdPerMillion,
  parseCursorModelId,
  PRICING_AS_OF,
  projectedModelCosts,
  resolveUsageRates,
  retargetCursorModel,
  isCodexCliProvider,
  normalizeCodexCliModel,
  usesCursorModelIds,
  type CodexReasoningEffort,
  type AiProvider,
} from "@locus/shared";
import { Fragment } from "react";
import { modelsForProvider } from "@/lib/lastAgent";
import { MenuItem, MenuLabel, MenuSep, OverflowMenu } from "@/components/layout/OverflowMenu";
import { Select } from "@/components/layout/Select";

export function ModelPicker(props: {
  providers: AiProvider[];
  providerId: string;
  model: string;
  onChange: (next: { providerId: string; model: string }) => void;
  reasoningEffort?: CodexReasoningEffort;
  onReasoningEffortChange?: (value: CodexReasoningEffort | undefined) => void;
  compact?: boolean;
  disabled?: boolean;
}) {
  const provider = props.providers.find((p) => p.id === props.providerId);
  const selectedModel =
    provider && isCodexCliProvider(provider) ? normalizeCodexCliModel(props.model) : props.model;
  const listed = modelsForProvider(provider, selectedModel);
  const cursorIds = usesCursorModelIds(provider);
  const models = cursorIds ? cursorModelPickerIds(listed) : listed;
  const modelValue = cursorIds
    ? cursorModelSelectValue(listed, selectedModel)
    : listed.includes(selectedModel)
      ? selectedModel
      : (listed[0] ?? "");
  const composed = cursorIds
    ? formatCursorModelId({
        ...parseCursorModelId(selectedModel),
        base: modelValue || selectedModel,
      })
    : modelValue;

  const setModel = (model: string) => props.onChange({ providerId: props.providerId, model });

  const listedProviders = props.compact
    ? props.providers.filter((p) => p.enabled || p.id === props.providerId)
    : props.providers;
  const providerSelect = (
    <Select
      ariaLabel="Provider"
      disabled={props.disabled}
      value={props.providerId}
      options={[
        listedProviders.some((p) => p.id === props.providerId)
          ? null
          : {
              value: props.providerId,
              label: props.providerId || "No provider",
              disabled: true,
            },
        ...listedProviders.map((p) => ({
          value: p.id,
          label: p.enabled ? p.name : `${p.name} (off)`,
        })),
      ].filter((row): row is NonNullable<typeof row> => Boolean(row))}
      onChange={(id) => {
        const next = props.providers.find((p) => p.id === id);
        props.onChange({
          providerId: id,
          model: next?.defaultModel || next?.models[0] || "",
        });
      }}
    />
  );

  const modelSelect = (
    <Select
      ariaLabel="Model"
      disabled={props.disabled}
      value={modelValue}
      options={
        models.length
          ? models.map((m) => {
              const rates = formatRatePair(resolveUsageRates(provider, m));
              return { value: m, label: rates ? `${m} · ${rates}` : m };
            })
          : [{ value: "", label: "No model", disabled: true }]
      }
      onChange={(value) => setModel(cursorIds ? retargetCursorModel(props.model, value) : value)}
    />
  );

  const cursorControls =
    cursorIds && hasCursorModelOptions(composed) ? (
      <CursorModelControls
        compact={props.compact}
        disabled={props.disabled}
        model={composed}
        onChange={setModel}
      />
    ) : null;
  const codexControls =
    provider && isCodexCliProvider(provider) && props.onReasoningEffortChange ? (
      <CodexReasoningControls
        compact
        disabled={props.disabled}
        model={props.model}
        value={props.reasoningEffort}
        onChange={props.onReasoningEffortChange}
      />
    ) : null;
  const modelControls = cursorControls || codexControls;

  if (props.compact) {
    const combinedLabel = !provider
      ? "No provider"
      : !modelValue
        ? `${provider.name} · No model`
        : `${provider.name} · ${modelValue}`;
    return (
      <div className="model-picker-wrap">
        <div className="model-picker compact">
          <OverflowMenu
            className={`model-picker-combined${provider?.enabled ? " on" : ""}`}
            title="Model"
            align="left"
            prefer="up"
            wide
            disabled={props.disabled}
            toggleClassName="btn small ghost model-picker-combined-toggle"
            label={<span className="model-picker-combined-label">{combinedLabel}</span>}
          >
            {listedProviders.length ? (
              listedProviders.map((row) => {
                const listed = modelsForProvider(
                  row,
                  row.id === props.providerId ? selectedModel : row.defaultModel,
                );
                const ids = usesCursorModelIds(row) ? cursorModelPickerIds(listed) : listed;
                return (
                  <Fragment key={row.id}>
                    <MenuLabel>
                      {row.name}
                      {row.enabled ? "" : " (off)"}
                    </MenuLabel>
                    {ids.length ? (
                      ids.map((m) => (
                        <MenuItem
                          key={`${row.id}:${m}`}
                          active={row.id === props.providerId && m === modelValue}
                          disabled={props.disabled}
                          onClick={() =>
                            props.onChange({
                              providerId: row.id,
                              model: usesCursorModelIds(row)
                                ? retargetCursorModel(
                                    row.id === props.providerId
                                      ? props.model
                                      : row.defaultModel || m,
                                    m,
                                  )
                                : m,
                            })
                          }
                        >
                          {m}
                        </MenuItem>
                      ))
                    ) : (
                      <MenuItem disabled>No model</MenuItem>
                    )}
                  </Fragment>
                );
              })
            ) : (
              <MenuItem disabled>No provider</MenuItem>
            )}
          </OverflowMenu>
          {modelControls ? (
            <OverflowMenu
              className="model-picker-more"
              title="Model options"
              align="right"
              prefer="up"
              toggleClassName="btn icon ghost small"
            >
              {cursorControls}
              {cursorControls && codexControls ? <MenuSep /> : null}
              {codexControls}
            </OverflowMenu>
          ) : null}
        </div>
      </div>
    );
  }

  const costs = projectedModelCosts(props.providers, props.providerId, composed);

  return (
    <div className="model-picker">
      <div className="grid-2">
        <div className="field">
          <label>Provider</label>
          {providerSelect}
        </div>
        <div className="field">
          <label>Model</label>
          {modelSelect}
        </div>
      </div>
      {cursorControls}
      {costs.length > 0 ? <CostCompare costs={costs} /> : null}
    </div>
  );
}

export function CodexReasoningPicker(props: {
  provider?: AiProvider;
  model: string;
  value?: CodexReasoningEffort;
  onChange: (value: CodexReasoningEffort | undefined) => void;
  disabled?: boolean;
}) {
  if (!props.provider || !isCodexCliProvider(props.provider)) return null;
  const levels = codexCliReasoningEfforts(normalizeCodexCliModel(props.model));
  if (!levels.length) return null;
  const selected = props.value && levels.includes(props.value) ? props.value : "";

  return (
    <div className="field">
      <label>Reasoning effort</label>
      <Select
        ariaLabel="Reasoning effort"
        disabled={props.disabled}
        value={selected}
        options={[
          { value: "", label: "Auto (Codex default)" },
          ...levels.map((level) => ({
            value: level,
            label: level === "xhigh" ? "XHigh" : level[0]!.toUpperCase() + level.slice(1),
          })),
        ]}
        onChange={(value) =>
          props.onChange((value || undefined) as CodexReasoningEffort | undefined)
        }
      />
      <p className="hint">Controls how much reasoning Codex uses for this model.</p>
    </div>
  );
}

function CodexReasoningControls(props: {
  model: string;
  value?: CodexReasoningEffort;
  onChange: (value: CodexReasoningEffort | undefined) => void;
  compact: true;
  disabled?: boolean;
}) {
  const levels = codexCliReasoningEfforts(props.model);
  if (!levels.length) return null;
  const selected = props.value && levels.includes(props.value) ? props.value : undefined;

  return (
    <>
      <MenuLabel>Reasoning effort</MenuLabel>
      <MenuItem
        active={!selected}
        disabled={props.disabled}
        onClick={() => props.onChange(undefined)}
      >
        Auto
      </MenuItem>
      {levels.map((level) => (
        <MenuItem
          key={level}
          active={selected === level}
          disabled={props.disabled}
          onClick={() => props.onChange(level)}
        >
          {formatReasoningEffort(level)}
        </MenuItem>
      ))}
    </>
  );
}

function formatReasoningEffort(level: CodexReasoningEffort): string {
  return level === "xhigh" ? "XHigh" : level[0]!.toUpperCase() + level.slice(1);
}

function hasCursorModelOptions(model: string): boolean {
  const caps = cursorModelCapabilities(model);
  return caps.supportsFast || caps.thinkingLevels.length > 0;
}

export function CursorModelControls(props: {
  model: string;
  onChange: (model: string) => void;
  compact?: boolean;
  disabled?: boolean;
}) {
  const parsed = parseCursorModelId(props.model);
  const caps = cursorModelCapabilities(parsed.base);
  if (!caps.supportsFast && caps.thinkingLevels.length === 0) return null;

  const emit = (next: { fast?: boolean; thinking?: (typeof parsed)["thinking"] }) =>
    props.onChange(
      formatCursorModelId({
        base: parsed.base,
        fast: next.fast ?? parsed.fast,
        thinking: next.thinking ?? parsed.thinking,
      }),
    );

  const thinkingValue = caps.thinkingLevels.some((row) => row.value === parsed.thinking)
    ? parsed.thinking
    : caps.defaultThinking;

  if (props.compact) {
    return (
      <>
        {caps.supportsFast ? (
          <button
            type="button"
            role="menuitemcheckbox"
            className="menu-item menu-fast-toggle"
            aria-checked={parsed.fast}
            aria-label="Fast"
            disabled={props.disabled}
            onClick={() => emit({ fast: !parsed.fast })}
          >
            Fast
            <span className={`settings-switch${parsed.fast ? " on" : ""}`} aria-hidden="true" />
          </button>
        ) : null}
        {caps.thinkingLevels.length ? (
          <>
            {caps.supportsFast ? <MenuSep /> : null}
            <MenuLabel>Thinking</MenuLabel>
            {caps.thinkingLevels.map((row) => (
              <MenuItem
                key={row.value}
                active={thinkingValue === row.value}
                disabled={props.disabled}
                onClick={() => emit({ thinking: row.value })}
              >
                {row.label}
              </MenuItem>
            ))}
          </>
        ) : null}
      </>
    );
  }

  const fastControl = caps.supportsFast ? (
    <div className="field">
      <label>Fast</label>
      <Select
        ariaLabel="Fast"
        disabled={props.disabled}
        value={parsed.fast ? "fast" : "off"}
        options={[
          { value: "off", label: "Off" },
          { value: "fast", label: "On" },
        ]}
        onChange={(value) => emit({ fast: value === "fast" })}
      />
    </div>
  ) : null;

  const thinkingControl = caps.thinkingLevels.length ? (
    <div className="field">
      <label>Thinking</label>
      <Select
        ariaLabel="Thinking"
        disabled={props.disabled}
        value={thinkingValue}
        options={caps.thinkingLevels.map((row) => ({ value: row.value, label: row.label }))}
        onChange={(value) => emit({ thinking: value as (typeof parsed)["thinking"] })}
      />
    </div>
  ) : null;

  return (
    <div className="grid-2 model-picker-cursor">
      {fastControl}
      {thinkingControl}
    </div>
  );
}

function CostCompare({ costs }: { costs: ReturnType<typeof projectedModelCosts> }) {
  return (
    <div className="model-cost">
      <p className="hint">
        Projected in / out · approx. published $/1M tokens ({PRICING_AS_OF}). Settings can override.
      </p>
      <table className="model-cost-table">
        <thead>
          <tr>
            <th>Provider</th>
            <th>Model</th>
            <th className="num">In</th>
            <th className="num">Out</th>
          </tr>
        </thead>
        <tbody>
          {costs.map((row) => (
            <tr key={row.providerId} className={row.current ? "current" : undefined}>
              <td>
                {row.providerName}
                {row.current ? " · selected" : ""}
              </td>
              <td className="model-id">{row.model}</td>
              <td className="num">
                {rateCell(row.rates?.inputUsdPerMillion, row.source === "unknown")}
              </td>
              <td className="num">
                {rateCell(row.rates?.outputUsdPerMillion, row.source === "unknown")}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function rateCell(amount: number | undefined, unknown: boolean): string {
  if (unknown || amount == null) return "—";
  return formatUsdPerMillion(amount);
}
