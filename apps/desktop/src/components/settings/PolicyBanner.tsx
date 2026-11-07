import { policyBannerLabel, type LocusConfig } from "@locus/shared";

export function PolicyBanner({ config }: { config?: LocusConfig | null }) {
  const label = policyBannerLabel(config?.managedPolicy);
  if (!label) return null;
  const source = config?.managedPolicy?.source;
  return (
    <div className="policy-banner" role="status">
      <strong>{label}.</strong>{" "}
      <span>
        Providers, sandbox, and jail are locked
        {source ? ` · ${source}` : ""}. Greyed controls cannot be changed in Settings.
      </span>
    </div>
  );
}

export function policyControlLocked(config: LocusConfig | null | undefined, key: string): boolean {
  return Boolean(config?.managedPolicy?.active && config.managedPolicy.locked.includes(key));
}
