import { buildApp } from './app.js';
import { settingsFromEnv } from './settings.js';

const settings = settingsFromEnv();
const app = buildApp({ settings, logger: true });

app.listen({ port: settings.port, host: '0.0.0.0' }).catch((err) => {
  app.log.error(err);
  process.exit(1);
});
