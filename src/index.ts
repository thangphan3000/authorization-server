import { createApp } from './app.ts';
import { createConfig } from './config.ts';

const config = createConfig();
const app = createApp(config);

const server = app.listen(config.port, config.host, () => {
  console.log(`OAuth2 authorization server is listening at ${config.issuer}`);
});

server.on('error', (error) => {
  console.error('Failed to start OAuth2 authorization server:', error);
  process.exit(1);
});
