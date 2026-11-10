import { Model, Recognizer } from 'vosk-koffi';
import mic from 'mic';

const SAMPLE_RATE = 16000;

export interface SttHandle {
  stop(): void;
}

/** Inicia captura de micrófono + reconocimiento Vosk. Llama a onFinalText con cada frase final detectada. */
export function startListening(modelPath: string, onFinalText: (text: string) => void): SttHandle {
  console.log('[stt] Configurando mic: rate=16000, channels=1, bitwidth=16');

  const model = new Model(modelPath);
  const recognizer = new Recognizer({ model, sampleRate: SAMPLE_RATE });

  const micInstance = mic({
    rate: String(SAMPLE_RATE),
    channels: '1',
    bitwidth: '16',
    encoding: 'signed-integer',
    endian: 'little',
    device: 'default',
    debug: false,
  });
  const micInputStream = micInstance.getAudioStream();

  micInputStream.on('data', (data: Buffer) => {
    recognizer.acceptWaveformAsync(data).then((hasResult: boolean) => {
      if (!hasResult) return;
      const raw = recognizer.resultString();
      if (!raw) return;
      const parsed = JSON.parse(raw) as { text?: string };
      if (parsed.text) onFinalText(parsed.text);
    });
  });

  micInputStream.on('error', (err: Error) => {
    console.error('[stt] Error en el micrófono:', err);
  });

  micInstance.start();

  return {
    stop(): void {
      micInstance.stop();
      recognizer.free();
      model.free();
    },
  };
}
