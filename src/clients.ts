import type { AppConfig } from './config.ts';

export type OAuthClient = {
  id: string;
  secret: string;
  allowedGrantTypes: string[];
  scopes: string[];
};

export function createClients(config: AppConfig): Map<string, OAuthClient> {
  return new Map<string, OAuthClient>([
    [
      config.oauthClientId,
      {
        id: config.oauthClientId,
        secret: config.oauthClientSecret,
        allowedGrantTypes: ['client_credentials'],
        scopes: config.oauthClientScopes,
      },
    ],
  ]);
}

export function findClient(
  clients: Map<string, OAuthClient>,
  clientId: string,
  clientSecret: string,
): OAuthClient | undefined {
  const client = clients.get(clientId);

  if (!client || client.secret !== clientSecret) {
    return undefined;
  }

  return client;
}
