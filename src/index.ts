import { parseCommand } from './agent/parser';
import { startUiServer } from './ui/server';
import { applyGain, ConsoleConnectionError } from './console/controller';

async function handleText(text: string, broadcast: ReturnType<typeof startUiServer>['broadcast']): Promise<void> {
  broadcast({ type: 'transcript', text });
  const action = parseCommand(text);
  if (!action) {
    broadcast({ type: 'status', message: `No se entendió el comando: "${text}"` });
    return;
  }
  broadcast({ type: 'action', action });

  console.log(`[consola] Aplicando ganancia al canal ${action.channel}: ${action.value} dB`);
  try {
    await applyGain(action.channel, action.value);
    console.log('[consola] Ganancia aplicada con éxito');
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[consola] Error aplicando ganancia:', message);
    if (err instanceof ConsoleConnectionError) {
      broadcast({ type: 'status', message: 'Error: La consola no está conectada o apagada.' });
    } else {
      broadcast({ type: 'status', message: `Error en consola: ${message}` });
    }
  }
}

function main(): void {
  const { broadcast } = startUiServer({
    onStartListening(): void {
      broadcast({ type: 'status', message: 'Escuchando...' });
    },
    onStopListening(): void {
      broadcast({ type: 'status', message: 'Detenido.' });
    },
    onTextCommand(text): void {
      handleText(text, broadcast);
    },
  });
}

main();
