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

export const CLOUD_IMAGE_CATALOG: Array<{
  os: GuestOs;
  name: string;
  url: string;
  filename: string;
}> = [
  {
    os: "ubuntu",
    name: "Ubuntu 24.04 cloud image",
    url: "https://cloud-images.ubuntu.com/releases/24.04/release/ubuntu-24.04-server-cloudimg-amd64.img",
    filename: "ubuntu-24.04-server-cloudimg-amd64.img",
  },
  {
    os: "debian",
    name: "Debian 12 cloud image",
    url: "https://cloud.debian.org/images/cloud/bookworm/latest/debian-12-genericcloud-amd64.qcow2",
    filename: "debian-12-genericcloud-amd64.qcow2",
  },
  {
    os: "omarchy",
    name: "Omarchy 4.0.1 ISO",
    url: "https://iso.omarchy.org/omarchy-4.0.1.iso",
    filename: "omarchy-4.0.1.iso",
  },
];
