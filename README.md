# Gestor de sonido Ítaca

Servidor local para Soundcraft Ui24R con obras, actores y micrófonos por canal,
escenas de ganancia, propuestas con aprobación, historial y deshacer.

## Instalar

Requiere Node.js 22 o posterior y npm. Abrir PowerShell en la carpeta del
proyecto e instalar las dependencias:

~~~powershell
npm.cmd install
~~~

## Ejecutar la demostración

~~~powershell
$env:PORT = '3000'
npm.cmd run demo
~~~

Abrir http://localhost:3000. Crear una obra y asignar sus canales. La demostración
simula 20 entradas inicialmente en 0 dB. Sus datos se guardan separados de los
del modo real. Los valores de la consola simulada se reinician al reiniciar el
servidor. Las obras y las escenas se conservan.

## Configurar y ejecutar con la consola

Crear el archivo de configuración si todavía no existe y abrirlo:

~~~powershell
if (-not (Test-Path .env)) { Copy-Item .env.example .env }
notepad .env
~~~

Configurar MIXER_IP con la IP de la Ui24R. La plantilla utiliza 10.10.1.1.
Para utilizar Supabase, completar SUPABASE_URL y SUPABASE_SECRET_KEY como se
explica en Almacenamiento. Para guardar localmente, dejar ambas variables vacías.

En otra terminal, iniciar el modo real:

~~~powershell
$env:PORT = '3001'
npm.cmd start
~~~

Abrir http://localhost:3001. Conectar la laptop a la misma red Wi-Fi o LAN que
la consola. El gestor muestra CONSOLA REAL. El registro de obras, canales y
escenas puede prepararse antes de conectar el equipo. La creación y confirmación
de propuestas necesita leer las ganancias de la consola.

Las propuestas caducan a los dos minutos y también al reiniciar el servidor.
El botón de confirmación vuelve a consultar las ganancias y los límites.
Una ganancia modificada manualmente exige generar una nueva propuesta.

Mantener abierta la terminal mientras se utiliza el gestor. Para detener el
servidor, pulsar Ctrl+C en esa terminal.

## Uso

La barra superior muestra la obra seleccionada. Cambiar obra abre el selector,
y Gestionar obras permite crear, renombrar o eliminar obras.

1. En Mapa de canales, registrar actor, micrófono, canal y límites de ganancia.
   El mínimo y el máximo definen el rango permitido para ese canal en la obra.
2. En Escenas, marcar los canales incluidos y guardar sus ganancias objetivo.
   Cada objetivo es el valor final en dB que se propondrá al aplicar la escena.
3. En Operación, escribir o dictar “sube un poco la ganancia de Ana” o
   “pon el canal 2 en 5 dB”. “Un poco” equivale a 1 dB. Un comando sin
   objetivo explícito usa el canal 2, que debe estar registrado en la obra.
   También se puede preparar una escena desde Modo guía. Anterior y Siguiente
   navegan entre escenas. Revisar cambios de escena crea una propuesta pendiente.
   Las revisiones siguientes actualizan el mismo cuadro. Revisar las ganancias
   actuales y propuestas y pulsar Confirmar o Rechazar. La escena aplicada cambia
   al completarse todos sus ajustes.
4. En Historial, “Proponer deshacer” genera otra propuesta para restaurar
   los valores anteriores. Requiere que los valores actuales coincidan con
   la operación original y que los límites actuales permitan restaurarlos.

Las ganancias son las de entradas físicas. El mapeo de actores debe reflejar
el patch de la obra. El intérprete acepta comandos de ganancia. Faders,
EQ y mute de emergencia quedan fuera de este flujo.

Una escena envía varios ajustes secuencialmente. Si falla un canal, el registro
indica cuáles se confirmaron y la escena queda parcialmente aplicada. Se debe
verificar la consola antes de repetir o recuperar los cambios.

## Almacenamiento

Por defecto se utiliza un archivo JSON con escritura atómica dentro de .data/.
Solo un servidor puede abrir cada archivo a la vez.

Para Supabase:

1. Ejecutar supabase/schema.sql en el SQL Editor del proyecto.
2. Copiar el archivo de ejemplo y abrir la configuración:

~~~powershell
if (-not (Test-Path .env)) { Copy-Item .env.example .env }
notepad .env
~~~

3. Completar SUPABASE_URL con la URL del proyecto y SUPABASE_SECRET_KEY con una
   clave del servidor que comience por sb_secret_. Guardar y ejecutar el modo
   real indicado arriba.
4. Comprobar que la terminal muestre “almacenamiento supabase”. Crear una obra
   desde la aplicación y comprobar la fila itaca en Table Editor,
   tabla sound_workspaces. WORKSPACE_ID permite elegir otro identificador.

El servidor carga .env automáticamente con Node.js. Las variables definidas en
PowerShell tienen prioridad sobre las del archivo. Reiniciar el servidor después
de modificar la configuración. El archivo .env está excluido de Git.

La clave se queda en el servidor. Se utiliza la API REST con el fetch nativo.
La tabla sound_workspaces contiene obras, asignaciones, escenas y propuestas
en un agregado JSONB, con control de revisión para detectar escrituras
concurrentes. El cambio de almacén no migra automáticamente los archivos
locales. La demostración siempre usa almacenamiento local.

Mantener un servidor de control por consola. Ante un fallo de conexión con
Supabase se muestra el error y se detienen las operaciones que requieren
persistencia. La consola conserva su operación manual.

Documentación de las claves del servidor:
https://supabase.com/docs/guides/getting-started/api-keys

## Tablet

Para acceder al gestor desde otro dispositivo de la misma red:

~~~powershell
$env:HOST = '0.0.0.0'
$env:PORT = '3001'
npm.cmd start
~~~

Abrir http://IP_DE_LA_LAPTOP:3001 desde la tablet. El servidor debe estar
en una red de ensayo de confianza. Para reconocimiento de voz desde otro
dispositivo se necesita servir la aplicación por HTTPS con un certificado
aceptado por la tablet. Desde HTTP remoto el formulario de texto sigue
disponible y el botón de micrófono muestra esa limitación.

La captura de voz depende del soporte y del servicio de reconocimiento del
navegador. Su funcionamiento en la tablet y en la red del teatro debe
comprobarse durante el ensayo.

## Si el puerto está ocupado

Detener la instancia anterior con Ctrl+C en la terminal donde se inició, o
elegir otro puerto:

~~~powershell
$env:PORT = '3002'
npm.cmd start
~~~

En ese caso abrir http://localhost:3002. Para la demostración, utilizar
npm.cmd run demo con el puerto elegido. La URL que imprime el servidor indica
el puerto que está utilizando.

## Verificar

~~~powershell
npm.cmd run typecheck
npm.cmd test
~~~

Las pruebas cubren aprobación, límites, cambios manuales, reintentos,
reinicios, deshacer, propuestas únicas por escena y la aplicación de cinco
escenas con transporte simulado.
La validación con hardware se registra en PRUEBA_LUNES.md.
