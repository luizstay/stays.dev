# stays.dev on Easypanel

Create a Compose service with Git source:

- Repository: `https://github.com/luizstay/stays.dev.git`
- Branch: `main`
- Build path: `/deployment/easypanel`
- Compose file: `compose.yml`
- Domain target: `caddy`, HTTP port `80`; Easypanel handles HTTPS.

In Environment, enable **Create .env file** and set:

```dotenv
COMPOSE_PARALLEL_LIMIT=1
POSTGRES_PASSWORD=<random hex>
DOABLE_APP_PASSWORD=<different random hex>
JWT_SECRET=<32 random bytes as hex>
ENCRYPTION_KEY=<32 random bytes as hex>
INTERNAL_SECRET=<32 random bytes as hex>
DOABLE_KEK=<32 random bytes as base64>
INSTALL_BOOTSTRAP_TOKEN=<random hex>
INSTALL_BOOTSTRAP_TOKEN_EXPIRES_AT=<future ISO timestamp>
NEXT_PUBLIC_APP_URL=https://your-hostname
NEXT_PUBLIC_API_URL=https://your-hostname/api
NEXT_PUBLIC_WS_URL=wss://your-hostname/ws
CORS_ORIGINS=https://your-hostname
```

Keep secrets in Easypanel, never in Git. Preserve DOABLE_KEK and database passwords on subsequent deployments. Named volumes persist database, generated projects, thumbnails and published sites. The migration container runs before API and WebSocket startup, using the database owner; runtime services use the restricted doable_app role.

This configuration keeps the upstream container sandbox defaults. It does not enable per-project process isolation; review that boundary before admitting untrusted tenants. Configure GitHub OAuth separately before enabling repository connections for customers.
