import { createServer } from "node:https";
import { readFileSync } from "node:fs";
import next from "next";
import { config } from "./lib/config";

const app = next({ dev: false });
const handle = app.getRequestHandler();

await app.prepare();

const server = createServer(
  { cert: readFileSync(config.tlsCert), key: readFileSync(config.tlsKey) },
  (req, res) => handle(req, res),
);

server.listen(config.port, config.host, () => {
  console.log(`Next.js HTTPS server listening on https://${config.host}:${config.port}`);
});
