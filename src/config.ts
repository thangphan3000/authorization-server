export type AppConfig = {
  host: string;
  port: number;
  issuer: string;
  audience: string;
  tokenTtlSeconds: number;
  jwtKeyId: string;
  jwtPrivateKeyPem: string;
  oauthClientId: string;
  oauthClientSecret: string;
  oauthClientScopes: string[];
};

export function createConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const host = env.HOST ?? '127.0.0.1';
  const port = Number(env.PORT ?? 3000);

  return {
    host,
    port,
    issuer: `http://${host}:${port}`,
    audience: env.JWT_AUDIENCE ?? 'protected-api',
    tokenTtlSeconds: Number(env.ACCESS_TOKEN_TTL_SECONDS ?? 60 * 60),
    jwtKeyId: env.JWT_KEY_ID ?? 'auth-server-dev-key-1',
    jwtPrivateKeyPem: requireEnv(env, 'JWT_PRIVATE_KEY_PEM'),
    oauthClientId: requireEnv(env, 'OAUTH_CLIENT_ID'),
    oauthClientSecret: requireEnv(env, 'OAUTH_CLIENT_SECRET'),
    oauthClientScopes: requireScopes(env, 'OAUTH_CLIENT_SCOPES'),
  };
}

export function parseScopes(scope: unknown): string[] {
  if (typeof scope !== 'string' || scope.trim() === '') {
    return [];
  }

  return scope.trim().split(/\s+/);
}

function requireEnv(env: NodeJS.ProcessEnv, name: string): string {
  const value = env[name];

  if (!value) {
    throw new Error(`${name} environment variable is required.`);
  }

  return value;
}

function requireScopes(env: NodeJS.ProcessEnv, name: string): string[] {
  const scopes = parseScopes(requireEnv(env, name));

  if (scopes.length === 0) {
    throw new Error(`${name} must contain at least one scope.`);
  }

  return scopes;
}
