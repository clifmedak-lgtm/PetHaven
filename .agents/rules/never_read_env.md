# Rule: Never Read or Inspect .env Files

- **CRITICAL RESTRICTION**: You MUST NEVER open, view, grep, read, or inspect `.env` files or any file containing secret environment variables (e.g. `.env`, `.env.local`, `.env.production`).
- If an environment variable is needed for debugging, ask the user directly or use fallback default values without reading `.env`.
