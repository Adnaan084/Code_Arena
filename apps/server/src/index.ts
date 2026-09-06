/** Omnicore Auction — server entry point. */
import 'dotenv/config';
import { createApp } from './app';

const { app, http, socket, env } = createApp();

http.listen(env.port, () => {
  console.log(`⚡ Omnicore API listening on :${env.port}`);
});

export { app, http, socket };