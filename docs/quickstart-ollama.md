# Try Locus with Ollama (no API key)

Local OpenAI-compatible servers such as [Ollama](https://ollama.com/) do not need a provider key.

1. Install and start Ollama, then pull a chat model:

   ```bash
   ollama pull llama3.2
   ```

2. Confirm the OpenAI-compatible endpoint answers:

   ```bash
   curl -s http://127.0.0.1:11434/v1/models | head
   ```

3. In Locus, open **Settings → Providers**. Enable **Ollama** (base URL `http://127.0.0.1:11434/v1`). Leave the key empty. Click **Refresh models** and pick the model you pulled.

4. Create a **Host** agent (no Docker or QEMU required):

   ```bash
   npm run locus -- agent new "Say hello in one sentence" --runtime host --provider ollama
   ```

   Or in the app: **New agent → Host → Send**.

5. If chat still looks like a canned “I heard: …” reply, no enabled provider was ready — the composer shows a **Demo mode** banner until Ollama (or another provider) is enabled.

See [troubleshooting.md](troubleshooting.md) if the control plane is not running.
