import express from 'express';
import { createServer } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import { listarEscenas } from '../services/gestor';

const PORT = 3000;
const CONSOLE_URL = 'http://10.10.1.1';

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
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>ITACA - Asistente de Voz</title>
  <style>
    * { box-sizing: border-box; }
    html, body {
      margin: 0;
      height: 100%;
      background: #0b0e14;
      color: #e6e6e6;
      font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
    }
    body {
      display: grid;
      grid-template-columns: 70% 30%;
      height: 100vh;
    }
    @media (max-width: 900px) {
      body { grid-template-columns: 1fr; grid-template-rows: 40vh 60vh; height: auto; min-height: 100vh; }
    }

    /* Panel izquierdo: consola */
    #consolePanel { position: relative; background: #000; min-height: 260px; }
    #consolePanel iframe { width: 100%; height: 100%; border: none; display: block; }
    #openConsole {
      position: absolute;
      top: 1rem;
      right: 1rem;
      padding: 0.6rem 1rem;
      border-radius: 8px;
      border: 1px solid #374151;
      background: rgba(11, 14, 20, 0.85);
      color: #e6e6e6;
      font-size: 0.85rem;
      cursor: pointer;
      text-decoration: none;
    }

    /* Panel derecho: asistente */
    #assistantPanel {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 1.25rem;
      padding: 1.5rem 1rem;
      overflow-y: auto;
      background: #10141d;
      border-left: 1px solid #1d2433;
    }
    h1 { margin: 0; font-size: 1.2rem; color: #9fb4ff; text-align: center; }

    #listen {
      width: 160px;
      height: 160px;
      flex-shrink: 0;
      border-radius: 50%;
      border: none;
      font-size: 1.1rem;
      font-weight: 700;
      letter-spacing: 0.04em;
      background: #2563eb;
      color: #fff;
      cursor: pointer;
    }
    #listen:active { transform: scale(0.97); }
    #listen.listening { background: #dc2626; animation: pulse 1.4s infinite; }
    @keyframes pulse {
      0% { box-shadow: 0 0 0 0 rgba(220,38,38,0.5); }
      70% { box-shadow: 0 0 0 20px rgba(220,38,38,0); }
      100% { box-shadow: 0 0 0 0 rgba(220,38,38,0); }
    }

    .panel { width: 100%; background: #141924; border-radius: 12px; padding: 1rem; }
    .panel h2 { margin: 0 0 0.6rem; font-size: 0.95rem; color: #9fb4ff; }

    #escenaSelect {
      width: 100%;
      padding: 0.6rem;
      border-radius: 6px;
      border: 1px solid #374151;
      background: #0b0e14;
      color: #e6e6e6;
      margin-bottom: 0.6rem;
    }
    #cargarEscena {
      width: 100%;
      padding: 0.9rem;
      border-radius: 8px;
      border: none;
      background: #16a34a;
      color: #fff;
      font-size: 1rem;
      font-weight: 600;
      cursor: pointer;
    }
    #guardarEscena {
      width: 100%;
      margin-top: 0.5rem;
      padding: 0.6rem;
      border-radius: 8px;
      border: 1px solid #374151;
      background: transparent;
      color: #e6e6e6;
      cursor: pointer;
    }

    #history { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 0.35rem; min-height: 1.5rem; }
    #history li { background: #1d2433; padding: 0.5rem 0.75rem; border-radius: 6px; font-size: 0.9rem; }
    #history:empty::after { content: 'Sin acciones todavía.'; color: #6b7280; font-size: 0.85rem; }

    #modoTextoBtn {
      width: 100%;
      padding: 0.5rem;
      border-radius: 8px;
      border: 1px dashed #374151;
      background: transparent;
      color: #9ca3af;
      cursor: pointer;
      font-size: 0.85rem;
    }
    #textPanel[hidden] { display: none; }
    form#fallback { display: flex; gap: 0.5rem; width: 100%; }
    #text { flex: 1; padding: 0.5rem; border-radius: 6px; border: 1px solid #374151; background: #0b0e14; color: #e6e6e6; }
    form#fallback button { padding: 0.5rem 1rem; border-radius: 6px; border: none; background: #2563eb; color: #fff; cursor: pointer; }
    #log { width: 100%; background: #05070b; color: #22c55e; padding: 0.75rem; height: 120px; overflow: auto; border-radius: 8px; font-size: 0.75rem; margin: 0.6rem 0 0; }
  </style>
</head>
<body>
  <div id="consolePanel">
    <iframe src="${CONSOLE_URL}" title="Consola Soundcraft"></iframe>
    <a id="openConsole" href="${CONSOLE_URL}" target="_blank" rel="noopener">Abrir consola en pestaña nueva</a>
  </div>

  <div id="assistantPanel">
    <h1>ITACA - Asistente de Voz</h1>
    <button id="listen">HABLAR</button>

    <div class="panel">
      <h2>Escenas</h2>
      <select id="escenaSelect"></select>
      <button id="cargarEscena" type="button">Cargar Escena</button>
      <button id="guardarEscena" type="button">Guardar escena actual</button>
    </div>

    <div class="panel">
      <h2>Historial</h2>
      <ul id="history"></ul>
    </div>

    <button id="modoTextoBtn" type="button">Modo Texto</button>
    <div id="textPanel" class="panel" hidden>
      <form id="fallback">
        <input id="text" type="text" placeholder="Comando de texto (respaldo)" />
        <button type="submit">Enviar</button>
      </form>
      <pre id="log"></pre>
    </div>
  </div>

  <script>
    const log = document.getElementById('log');
    const history = document.getElementById('history');
    const historyItems = [];
    const ws = new WebSocket('ws://' + location.host);

    function describeAction(action) {
      if (!action) return null;
      switch (action.action) {
        case 'SET_GAIN':
          return 'Canal ' + action.channel + ' -> ' + action.value + ' dB';
        case 'ADJUST_GAIN_BY_NAME':
          return 'Voz de ' + action.personName + ' (' + (action.direction === 'up' ? 'subir' : 'bajar') + ')';
        case 'LOAD_SCENE':
          return 'Escena ' + action.sceneId + ' cargada';
        case 'SAVE_SCENE':
          return 'Escena ' + action.sceneId + ' guardada';
        case 'SET_MUTE':
          return 'Canal ' + action.channel + ' ' + (action.value ? 'MUTEADO' : 'DESMUTEADO');
        case 'SET_MUTE_BY_NAME':
          return action.personName + ' ' + (action.value ? 'MUTEADO' : 'DESMUTEADO');
        case 'SET_MASTER':
          return 'Master a ' + action.value + ' dB';
        case 'EQ_BOOST':
        case 'EQ_CUT': {
          const name = action.personName.charAt(0).toUpperCase() + action.personName.slice(1);
          const word = { low: 'cuerpo', mid: 'medios', high: 'agudos' }[action.band];
          const bandLabel = action.band.charAt(0).toUpperCase() + action.band.slice(1);
          const sign = action.value > 0 ? '+' : '';
          return 'Canal ' + action.channel + ' (' + name + ') - ' + (action.value > 0 ? 'Más ' : 'Menos ') + word +
            ' (' + sign + action.value + ' dB ' + bandLabel + ')';
        }
        default:
          return null;
      }
    }

    ws.onmessage = (ev) => {
      log.textContent += ev.data + '\\n';
      log.scrollTop = log.scrollHeight;

      const msg = JSON.parse(ev.data);
      if (msg.type === 'action') {
        const label = describeAction(msg.action);
        if (label) {
          historyItems.unshift(label);
          historyItems.length = Math.min(historyItems.length, 5);
          history.textContent = '';
          for (const item of historyItems) {
            const li = document.createElement('li');
            li.textContent = item;
            history.appendChild(li);
          }
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

    document.getElementById('modoTextoBtn').addEventListener('click', () => {
      const panel = document.getElementById('textPanel');
      panel.hidden = !panel.hidden;
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

    async function sendCommand(text) {
      await fetch('/command', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text }),
      });
    }

    const escenaSelect = document.getElementById('escenaSelect');
    async function loadEscenas() {
      const res = await fetch('/escenas');
      const escenas = await res.json();
      escenaSelect.textContent = '';
      for (const e of escenas) {
        const option = document.createElement('option');
        option.value = String(e.id);
        option.textContent = '#' + e.id + ' ' + e.nombre;
        escenaSelect.appendChild(option);
      }
    }
    loadEscenas();

    document.getElementById('cargarEscena').addEventListener('click', () => {
      if (escenaSelect.value) sendCommand('carga la escena ' + escenaSelect.value);
    });
    document.getElementById('guardarEscena').addEventListener('click', () => {
      if (escenaSelect.value) sendCommand('guarda esto como la escena ' + escenaSelect.value);
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

  app.get('/escenas', (_req, res) => {
    res.json(listarEscenas());
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
