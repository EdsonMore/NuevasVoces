import { SoundcraftUI, ConnectionStatus, ConnectionEvent } from 'soundcraft-ui-connection';

// El script npm fija "ts-node src/phase0-test.ts --", así que el separador "--"
// siempre aparece en argv aunque no se pase ningún argumento; hay que filtrarlo.
const ip = process.argv.slice(2).filter((a) => a !== '--')[0];
if (!ip) {
  console.error('Uso: npm run phase0 -- <IP_DE_LA_CONSOLA>');
  process.exit(1);
}

const CHANNEL = 2; // canal de hardware de ejemplo
const CONNECT_TIMEOUT_MS = 10_000;

const now = () => new Date().toISOString();

// Valores reales del enum ConnectionStatus (lib/types.d.ts), no inventados.
const STATUS_LABELS: Record<ConnectionStatus, string> = {
  [ConnectionStatus.Opening]: 'conectando',
  [ConnectionStatus.Open]: 'conectado',
  [ConnectionStatus.Close]: 'desconectado',
  [ConnectionStatus.Closing]: 'desconectando',
  [ConnectionStatus.Error]: 'error',
  [ConnectionStatus.Reconnecting]: 'reconectando',
};

async function main() {
  const mixer = new SoundcraftUI(ip);
  let connected = false;

  mixer.status$.subscribe((event: ConnectionEvent) => {
    console.log(`[${now()}] [status] ${event.type} (${STATUS_LABELS[event.type]})`);
    if (event.type === ConnectionStatus.Open) {
      connected = true;
    }
    if (event.type === ConnectionStatus.Close || event.type === ConnectionStatus.Error) {
      console.log(`[${now()}] DESCONECTADO — no se enviará ninguna escritura`);
    }
  });

  process.on('SIGINT', async () => {
    console.log(`[${now()}] Cerrando...`);
    if (typeof mixer.disconnect === 'function') {
      await mixer.disconnect();
    }
    process.exit(0);
  });

  const timeoutTimer = setTimeout(() => {
    if (!connected) {
      console.error(`[${now()}] TIMEOUT de conexión a ${ip}`);
      process.exit(2);
    }
  }, CONNECT_TIMEOUT_MS);

  await mixer.connect();
  clearTimeout(timeoutTimer);
  console.log(`[${now()}] Conectado a ${ip}. Escuchando gainDB$ del canal ${CHANNEL}...`);

  mixer.hw(CHANNEL).gainDB$.subscribe((db: number | null | undefined) => {
    console.log(`[${now()}] PING Nueva emisión gainDB$:`, db);
    if (db == null) {
      console.log(`[${now()}] Ganancia canal ${CHANNEL}: (sin dato aún)`);
      return;
    }
    console.log(`[${now()}] Ganancia canal ${CHANNEL}: ${db} dB`);
  });

  // NOTA: no existe mixer.input(n) ni mixer.master.input(n).gainDB$ en los .d.ts.
  // master.input(n) devuelve DelayableMasterChannel (pan$/solo$/delay$), sin gain.
  // gainDB$ solo existe en HwChannel (mixer.hw(n)). No se añade suscripción alternativa.

  setInterval(() => {
    const status = mixer.conn.status; // getter real (mixer-connection.d.ts), no "connectionState"
    console.log(`[${now()}] [poll] conn.status = ${status} (${STATUS_LABELS[status]})`);
  }, 5000);
}

main().catch((err) => {
  console.error(`[${now()}] Error de conexión:`, err instanceof Error ? err.message : err);
  process.exit(1);
});
