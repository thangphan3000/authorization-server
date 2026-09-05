import { Router, type Request, type Response } from 'express';
import { findClient, type OAuthClient } from './clients.ts';
import { parseScopes, type AppConfig } from './config.ts';
import { isRecord } from './http.ts';
import type { JwtService } from './jwt.ts';

type OAuthDependencies = {
  config: AppConfig;
  clients: Map<string, OAuthClient>;
  jwtService: JwtService;
};

export function createOAuthRouter({ config, clients, jwtService }: OAuthDependencies): Router {
  const router = Router();

  router.post('/token', (req: Request, res: Response) => {
    const client = authenticateClient(req, clients);

    if (!client) {
      sendOAuthError(res, 401, 'invalid_client', 'Client authentication failed.');
      return;
    }

    if (req.body.grant_type !== 'client_credentials') {
      sendOAuthError(res, 400, 'unsupported_grant_type', 'Only client_credentials is supported.');
      return;
    }

    if (!client.allowedGrantTypes.includes('client_credentials')) {
      sendOAuthError(
        res,
        400,
        'unauthorized_client',
        'Client is not allowed to use client_credentials.',
      );
      return;
    }

    const requestedScopes = parseScopes(req.body.scope);
    const unauthorizedScopes = requestedScopes.filter((scope) => !client.scopes.includes(scope));

    if (unauthorizedScopes.length > 0) {
      sendOAuthError(
        res,
        400,
        'invalid_scope',
        `Client is not allowed to request: ${unauthorizedScopes.join(' ')}`,
      );
      return;
    }

    const grantedScopes = requestedScopes.length > 0 ? requestedScopes : client.scopes;
    const now = Math.floor(Date.now() / 1000);
    const accessToken = jwtService.signAccessToken({
      iss: config.issuer,
      sub: client.id,
      aud: config.audience,
      client_id: client.id,
      scope: grantedScopes.join(' '),
      token_type: 'Bearer',
      iat: now,
      exp: now + config.tokenTtlSeconds,
    });

    res.set('Cache-Control', 'no-store');
    res.set('Pragma', 'no-cache');
    res.status(200).json({
      access_token: accessToken,
      token_type: 'Bearer',
      expires_in: config.tokenTtlSeconds,
      scope: grantedScopes.join(' '),
    });
  });

  router.post('/introspect', (req: Request, res: Response) => {
    const client = authenticateClient(req, clients);

    if (!client) {
      sendOAuthError(res, 401, 'invalid_client', 'Client authentication failed.');
      return;
    }

    const tokenValue = typeof req.body.token === 'string' ? req.body.token : '';
    const token = jwtService.verifyAccessToken(tokenValue);

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

  return router;
}

function authenticateClient(
  req: Request,
  clients: Map<string, OAuthClient>,
): OAuthClient | undefined {
  const credentials = parseBodyCredentials(req.body);

  if (!credentials) {
    return undefined;
  }

  return findClient(clients, credentials.clientId, credentials.clientSecret);
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

function sendOAuthError(
  res: Response,
  status: number,
  error: string,
  errorDescription: string,
): void {
  res.status(status).json({
    error,
    error_description: errorDescription,
  });
}
