import assert from "node:assert/strict";
import { createServer } from "node:net";
import { test } from "node:test";
import { PrismaDatabase } from "../dist/index.js";

test(
  "a stalled PostgreSQL handshake fails readiness within three seconds",
  { timeout: 3000 },
  async () => {
    const sockets = new Set();
    const server = createServer((socket) => {
      sockets.add(socket);
      socket.on("close", () => sockets.delete(socket));
    });
    await new Promise((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", resolve);
    });

    const { port } = server.address();
    const database = new PrismaDatabase(`postgresql://test:test@127.0.0.1:${port}/vetx`);
    try {
      await assert.rejects(database.checkReady());
    } finally {
      for (const socket of sockets) socket.destroy();
      await database.onApplicationShutdown();
      await new Promise((resolve) => server.close(resolve));
    }
  },
);
