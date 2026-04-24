import { Hocuspocus } from "@hocuspocus/server";
import { authenticateExt } from "./extensions/authenticate.js";

const port = Number(process.env.PORT ?? 1234);

const server = new Hocuspocus({
  port,
  extensions: [authenticateExt()],
});

server.listen();
console.log(`Hocuspocus listening on ${port}`);
