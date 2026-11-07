# Docker Swarm

First-party Docker Swarm support talks to **this machine's Docker engine** — the same daemon as the Docker rail and `locus docker list`. It is not Locus **Swarm** product mode (multi-agent teams), and it is not the [Portainer integration](portainer.md) (a remote Portainer API).

When the engine is inactive, the Swarm tab says so. Point `DOCKER_HOST` at a manager, or initialize a swarm with the Docker CLI, then Refresh.

## Operator UI

Docker rail → **Swarm**:

- Services (replicas, image, ports)
- Nodes (Ready / Leader / worker)
- Stacks (name and service count)
- Service detail: logs, tasks, **Scale** (replicated only)

Workers that are in the swarm but not managers show status without a service list.

## CLI

```bash
npx locus docker swarm status
npx locus docker swarm nodes
npx locus docker swarm services
npx locus docker swarm stacks
npx locus docker swarm get web
npx locus docker swarm logs web --tail 200
npx locus docker swarm scale web 3
```

## Agent tool

`docker_swarm` is host-side. Coding agents (not Design canvases) get it without a Settings token. Scale waits for Approve / Deny unless autonomy is Autonomous.

| Action | Purpose |
| --- | --- |
| `status` (default) | Cluster snapshot: info, nodes, services, stacks |
| `nodes` | Node list |
| `services` | Service list, or pass `service` to include tasks |
| `stacks` | Stack list |
| `logs` | `docker service logs` (`service` required, optional `tail`) |
| `scale` | Set replica count (`service` + `replicas`, 0–256). Approve gated |

Do not `exec docker swarm` from the guest. Cursor CLI sees the same tool on the loopback MCP server.

## Automations

Coding automations (including Ops loop) already receive `docker_swarm` on the host catalog. Scale still waits for Approve unless autonomy is Autonomous. This tool is not a Settings → Integrations token; Portainer stays the remote-API path.

## Security

- Same Docker socket the operator already trusts for containers.
- Scale is a write. Supervised / Guided wait for Approve.
- Service logs can include secrets the process printed — treat them as untrusted data.

See [SECURITY.md](../SECURITY.md).
