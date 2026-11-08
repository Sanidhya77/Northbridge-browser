import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';

const portal = await readFile(new URL('./portal.html', import.meta.url));
const port = Number(process.env.PORT || 4317);

createServer((request, response) => {
  const path = request.url.split('?')[0];
  if (request.method !== 'GET' || path !== '/') {
    response.writeHead(404).end();
    return;
  }
  response.writeHead(200, {
    'Content-Type': 'text/html; charset=utf-8',
    'Cache-Control': 'no-store',
    'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; base-uri 'none'; form-action 'none'",
  }).end(portal);
}).listen(port, '127.0.0.1', () => {
  console.log(`Mock university portal at http://127.0.0.1:${port}/`);
});
