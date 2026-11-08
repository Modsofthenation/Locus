import type { AgentRuntime, GuestOs } from "./vm.js";
import { sessionRuntime } from "./vm.js";

export interface GoldenImage {
  id: string;
  name: string;
  os: GuestOs;
  path: string;
  sourceVmId?: string;
  runtime?: AgentRuntime;
  dockerImage?: string;
  createdAt: string;
}

export function imageRuntime(image: Pick<GoldenImage, "runtime">): AgentRuntime {
  return sessionRuntime({ runtime: image.runtime });
}

export function latestGoldenImage(
  images: GoldenImage[],
  os: GuestOs,
  runtime: AgentRuntime = "vm",
): GoldenImage | undefined {
  return images
    .filter((img) => img.os === os && imageRuntime(img) === runtime)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
}

export const VIRTIO_ISO = {
  name: "VirtIO win drivers",
  url: "https://fedorapeople.org/groups/virt/virtio-win/direct-downloads/stable-virtio/virtio-win.iso",
  filename: "virtio-win.iso",
};

export type CloudImageArch = "amd64" | "arm64";

export function hostCloudImageArch(arch: string = process.arch): CloudImageArch {
  return arch === "arm64" ? "arm64" : "amd64";
}

export const CLOUD_IMAGE_CATALOG: Array<{
  os: GuestOs;
  name: string;
  url: string;
  filename: string;
  arch?: CloudImageArch;
}> = [
  {
    os: "ubuntu",
    name: "Ubuntu 24.04 cloud image",
    url: "https://cloud-images.ubuntu.com/releases/24.04/release/ubuntu-24.04-server-cloudimg-amd64.img",
    filename: "ubuntu-24.04-server-cloudimg-amd64.img",
    arch: "amd64",
  },
  {
    os: "ubuntu",
    name: "Ubuntu 24.04 cloud image (arm64)",
    url: "https://cloud-images.ubuntu.com/releases/24.04/release/ubuntu-24.04-server-cloudimg-arm64.img",
    filename: "ubuntu-24.04-server-cloudimg-arm64.img",
    arch: "arm64",
  },
  {
    os: "debian",
    name: "Debian 12 cloud image",
    url: "https://cloud.debian.org/images/cloud/bookworm/latest/debian-12-genericcloud-amd64.qcow2",
    filename: "debian-12-genericcloud-amd64.qcow2",
    arch: "amd64",
  },
  {
    os: "debian",
    name: "Debian 12 cloud image (arm64)",
    url: "https://cloud.debian.org/images/cloud/bookworm/latest/debian-12-genericcloud-arm64.qcow2",
    filename: "debian-12-genericcloud-arm64.qcow2",
    arch: "arm64",
  },
  {
    os: "omarchy",
    name: "Omarchy 4.0.1 ISO",
    url: "https://iso.omarchy.org/omarchy-4.0.1.iso",
    filename: "omarchy-4.0.1.iso",
  },
];

export function cloudImageFor(
  os: GuestOs,
  arch: CloudImageArch = hostCloudImageArch(),
): (typeof CLOUD_IMAGE_CATALOG)[number] | undefined {
  return (
    CLOUD_IMAGE_CATALOG.find((row) => row.os === os && (row.arch ?? "amd64") === arch) ??
    CLOUD_IMAGE_CATALOG.find((row) => row.os === os)
  );
}
