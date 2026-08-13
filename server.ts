/**
 * JamRoom entry — one Node process serving Next.js (UI + API routes) and
 * Socket.IO (realtime sync/chat) on the same port.
 */

import { createServer } from 'http';
import next from 'next';
import { getDb } from './src/server/db/database';
import { attachIo } from './src/server/realtime/attachIo';

const port = parseInt(process.env.PORT || '3000', 10);
const dev = process.env.NODE_ENV !== 'production';

const app = next({ dev });
const handle = app.getRequestHandler();

app.prepare().then(() => {
    getDb();    // open SQLite + run migrations at boot

    const httpServer = createServer((req, res) => { void handle(req, res); });
    attachIo(httpServer);

    httpServer.listen(port, () => {
        console.log(`[jamroom] ready on http://localhost:${port} (${dev ? 'dev' : 'production'})`);
    });
});
