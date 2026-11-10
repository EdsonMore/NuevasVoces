import { parseCommand } from './agent/parser';
import { startListening, SttHandle } from './voice/stt';
import { startUiServer } from './ui/server';
import { VOSK_MODEL_PATH } from './config';

function handleText(text: string, broadcast: ReturnType<typeof startUiServer>['broadcast']): void {
  broadcast({ type: 'transcript', text });
  const action = parseCommand(text);
  if (action) {
    // NO se ejecuta el setGain todavía: solo se muestra en la UI lo que se haría.
    broadcast({ type: 'action', action });
  } else {
    broadcast({ type: 'status', message: `No se entendió el comando: "${text}"` });
  }
}

function main(): void {
  let sttHandle: SttHandle | null = null;

  const { broadcast } = startUiServer({
    onStartListening(): void {
      if (sttHandle) return;
      sttHandle = startListening(VOSK_MODEL_PATH, (text) => handleText(text, broadcast));
      broadcast({ type: 'status', message: 'Escuchando...' });
    },
    onStopListening(): void {
      sttHandle?.stop();
      sttHandle = null;
      broadcast({ type: 'status', message: 'Detenido.' });
    },
    onTextCommand(text): void {
      handleText(text, broadcast);
    },
  });
}

main();
