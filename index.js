// -----------------------------------------------------------------------------
// Entry point of the Microsoft Edge text-to-speech integration for Gladys.
//
// A text-to-speech provider (manifest `type: "tts"`): once an administrator
// selects it as the voice of Gladys, scene announcements and the answers of
// the assistant are spoken with the neural voices of Microsoft Edge.
//
// This file only WIRES the SDK to EdgeTts (src/integration.js) through
// registerHandlers (src/app.js); it holds no logic.
//
// Environment variables provided by the Gladys supervisor:
//   - GLADYS_HOST_API_URL         (host API URL)
//   - GLADYS_INTEGRATION_TOKEN    (integration-scoped JWT)
//   - GLADYS_INTEGRATION_SELECTOR (integration identifier)
// `new GladysIntegration()` reads them automatically.
// -----------------------------------------------------------------------------

import { GladysIntegration, logger } from '@gladysassistant/integration-sdk';
import { registerHandlers } from './src/app.js';
import { EdgeTts } from './src/integration.js';
import { exitOnUnhandledRejection } from './src/lifecycle.js';

exitOnUnhandledRejection({ logger });

const gladys = new GladysIntegration();
registerHandlers(gladys, new EdgeTts(gladys));

logger.info('Starting the Microsoft Edge text-to-speech integration...');
// connect() only rejects when Gladys refuses the token on the first attempt;
// the SDK keeps reconnecting afterwards, so stay alive instead of exiting.
gladys.connect().catch((err) => {
  logger.error('Initial connection failed, the SDK keeps retrying', err);
});
