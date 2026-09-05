import crypto from 'node:crypto';
import express, { type Express, type Request, type Response } from 'express';

const app: Express = express();
const PORT = Number(process.env.PORT ?? 3000);
const HOST = process.env.HOST ?? '127.0.0.1';

type OAuthClient = {
  id: string;
  secret: string;
  allowedGrantTypes: string[];
  scopes: string[];
};

type JwtHeader = {
  alg: 'RS256';
  typ: 'JWT';
  kid: string;
};

type AccessTokenPayload = {
  iss: string;
  sub: string;
  aud: string;
  client_id: string;
  scope: string;
  token_type: 'Bearer';
  iat: number;
  exp: number;
};

type VerifiedAccessToken = AccessTokenPayload & {
  header: JwtHeader;
};

const tokenTtlSeconds = 60 * 60;
const issuer = `http://${HOST}:${PORT}`;
const jwksKeyId = process.env.JWT_KEY_ID ?? 'auth-server-dev-key-1';
const audience = 'protected-api';
const { privateKey, publicKey } = createSigningKeys();
const publicJwk = publicKey.export({ format: 'jwk' });
const clients = createClients();

app.use(express.urlencoded({ extended: false }));
app.use(express.json());

app.get('/', (req: Request, res: Response) => {
  res.json({
    issuer,
    token_endpoint: `${issuer}/oauth/token`,
    introspection_endpoint: `${issuer}/oauth/introspect`,
    jwks_uri: `${issuer}/.well-known/jwks.json`,
  });
});

app.get('/.well-known/jwks.json', (req: Request, res: Response) => {
  res.json({
    keys: [
      {
        ...publicJwk,
        kid: jwksKeyId,
        alg: 'RS256',
        use: 'sig',
      },
    ],
  });
});

app.post('/oauth/token', (req: Request, res: Response) => {
  const client = authenticateClient(req);

  if (!client) {
    res.status(401).json({
      error: 'invalid_client',
      error_description: 'Client authentication failed.',
    });
    return;
  }

  if (req.body.grant_type !== 'client_credentials') {
    res.status(400).json({
      error: 'unsupported_grant_type',
      error_description: 'Only client_credentials is supported.',
    });
    return;
  }

  if (!client.allowedGrantTypes.includes('client_credentials')) {
    res.status(400).json({
      error: 'unauthorized_client',
      error_description: 'Client is not allowed to use client_credentials.',
    });
    return;
  }

  const requestedScopes = parseScopes(req.body.scope);
  const unauthorizedScopes = requestedScopes.filter((scope) => !client.scopes.includes(scope));

  if (unauthorizedScopes.length > 0) {
    res.status(400).json({
      error: 'invalid_scope',
      error_description: `Client is not allowed to request: ${unauthorizedScopes.join(' ')}`,
    });
    return;
  }

  const grantedScopes = requestedScopes.length > 0 ? requestedScopes : client.scopes;
  const now = Math.floor(Date.now() / 1000);
  const expiresAt = now + tokenTtlSeconds;
  const accessToken = signAccessToken({
    iss: issuer,
    sub: client.id,
    aud: audience,
    client_id: client.id,
    scope: grantedScopes.join(' '),
    token_type: 'Bearer',
    iat: now,
    exp: expiresAt,
  });

  res.set('Cache-Control', 'no-store');
  res.set('Pragma', 'no-cache');
  res.status(200).json({
    access_token: accessToken,
    token_type: 'Bearer',
    expires_in: tokenTtlSeconds,
    scope: grantedScopes.join(' '),
  });
});

app.post('/oauth/introspect', (req: Request, res: Response) => {
  const client = authenticateClient(req);

  if (!client) {
    res.status(401).json({
      error: 'invalid_client',
      error_description: 'Client authentication failed.',
    });
    return;
  }

  const tokenValue = typeof req.body.token === 'string' ? req.body.token : '';
  const token = verifyAccessToken(tokenValue);

  if (!token) {
    res.status(200).json({ active: false });
    return;
  }

  res.status(200).json({
    active: true,
    iss: token.iss,
    sub: token.sub,
    aud: token.aud,
    client_id: token.client_id,
    scope: token.scope,
    token_type: token.token_type,
    iat: token.iat,
    exp: token.exp,
  });
});

const server = app.listen(PORT, HOST, () => {
  console.log(`OAuth2 authorization server is listening at http://${HOST}:${PORT}`);
});

server.on('error', (error) => {
  console.error('Failed to start OAuth2 authorization server:', error);
  process.exit(1);
});

function authenticateClient(req: Request): OAuthClient | undefined {
  const credentials = parseBodyCredentials(req.body);

  if (!credentials) {
    return undefined;
  }

  const client = clients.get(credentials.clientId);

  if (!client || client.secret !== credentials.clientSecret) {
    return undefined;
  }

  return client;
}

function parseBodyCredentials(
  body: unknown,
): { clientId: string; clientSecret: string } | undefined {
  if (!isRecord(body)) {
    return undefined;
  }

  const { client_id: clientId, client_secret: clientSecret } = body;

  if (typeof clientId !== 'string' || typeof clientSecret !== 'string') {
    return undefined;
  }

  return { clientId, clientSecret };
}

function parseScopes(scope: unknown): string[] {
  if (typeof scope !== 'string' || scope.trim() === '') {
    return [];
  }

  return scope.trim().split(/\s+/);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function createSigningKeys(): {
  privateKey: crypto.KeyObject;
  publicKey: crypto.KeyObject;
} {
  const privateKeyPem = process.env.JWT_PRIVATE_KEY_PEM;

  if (!privateKeyPem) {
    throw new Error('JWT_PRIVATE_KEY_PEM environment variable is required.');
  }

  const configuredPrivateKey = crypto.createPrivateKey(privateKeyPem.replace(/\\n/g, '\n'));

  return {
    privateKey: configuredPrivateKey,
    publicKey: crypto.createPublicKey(configuredPrivateKey),
  };
}

function createClients(): Map<string, OAuthClient> {
  const clientId = process.env.OAUTH_CLIENT_ID;
  const clientSecret = process.env.OAUTH_CLIENT_SECRET;

  if (!clientId) {
    throw new Error('OAUTH_CLIENT_ID environment variable is required.');
  }

  if (!clientSecret) {
    throw new Error('OAUTH_CLIENT_SECRET environment variable is required.');
  }

  const scopes = parseScopes(process.env.OAUTH_CLIENT_SCOPES ?? 'users:read orders:read');

  return new Map<string, OAuthClient>([
    [
      clientId,
      {
        id: clientId,
        secret: clientSecret,
        allowedGrantTypes: ['client_credentials'],
        scopes,
      },
    ],
  ]);
}

function signAccessToken(payload: AccessTokenPayload): string {
  const header: JwtHeader = {
    alg: 'RS256',
    typ: 'JWT',
    kid: jwksKeyId,
  };
  const encodedHeader = base64UrlEncode(JSON.stringify(header));
  const encodedPayload = base64UrlEncode(JSON.stringify(payload));
  const signingInput = `${encodedHeader}.${encodedPayload}`;
  const signature = crypto.sign('RSA-SHA256', Buffer.from(signingInput), privateKey);

  return `${signingInput}.${signature.toString('base64url')}`;
}

function verifyAccessToken(token: string): VerifiedAccessToken | undefined {
  const parts = token.split('.');

  if (parts.length !== 3) {
    return undefined;
  }

  const [encodedHeader, encodedPayload, encodedSignature] = parts;

  if (!encodedHeader || !encodedPayload || !encodedSignature) {
    return undefined;
  }

  const signingInput = `${encodedHeader}.${encodedPayload}`;
  const isValidSignature = crypto.verify(
    'RSA-SHA256',
    Buffer.from(signingInput),
    publicKey,
    Buffer.from(encodedSignature, 'base64url'),
  );

  if (!isValidSignature) {
    return undefined;
  }

  const header = parseJwtJson<JwtHeader>(encodedHeader);
  const payload = parseJwtJson<AccessTokenPayload>(encodedPayload);
  const now = Math.floor(Date.now() / 1000);

  if (
    !header ||
    !payload ||
    header.alg !== 'RS256' ||
    header.kid !== jwksKeyId ||
    payload.iss !== issuer ||
    payload.aud !== audience ||
    payload.token_type !== 'Bearer' ||
    payload.exp <= now
  ) {
    return undefined;
  }

  return {
    ...payload,
    header,
  };
}

function parseJwtJson<T>(encodedValue: string): T | undefined {
  try {
    return JSON.parse(Buffer.from(encodedValue, 'base64url').toString('utf8')) as T;
  } catch {
    return undefined;
  }
}

function base64UrlEncode(value: string): string {
  return Buffer.from(value).toString('base64url');
}
