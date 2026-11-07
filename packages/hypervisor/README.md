# `@locus/hypervisor`

QEMU and Docker guest engines, plus in-process mocks so the UI runs without QEMU or Docker.

```bash
npm test --workspace=@locus/hypervisor
```

`createHypervisor` / `createDockerEngine` pick a live engine when the host has the binaries, otherwise a mock. ISO, cloud-init, unattend, and network jail helpers live here too. The Docker engine also reports Swarm info, nodes, services, stacks, service logs, and scale (`swarmInfo` / `listSwarm*` / `scaleSwarmService`). Mock engines stay inactive until a test calls `seedSwarm`.
