import express from 'express';
import { createServer } from 'http';
import { WebSocketServer, WebSocket } from 'ws';

const PORT = 3000;

export type UiMessage =
  | { type: 'transcript'; text: string }
  | { type: 'action'; action: unknown }
  | { type: 'status'; message: string };

export interface UiHandlers {
  onStartListening(): void;
  onStopListening(): void;
  onTextCommand(text: string): void;
}

const HTML = `<!doctype html>
<html lang="es">
<head>
  <meta charset="utf-8" />
  <title>Agente de voz ITACA</title>
</head>
<body>
  <h1>Agente de voz — Canal 2</h1>
  <button id="listen">Escuchar</button>
  <form id="fallback">
    <input id="text" type="text" placeholder="Comando de texto (respaldo)" />
    <button type="submit">Enviar</button>
  </form>
  <pre id="log" style="background:#111;color:#0f0;padding:1em;height:300px;overflow:auto;"></pre>
  <script>
    const log = document.getElementById('log');
    const ws = new WebSocket('ws://' + location.host);
    ws.onmessage = (ev) => {
      log.textContent += ev.data + '\\n';
      log.scrollTop = log.scrollHeight;
    };

    let listening = false;
    document.getElementById('listen').addEventListener('click', async () => {
      listening = !listening;
      await fetch(listening ? '/listen/start' : '/listen/stop', { method: 'POST' });
      document.getElementById('listen').textContent = listening ? 'Detener' : 'Escuchar';
    });

    document.getElementById('fallback').addEventListener('submit', async (ev) => {
      ev.preventDefault();
      const input = document.getElementById('text');
      await fetch('/command', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: input.value }),
      });
      input.value = '';
    });
  </script>
</body>
</html>`;

export function startUiServer(handlers: UiHandlers): { broadcast: (message: UiMessage) => void } {
  const app = express();
  app.use(express.json());

  app.get('/', (_req, res) => {
    res.send(HTML);
  });

  app.post('/listen/start', (_req, res) => {
    handlers.onStartListening();
    res.sendStatus(204);
  });

  app.post('/listen/stop', (_req, res) => {
    handlers.onStopListening();
    res.sendStatus(204);
  });

  app.post('/command', (req, res) => {
    const text = req.body?.text;
    if (typeof text === 'string' && text.trim()) {
      handlers.onTextCommand(text.trim());
    }
    res.sendStatus(204);
  });

  const httpServer = createServer(app);
  const wss = new WebSocketServer({ server: httpServer });
  const clients = new Set<WebSocket>();

  wss.on('connection', (ws) => {
    clients.add(ws);
    ws.on('close', () => clients.delete(ws));
  });

  function broadcast(message: UiMessage): void {
    const data = JSON.stringify(message);
    for (const client of clients) {
      if (client.readyState === WebSocket.OPEN) client.send(data);
    }
  }

  httpServer.listen(PORT, () => {
    console.log(`[ui] Servidor en http://localhost:${PORT}`);
  });

  return { broadcast };
}
