# `locus/agent`

First-party Docker image for Docker-runtime agents: git, Node, Chromium, ripgrep, code-server.

```bash
npm run images   # docker build -t locus/agent:0.1 images/agent
```

`git-credential-locus` is the credential helper injected into the guest. Rebuild after Dockerfile changes; the tag in the root `package.json` `images` script must match what New agent expects.

The image tag (`locus/agent:0.1`) is independent of the app semver (`0.10.x`). Do not retag it when bumping the desktop version.
