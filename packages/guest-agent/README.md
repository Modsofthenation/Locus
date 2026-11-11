# `@locus/guest-agent`

Commands the agent runs **in the guest**: files, git, shell, browser CDP, screenshots. Transports are SSH, WinRM, and `docker exec`. `createGuestRuntime` is the Guest factory both the control plane and worker hubs use. Browser CDP routing and remote screenshot/record shaping sit behind one interface each.

```bash
npm test --workspace=@locus/guest-agent
```

Guest tools stay on the guest. MCP is the exception (stdio on the host, opt-in, approval-gated).
