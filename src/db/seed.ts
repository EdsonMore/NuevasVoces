import { crearObra, crearEscena, guardarEstadoCanal } from '../services/gestor';

const obraId = crearObra('Obra de Prueba');
const escenaId = crearEscena(obraId, 'Escena 1');

guardarEstadoCanal(escenaId, 2, -5, false, 'Ana');
guardarEstadoCanal(escenaId, 3, -10, false, 'Luis');
guardarEstadoCanal(escenaId, 4, 0, false, 'Coro');

console.log(`Seed listo: obra #${obraId}, escena #${escenaId} (canales 2, 3, 4).`);
