// Dependency-free local static server. Run: node server.mjs
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('./dist/', import.meta.url));
const types = {'.html':'text/html', '.js':'text/javascript', '.css':'text/css', '.json':'application/json', '.md':'text/plain', '.svg':'image/svg+xml'};
http.createServer(async (request, response) => {
  try {
    const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
    const filename = path.resolve(root, '.' + (pathname === '/' ? '/index.html' : pathname));
    if (!filename.startsWith(root)) { response.writeHead(403); response.end(); return; }
    const body = await readFile(filename);
    response.writeHead(200, {'Content-Type': types[path.extname(filename)] || 'application/octet-stream', 'Cache-Control':'no-store'});
    response.end(body);
  } catch { response.writeHead(404); response.end('Not found'); }
}).listen(4173, '127.0.0.1', () => console.log('Dispatch Lab: http://127.0.0.1:4173'));
