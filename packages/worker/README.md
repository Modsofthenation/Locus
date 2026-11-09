# `@locus/worker`

HTTPS service that runs Docker, Host, and QEMU guests on another machine. The laptop control plane pins the worker cert fingerprint.

```bash
npm run dev:worker
```

Paste the printed `locus-worker:add` line in Settings → Workers. QEMU cloud images go in `LOCUS_WORKER_HOME/media`. Live VNC is loopback on the worker and proxied to the laptop over WSS `/v1/guests/:id/display`. Golden VM disks are `PUT /v1/images/:id`. Control planes send `X-Locus-Plane` so one token can namespace guests. See [docs/agent-backends.md](../../docs/agent-backends.md).
