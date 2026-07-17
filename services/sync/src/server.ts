import "./dom-shim.js";
import { Hocuspocus } from "@hocuspocus/server";
import { authenticateExt } from "./extensions/authenticate.js";
import { persistExt } from "./extensions/persist.js";

const port = Number(process.env.PORT ?? 1234);
const configuredMaxPayload = Number(process.env.SYNC_MAX_PAYLOAD_BYTES ?? 8 * 1024 * 1024);
if (!Number.isSafeInteger(configuredMaxPayload) || configuredMaxPayload < 64 * 1024) {
  throw new Error("SYNC_MAX_PAYLOAD_BYTES must be an integer >= 65536");
}

const server = new Hocuspocus({
  port,
  extensions: [authenticateExt(), persistExt()],
});

await server.listen(null, null, { maxPayload: configuredMaxPayload });
console.log(`Hocuspocus listening on ${port}`);
