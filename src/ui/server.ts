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
  <style>
    * { box-sizing: border-box; }
    body {
      margin: 0;
      min-height: 100vh;
      background: #0b0e14;
      color: #e6e6e6;
      font-family: system-ui, -apple-system, Segoe UI, Roboto, sans-serif;
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 1.5rem;
      padding: 2rem 1rem;
    }
    h1 { margin: 0; font-size: 1.3rem; color: #9fb4ff; text-align: center; }
    #listen {
      width: 200px;
      height: 200px;
      border-radius: 50%;
      border: none;
      font-size: 1.2rem;
      font-weight: 700;
      letter-spacing: 0.04em;
      background: #2563eb;
      color: #fff;
      cursor: pointer;
    }
    #listen:active { transform: scale(0.97); }
    #listen.listening {
      background: #dc2626;
      animation: pulse 1.4s infinite;
    }
    @keyframes pulse {
      0% { box-shadow: 0 0 0 0 rgba(220,38,38,0.5); }
      70% { box-shadow: 0 0 0 20px rgba(220,38,38,0); }
      100% { box-shadow: 0 0 0 0 rgba(220,38,38,0); }
    }
    .panel { width: 100%; max-width: 480px; background: #141924; border-radius: 12px; padding: 1rem; }
    .panel h2 { margin: 0 0 0.5rem; font-size: 1rem; color: #9fb4ff; }
    #history { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 0.35rem; min-height: 1.5rem; }
    #history li { background: #1d2433; padding: 0.5rem 0.75rem; border-radius: 6px; font-size: 0.95rem; }
    #history:empty::after { content: 'Sin acciones todavía.'; color: #6b7280; font-size: 0.9rem; }
    #undo {
      width: 100%;
      margin-top: 0.75rem;
      padding: 0.6rem;
      border: 1px solid #374151;
      border-radius: 6px;
      background: transparent;
      color: #e6e6e6;
      cursor: pointer;
    }
    form#fallback { display: flex; gap: 0.5rem; width: 100%; max-width: 480px; }
    #text { flex: 1; padding: 0.5rem; border-radius: 6px; border: 1px solid #374151; background: #0b0e14; color: #e6e6e6; }
    form#fallback button { padding: 0.5rem 1rem; border-radius: 6px; border: none; background: #2563eb; color: #fff; cursor: pointer; }
    #log { width: 100%; max-width: 480px; background: #05070b; color: #22c55e; padding: 1em; height: 160px; overflow: auto; border-radius: 8px; font-size: 0.8rem; margin: 0; }
  </style>
</head>
<body>
  <h1>Agente de voz — Canal 2</h1>
  <button id="listen">HABLAR</button>

  <div class="panel">
    <h2>Historial</h2>
    <ul id="history"></ul>
    <button id="undo" type="button">DESHACER</button>
  </div>

  <form id="fallback">
    <input id="text" type="text" placeholder="Comando de texto (respaldo)" />
    <button type="submit">Enviar</button>
  </form>

  <pre id="log"></pre>

  <script>
    const log = document.getElementById('log');
    const history = document.getElementById('history');
    const historyItems = [];
    const ws = new WebSocket('ws://' + location.host);

    ws.onmessage = (ev) => {
      log.textContent += ev.data + '\\n';
      log.scrollTop = log.scrollHeight;

      const msg = JSON.parse(ev.data);
      if (msg.type === 'action' && msg.action && msg.action.action === 'SET_GAIN') {
        historyItems.unshift('Canal ' + msg.action.channel + ' -> ' + msg.action.value + ' dB');
        historyItems.length = Math.min(historyItems.length, 5);
        history.innerHTML = '';
        for (const item of historyItems) {
          const li = document.createElement('li');
          li.textContent = item;
          history.appendChild(li);
        }
      }
    };

    const SpeechRecognitionCtor = window.SpeechRecognition || window.webkitSpeechRecognition;
    let recognition = null;
    let listening = false;

    if (SpeechRecognitionCtor) {
      recognition = new SpeechRecognitionCtor();
      recognition.lang = 'es-ES';
      recognition.interimResults = false;
      recognition.maxAlternatives = 1;

      recognition.onresult = (ev) => {
        const text = ev.results[ev.results.length - 1][0].transcript;
        ws.send(JSON.stringify({ type: 'command', text }));
      };
      recognition.onerror = (ev) => {
        log.textContent += '[voz] Error: ' + ev.error + '\\n';
        listening = false;
        const btn = document.getElementById('listen');
        btn.textContent = 'HABLAR';
        btn.classList.remove('listening');
      };
      recognition.onend = () => {
        listening = false;
        const btn = document.getElementById('listen');
        btn.textContent = 'HABLAR';
        btn.classList.remove('listening');
      };
    }

    document.getElementById('listen').addEventListener('click', async () => {
      const btn = document.getElementById('listen');
      if (!recognition) {
        log.textContent += '[voz] Este navegador no soporta reconocimiento de voz.\\n';
        return;
      }
      listening = !listening;
      if (listening) {
        await fetch('/listen/start', { method: 'POST' });
        recognition.start();
        log.textContent += 'Esperando comando de voz...\\n';
      } else {
        recognition.stop();
        await fetch('/listen/stop', { method: 'POST' });
      }
      btn.textContent = listening ? 'ESCUCHANDO...' : 'HABLAR';
      btn.classList.toggle('listening', listening);
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
    ws.on('message', (raw) => {
      try {
        const msg = JSON.parse(raw.toString());
        if (msg?.type === 'command' && typeof msg.text === 'string' && msg.text.trim()) {
          handlers.onTextCommand(msg.text.trim());
        }
      } catch {
        // ignora mensajes malformados
      }
    });
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
