import { stat } from "node:fs/promises";
import {
  imageRuntime,
  isLocalOpenAiBase,
  isOllamaProvider,
  parseDockerImage,
  policyForcedJail,
  providerAllowedByPolicy,
  type AiProvider,
  type LocusConfig,
  type ProjectOfflineProfile,
  type ProjectOfflinePreflight,
} from "@locus/shared";
import type { JsonStore } from "../core/store.js";

const OFFLINE_TOOLS = new Set([
  "ask_user",
  "exec",
  "file_read",
  "file_write",
  "file_list",
  "grep",
  "glob",
  "apply_patch",
  "git_status",
  "git_diff",
  "git_log",
  "git_commit",
  "git_branch",
  "canvas_write",
  "canvas_read",
  "preview",
  "project_get",
  "project_spawn",
  "project_stop",
  "project_collect",
  "project_context_list",
  "project_context_read",
  "project_context_write",
  "project_context_delete",
]);

export function offlineProjectTool(name: string, coordinator: boolean): boolean {
  return (
    OFFLINE_TOOLS.has(name) && (!coordinator || name.startsWith("project_") || name === "ask_user")
  );
}

export function offlineProjectProvider(config: LocusConfig, providerId: string): AiProvider {
  const provider = config.providers.find((row) => row.id === providerId);
  if (
    !provider ||
    provider.kind !== "openai-compatible" ||
    !isOllamaProvider(provider) ||
    !isLocalOpenAiBase(provider.baseUrl)
  ) {
    throw new Error("Configure a loopback Ollama provider in Settings");
  }
  const url = new URL(provider.baseUrl);
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) {
    throw new Error("Ollama must use a loopback HTTP or HTTPS URL");
  }
  if (
    config.managedPolicy?.active &&
    !providerAllowedByPolicy(provider, config.managedPolicy.policy)
  ) {
    throw new Error("Managed policy does not allow this provider");
  }
  return provider;
}

export function offlineProviderFetch(fetchFn: typeof fetch): typeof fetch {
  return (request, init) => {
    const url = request instanceof Request ? request.url : String(request);
    if (!isLocalOpenAiBase(url)) throw new Error("Offline projects require a loopback model");
    return fetchFn(request, { ...init, redirect: "error" });
  };
}

export async function inspectOfflineProfile(
  store: JsonStore,
  profile: ProjectOfflineProfile,
  ports: { hasImage: (image: string) => Promise<boolean>; fetchFn: typeof fetch },
): Promise<ProjectOfflinePreflight> {
  const config = await store.loadConfig();
  const image = parseDockerImage(profile.dockerImage);
  const checks = await Promise.all([
    (async () => {
      try {
        const provider = offlineProjectProvider(config, profile.providerId);
        const response = await offlineProviderFetch(ports.fetchFn)(
          new URL("/api/tags", provider.baseUrl),
          {
            signal: AbortSignal.timeout(3000),
          },
        );
        if (!response.ok) throw new Error("Ollama did not return its model list");
        const { models } = (await response.json()) as {
          models?: { name?: string; remote_host?: string; remote_model?: string }[];
        };
        const ready = Boolean(
          models?.some(
            (row) =>
              !row.remote_host &&
              !row.remote_model &&
              (row.name === profile.model || row.name === `${profile.model}:latest`),
          ),
        );
        return {
          label: "Ollama model",
          ready,
          detail: ready ? profile.model : `Pull ${profile.model} into Ollama before disconnecting`,
        };
      } catch (error) {
        return {
          label: "Ollama model",
          ready: false,
          detail: error instanceof Error ? error.message : String(error),
        };
      }
    })(),
    (async () => {
      const jail = policyForcedJail(config.managedPolicy);
      if (jail && jail !== "none")
        return {
          label: "Docker image",
          ready: false,
          detail: "Managed policy requires a different Docker network mode",
        };
      const ready = image ? await ports.hasImage(image).catch(() => false) : false;
      return {
        label: "Docker image",
        ready,
        detail: ready
          ? image!
          : `Start Docker and cache ${image ?? "a valid image"} before disconnecting`,
      };
    })(),
  ]);
  if (profile.imageId) {
    const seed = (await store.loadImages()).find((row) => row.id === profile.imageId);
    const available =
      seed &&
      imageRuntime(seed) === "docker" &&
      (await stat(seed.path).catch(() => undefined))?.isDirectory();
    checks.push({
      label: "Golden workspace",
      ready: Boolean(available),
      detail: available ? seed.name : "Choose a cached Docker golden workspace",
    });
  }
  return {
    checks,
    unavailable: [
      "Cloud models",
      "Web search",
      "Forge cloning and pull requests",
      "MCP and external integrations",
      "Remote workers",
      "Guest network access",
    ],
  };
}
