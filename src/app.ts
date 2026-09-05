import express, { type Express, type Request, type Response } from 'express';
import { createClients } from './clients.ts';
import type { AppConfig } from './config.ts';
import { createJwtService } from './jwt.ts';
import { createOAuthRouter } from './oauth.ts';

export function createApp(config: AppConfig): Express {
  const app = express();
  const clients = createClients(config);
  const jwtService = createJwtService(config);

  app.use(express.urlencoded({ extended: false }));
  app.use(express.json());

  app.get('/', (req: Request, res: Response) => {
    res.json({
      issuer: config.issuer,
      token_endpoint: `${config.issuer}/oauth/token`,
      introspection_endpoint: `${config.issuer}/oauth/introspect`,
      jwks_uri: `${config.issuer}/.well-known/jwks.json`,
    });
  });

  app.get('/.well-known/jwks.json', (req: Request, res: Response) => {
    res.json(jwtService.getJwks());
  });

  app.use('/oauth', createOAuthRouter({ config, clients, jwtService }));

  return app;
}
