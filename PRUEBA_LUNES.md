# Prueba física — Fase 0 (Soundcraft Ui24R)

## 1. Checklist físico

1. [ ] Encender la consola Ui24R.
2. [ ] Conectar el portátil a la MISMA red Wi-Fi/LAN que la consola.
3. [ ] Obtener la IP de la consola (app oficial Ui24R, o menú de red de la consola).
4. [ ] Ejecutar: `npm run phase0 -- <IP_DE_LA_CONSOLA>`
5. [ ] Si no conecta en 10 s, el script se cierra solo con "TIMEOUT de conexión" — ver Plan B.

## 2. Criterios de aceptación de Fase 0

- [ ] `status$` alcanza el estado `OPEN` (log: `[status] OPEN (conectado)`).
- [ ] `gainDB$` emite un número concreto (no "sin dato aún" indefinidamente).
- [ ] Al mover la ganancia MANUALMENTE en la consola (canal 2), el log cambia en ≤2 s.
- [ ] Al mover la ganancia desde la interfaz web oficial, el log también cambia en ≤2 s.

## 3. Tabla de resultados (rellenar a mano)

| Hora | Valor inicial | Valor tras cambio manual | Valor tras cambio web | Observaciones | OK/FAIL |
|------|---------------|---------------------------|------------------------|----------------|---------|
|      |               |                           |                        |                |         |
|      |               |                           |                        |                |         |
|      |               |                           |                        |                |         |

## 4. Plan B si algo falla (sin instalar nada nuevo, en orden)

1. Ping a la IP de la consola (`ping <IP>`) — descarta problema de red básico.
2. Confirmar que el portátil y la consola están en la MISMA subred/red Wi-Fi.
3. Confirmar el puerto usado por la librería (revisar firewall de Windows si bloquea salida).
4. Reiniciar la consola y repetir (IP puede haber cambiado por DHCP).
5. Probar la app/interfaz web oficial de Soundcraft primero: si esa tampoco conecta,
   el problema es de red/consola, no del script.
6. Revisar versión de firmware de la consola si nada de lo anterior funciona.

## 5. Cierre

Si los 4 criterios pasan → Fase 0 cerrada → lanzar prompt de Fase 1 (STT + parser + UI).
