import express, { ErrorRequestHandler } from 'express';
import { createServer } from 'http';
import { resolve } from 'path';
import { WebSocket, WebSocketServer } from 'ws';
import { PORT } from '../config';
import { SoundManager } from '../manager/service';
import { AppError } from '../manager/types';

export function createUiServer(manager: SoundManager) {
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '64kb' }));
  app.use((req, res, next) => {
    if (req.headers.origin && req.headers.origin !== 'http://' + req.headers.host &&
      req.headers.origin !== 'https://' + req.headers.host) {
      res.status(403).json({ error: 'Origen no permitido.' });
      return;
    }
    res.setHeader('X-Content-Type-Options', 'nosniff');
    if (req.path.startsWith('/api/')) res.setHeader('Cache-Control', 'no-store');
    next();
  });
  const server = createServer(app);
  const wss = new WebSocketServer({ noServer: true, maxPayload: 4096 });
  function broadcast() {
    for (const client of wss.clients) {
      if (client.readyState === WebSocket.OPEN) client.send(JSON.stringify({ type: 'refresh' }));
    }
  }

  app.get('/api/state', async (_req, res) => { res.json(await manager.view()); });
  app.post('/api/shows', async (req, res) => {
    res.status(201).json(await manager.saveShow(undefined, req.body?.name)); broadcast();
  });
  app.patch('/api/shows/:showId', async (req, res) => {
    res.json(await manager.saveShow(req.params.showId, req.body?.name)); broadcast();
  });
  app.delete('/api/shows/:showId', async (req, res) => {
    await manager.deleteShow(req.params.showId); res.sendStatus(204); broadcast();
  });
  app.put('/api/shows/:showId/channels', async (req, res) => {
    res.json(await manager.saveChannel(req.params.showId, req.body ?? {})); broadcast();
  });
  app.delete('/api/shows/:showId/channels/:channel', async (req, res) => {
    await manager.deleteChannel(req.params.showId, Number(req.params.channel)); res.sendStatus(204); broadcast();
  });
  app.get('/api/shows/:showId/gains', async (req, res) => {
    res.json(await manager.readChannels(req.params.showId));
  });
  app.post('/api/shows/:showId/scenes', async (req, res) => {
    res.status(201).json(await manager.saveScene(req.params.showId, undefined, req.body ?? {})); broadcast();
  });
  app.put('/api/shows/:showId/scenes/:sceneId', async (req, res) => {
    res.json(await manager.saveScene(req.params.showId, req.params.sceneId, req.body ?? {})); broadcast();
  });
  app.delete('/api/shows/:showId/scenes/:sceneId', async (req, res) => {
    await manager.deleteScene(req.params.showId, req.params.sceneId); res.sendStatus(204); broadcast();
  });
  app.post('/api/shows/:showId/commands', async (req, res) => {
    res.status(201).json(await manager.proposeCommand(req.params.showId, req.body?.text)); broadcast();
  });
  app.post('/api/shows/:showId/scenes/:sceneId/propose', async (req, res) => {
    res.status(201).json(await manager.proposeScene(req.params.showId, req.params.sceneId)); broadcast();
  });
  app.post('/api/proposals/:id/confirm', async (req, res) => {
    res.json(await manager.confirm(req.params.id, req.body?.reviewVersion)); broadcast();
  });
  app.post('/api/proposals/:id/reject', async (req, res) => {
    res.json(await manager.reject(req.params.id)); broadcast();
  });
  app.post('/api/proposals/:id/undo', async (req, res) => {
    res.status(201).json(await manager.proposeUndo(req.params.id)); broadcast();
  });

  // El punto de entrada anterior también produce propuestas pendientes.
  app.post('/command', async (req, res) => {
    if (typeof req.body?.showId !== 'string') throw new AppError('Selecciona una obra para crear la propuesta.');
    res.status(201).json(await manager.proposeCommand(req.body.showId, req.body.text)); broadcast();
  });
  app.post('/listen/start', (_req, res) => { res.sendStatus(204); });
  app.post('/listen/stop', (_req, res) => { res.sendStatus(204); });
  app.use(express.static(resolve(__dirname, 'public')));

  const errors: ErrorRequestHandler = (error, _req, res, _next) => {
    console.error('[gestor]', error.message);
    res.status(error instanceof AppError ? error.status : 503).json({
      error: error instanceof SyntaxError ? 'El cuerpo de la petición no es JSON válido.' : error.message || 'No se pudo completar la operación.',
    });
  };
  app.use(errors);

  server.on('upgrade', (request, socket, head) => {
    const origin = request.headers.origin;
    if (origin && origin !== 'http://' + request.headers.host && origin !== 'https://' + request.headers.host) {
      socket.destroy(); return;
    }
    wss.handleUpgrade(request, socket, head, (ws) => {
      ws.on('error', (error) => console.error('[websocket]', error.message));
      ws.on('message', async (raw) => {
        try {
          const message = JSON.parse(raw.toString());
          if (message.type !== 'command' || typeof message.showId !== 'string') throw new AppError('Selecciona una obra.');
          const proposal = await manager.proposeCommand(message.showId, message.text);
          ws.send(JSON.stringify({ type: 'proposal', proposal }));
          broadcast();
        } catch (error) {
          if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'error', message: (error as Error).message }));
        }
      });
    });
  });
  server.on('close', () => {
    for (const client of wss.clients) client.terminate();
    wss.close();
  });
  return server;
}

export function startUiServer(manager: SoundManager) {
  const server = createUiServer(manager);
  server.listen(PORT, process.env.HOST || '127.0.0.1', () => {
    console.log('[ui] Gestor en http://localhost:' + PORT);
  });
  return server;
}
