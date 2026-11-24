# Cloud compute architecture decision

Extend `ComputeBackend`, the existing backend registry, and the worker transport. The control plane retains agent execution, model selection, approvals, and tooling. The Fargate task serves the existing pinned worker protocol, so shell and workspace access use the same guest abstraction as other worker deployments.

The first increment makes Fargate provisioning and teardown recoverable. ECS receives a unique client token and discovery marker only after the server has persisted the provisioning intent. Concurrency counts intents, active tasks, and tasks awaiting confirmed teardown. Recovery uses the recorded scope and promotes an intent to its task ARN in a single registry update. The existing control plane owns one registry writer. Provider failure and local persistence failure both retain the last committed record. Existing task ARN records continue to load.

The managed sandbox increment adds Daytona, E2B, Modal, and Runloop through one lease manager. Provider adapters own their create, discovery, authenticated gateway, and teardown calls. The lease manager records an operator-priced USD commitment before provisioning. It enforces the configured session compute allowance across successive leases and requests a provider-native lifetime bound for each one. Gateway credentials stay in memory, so recovery terminates these disposable resources after a control-plane restart.

Further work includes operation-wide compute and combined budgets, regional provider pricing, invoice reconciliation, and live-provider validation. See [managed sandbox setup and verification](managed-sandboxes.md).
