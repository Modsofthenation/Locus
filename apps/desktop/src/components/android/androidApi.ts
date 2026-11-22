import type {
  AndroidAction,
  AndroidEnvironment,
  AndroidJob,
  AndroidProjectInfo,
} from "@locus/shared";
import { apiFetch, errorMessageFromResponse, json } from "@/lib/apiHttp";

export const androidBase = (id: string) => `/api/sessions/${encodeURIComponent(id)}/android`;
export const androidApi = {
  environment: (id: string) => json<AndroidEnvironment>(`${androidBase(id)}/environment`),
  boot: (id: string, avd: string) =>
    json(`${androidBase(id)}/boot`, { method: "POST", body: JSON.stringify({ avd }) }),
  project: (id: string) => json<AndroidProjectInfo>(`${androidBase(id)}/project`),
  stopMetro: (id: string) => json(`${androidBase(id)}/metro/stop`, { method: "POST" }),
  job: (id: string) => json<{ job: AndroidJob | null }>(`${androidBase(id)}/job`),
  run: (id: string, action: AndroidAction, serial: string, packageName: string) =>
    json<AndroidJob>(`${androidBase(id)}/job`, {
      method: "POST",
      body: JSON.stringify({ action, serial: serial || undefined, packageName }),
    }),
  stop: (id: string, serial: string) =>
    json(`${androidBase(id)}/stop`, { method: "POST", body: JSON.stringify({ serial }) }),
  input: (id: string, serial: string, input: object) =>
    json(`${androidBase(id)}/input`, { method: "POST", body: JSON.stringify({ serial, input }) }),
  screen: async (id: string, serial: string, signal: AbortSignal) => {
    const response = await apiFetch(
      `${androidBase(id)}/screen?serial=${encodeURIComponent(serial)}`,
      { signal },
    );
    if (!response.ok) throw new Error(await errorMessageFromResponse(response));
    return response.blob();
  },
};
