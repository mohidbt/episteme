import { Hocuspocus } from "@hocuspocus/server";

const port = Number(process.env.PORT ?? 1234);

const server = new Hocuspocus({
  port,
  extensions: [],
});

server.listen();
console.log(`Hocuspocus listening on ${port}`);
