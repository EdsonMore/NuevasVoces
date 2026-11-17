import { parseCommand } from './agent/parser';
import { startUiServer } from './ui/server';
import { applyEQ, applyGain, applyMaster, applyMute, changeGain, ConsoleConnectionError } from './console/controller';
import { aplicarEscena, buscarCanalPorNombre, guardarEstadoActualComoEscena } from './services/gestor';

// ponytail: paso fijo para comandos relativos por nombre ("sube la voz de Ana"). Sin valor
// explícito en la frase no hay otra referencia; subir a configurable si se necesita ajustar.
const ADJUST_GAIN_STEP_DB = 3;

async function handleText(text: string, broadcast: ReturnType<typeof startUiServer>['broadcast']): Promise<void> {
  broadcast({ type: 'transcript', text });
  const action = parseCommand(text);
  if (!action) {
    broadcast({ type: 'status', message: `No se entendió el comando: "${text}"` });
    return;
  }
  // EQ: resolvemos el canal antes de emitir para que el historial muestre "Canal N (Nombre)".
  let eqChannel: number | null = null;
  if (action.action === 'EQ_BOOST' || action.action === 'EQ_CUT') {
    eqChannel = buscarCanalPorNombre(action.personName);
    if (eqChannel === null) {
      broadcast({ type: 'status', message: `No conozco ningún canal para "${action.personName}".` });
      return;
    }
  }
  broadcast({ type: 'action', action: eqChannel === null ? action : { ...action, channel: eqChannel } });

  try {
    switch (action.action) {
      case 'SET_GAIN':
        console.log(`[consola] Aplicando ganancia al canal ${action.channel}: ${action.value} dB`);
        await applyGain(action.channel, action.value);
        break;
      case 'ADJUST_GAIN_BY_NAME': {
        const channel = buscarCanalPorNombre(action.personName);
        if (channel === null) {
          broadcast({ type: 'status', message: `No conozco ningún canal para "${action.personName}".` });
          return;
        }
        const offset = action.direction === 'up' ? ADJUST_GAIN_STEP_DB : -ADJUST_GAIN_STEP_DB;
        await changeGain(channel, offset);
        break;
      }
      case 'SET_MUTE':
        await applyMute(action.channel, action.value);
        break;
      case 'SET_MUTE_BY_NAME': {
        const channel = buscarCanalPorNombre(action.personName);
        if (channel === null) {
          broadcast({ type: 'status', message: `No conozco ningún canal para "${action.personName}".` });
          return;
        }
        await applyMute(channel, action.value);
        break;
      }
      case 'SET_MASTER':
        await applyMaster(action.value);
        break;
      case 'EQ_BOOST':
      case 'EQ_CUT':
        await applyEQ(eqChannel!, action.band, action.value);
        break;
      case 'LOAD_SCENE':
        await aplicarEscena(action.sceneId);
        broadcast({ type: 'status', message: `Escena ${action.sceneId} cargada.` });
        break;
      case 'SAVE_SCENE':
        await guardarEstadoActualComoEscena(action.sceneId);
        broadcast({ type: 'status', message: `Estado actual guardado como escena ${action.sceneId}.` });
        break;
    }
    console.log('[consola] Comando aplicado con éxito');
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[consola] Error aplicando comando:', message);
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
