import { resolve } from 'path';

// Node.js 22 carga el archivo sin sobrescribir variables de la terminal.
try {
  process.loadEnvFile(resolve(__dirname, '../.env'));
} catch (error) {
  if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
}

export const MIXER_IP = process.env.MIXER_IP || '10.10.1.1';
export const DEFAULT_CHANNEL = 2;
export const RECONNECT_TIMEOUT_MS = 5000;
export const DEMO_MODE = process.argv.includes('--demo');
export const PORT = Number(process.env.PORT || 3000);
