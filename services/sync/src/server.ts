import "./dom-shim.js";
import { Hocuspocus } from "@hocuspocus/server";
import { authenticateExt } from "./extensions/authenticate.js";
import { persistExt } from "./extensions/persist.js";

const port = Number(process.env.PORT ?? 1234);

const server = new Hocuspocus({
  port,
  extensions: [authenticateExt(), persistExt()],
});

server.listen();
console.log(`Hocuspocus listening on ${port}`);
