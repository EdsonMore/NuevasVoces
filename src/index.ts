import { DEMO_MODE } from './config';
import { createDemoMixer, liveMixer } from './console/controller';
import { createRepository } from './manager/repository';
import { SoundManager } from './manager/service';
import { startUiServer } from './ui/server';

async function main(): Promise<void> {
  const mixer = DEMO_MODE ? createDemoMixer() : liveMixer;
  const repository = await createRepository(mixer.mode);
  const manager = new SoundManager(repository, mixer);
  await manager.view();
  const server = startUiServer(manager);
  server.on('error', (error) => {
    console.error('[ui]', error.message);
    process.exit(1);
  });
  console.log('[gestor] Modo ' + mixer.mode + ' · almacenamiento ' + repository.kind);
}

if (require.main === module) {
  void main().catch((error) => {
    console.error('[inicio]', error.message);
    process.exit(1);
  });
}
