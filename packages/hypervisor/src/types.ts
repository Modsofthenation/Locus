import type {
  AdvancedSettings,
  DisplayEndpoint,
  SerialEndpoint,
  VmInstance,
  VmLifecycle,
  VmNetworking,
  VmTemplate,
} from "@locus/shared";
import type { HostCapabilities } from "./detect.js";

export interface CreateVmRequest {
  sessionId: string;
  name: string;
  template: VmTemplate;
  slot?: number;
  imagePath?: string;
  hostSharePath?: string;
}

export type VmListener = (id: string, status: VmLifecycle, error?: string) => void;

/**
 * Shared machine lifecycle at the hypervisor / Docker engine seam.
 * Runtime-specific ops (create request shape, display, host containers) stay on those interfaces.
 */
export interface MachineLifecycle {
  available(): Promise<boolean>;
  start(id: string): Promise<VmInstance>;
  stop(id: string): Promise<VmInstance>;
  pause(id: string): Promise<VmInstance>;
  destroy(id: string): Promise<void>;
  get(id: string): VmInstance | undefined;
  list(): VmInstance[];
  logs(id: string): string;
  onStatus(listener: VmListener): void;
  /**
   * Live QEMU guests must stop before restoreDisk. In-memory mock adapters restore in place.
   */
  restoreRequiresStop?: boolean;
  /**
   * Live QEMU guests should pause before snapshotDisk so the qcow2 is consistent.
   */
  snapshotRequiresPause?: boolean;
  /**
   * Live engines talk to a real hypervisor or Docker daemon (vs the in-memory mock adapter).
   */
  liveEngine?: boolean;
}

export interface Hypervisor extends MachineLifecycle {
  readonly kind: "mock" | "qemu";
  nextSlot(): number;
  create(req: CreateVmRequest): Promise<VmInstance>;
  resume?(id: string): Promise<VmInstance>;
  adopt?(
    instance: VmInstance,
    template: VmTemplate,
    extras?: { imagePath?: string; hostSharePath?: string },
  ): VmInstance;
  snapshotDisk?(id: string, destPath: string): Promise<void>;
  restoreDisk?(id: string, srcPath: string): Promise<void>;
  configureNetwork?(id: string, patch: Pick<VmNetworking, "restrict" | "proxyPort">): void;
  display(id: string): DisplayEndpoint | undefined;
  serial(id: string): SerialEndpoint | undefined;
  refresh?(advanced: AdvancedSettings): Promise<HostCapabilities>;
  /** Empty installer / cloud-image path. Mock omits this; QEMU implements it. */
  isoError?(
    template: { os: string; isoPath: string },
    opts?: { imageId?: string },
  ): string | undefined;
}
