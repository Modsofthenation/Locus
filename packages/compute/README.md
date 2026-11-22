# `@locus/compute`

Fargate placement: size allowlist, recorded HTTP to ECS (`RunTask` / `DescribeTasks` / `StopTask`), no AWS SDK.

```bash
npm test --workspace=@locus/compute
```

Quotes and task lifecycle used when New agent → Where is a Fargate worker. `provision` takes an optional `workerTls` identity that Fargate injects into the `worker` container so the cert is pinned before the task starts. Image + task definition: [`images/worker`](../../images/worker/README.md).
