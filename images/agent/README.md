# `locus/agent`

First-party Docker image for Docker-runtime agents: git, Node, Chromium, ripgrep, code-server.

```bash
npm run images   # docker build -t locus/agent:0.1 -t locus/agent:0.21.0 images/agent
```

`git-credential-locus` is the credential helper injected into the guest. Rebuild after Dockerfile changes; the tag in the root `package.json` `images` script must match what New agent expects.

The runtime tag (`locus/agent:0.1`) stays stable so existing guests keep working. Builds also apply `locus/agent:<app version>`.
