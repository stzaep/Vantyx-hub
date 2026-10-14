# Vantyx Hub

Aplicación de escritorio para Windows que instala, repara y desinstala las herramientas Vantyx de After Effects desde un solo sitio.

Estado: **fase 1** (núcleo + interfaz) con instalador de Windows y actualizaciones desde la propia app. Instala por usuario extensiones CEP (como Vantyx Organizer).

## Requisitos

- Windows 10/11
- [Node.js](https://nodejs.org) 20 o superior (solo para desarrollar y generar el `.exe`)

## Uso en desarrollo

```bat
npm install
npm test          :: 90 tests (núcleo, actualizador, IPC, interfaz, configuración)
npm start         :: abre el Hub
```

## Generar el .exe y publicar versiones

```bat
npm install
npm run dist
```

Genera en `dist\` el instalador `Vantyx-Hub-Setup-<versión>.exe`, su `.blockmap` y `latest.yml`.

Guía completa (configurar GitHub Releases, publicar una versión, cómo llega a los usuarios, firma digital y pruebas pendientes en Windows): **[docs/RELEASING.md](docs/RELEASING.md)**.

> Las actualizaciones automáticas requieren poner tu usuario y repositorio en `electron-builder.yml` (`publish`). Hasta entonces la app muestra «origen de actualizaciones no configurado». El `.exe` no está firmado.

## Actualizaciones

La tarjeta **Actualizaciones** de la interfaz muestra la versión instalada, busca versiones nuevas (también al abrir, si está activado en la propia tarjeta), enseña las notas, descarga con progreso real y pide confirmación antes de «Instalar y reiniciar». Solo actualiza Vantyx Hub; las herramientas de After Effects, los recibos y los ajustes no se tocan.

## Cómo funciona

- Las herramientas disponibles están en `library/` (cada una, una carpeta o un `.vantyx`). Ver `docs/package-format.md`.
- Al instalar, el Hub copia los archivos a `%APPDATA%\Adobe\CEP\extensions\<carpeta>` y activa el modo de extensiones sin firmar (`PlayerDebugMode`) en el registro de usuario.
- Guarda un **recibo** de cada instalación en `%APPDATA%\Vantyx Hub\receipts.json` (archivos y hashes). De ahí salen los estados: no instalada, instalada, actualización disponible, incompleta, modificada, detectada sin gestionar.
- Desinstalar borra **solo** los archivos del recibo. Lo que no instaló el Hub (tus archivos, otras extensiones) no se toca.
- Los ajustes del usuario (p. ej. `%APPDATA%\VantyxOrganizer`) se conservan salvo que marques borrarlos.
- Si ya existe una carpeta con el mismo nombre que no instaló el Hub, pregunta antes de reemplazarla y guarda copia en `%APPDATA%\Vantyx Hub\backups`.
- Las instalaciones son transaccionales: si algo falla a mitad, se deshace todo.

## Estructura

```
src/core/       lógica sin interfaz (rutas seguras, ZIP, paquetes, instalador, desinstalador, recibos, AE, actualizador, ajustes)
src/kinds/      un archivo por tipo de herramienta (cep)
src/main/       Electron: ventana, IPC validado (herramientas y actualizaciones), puente preload
src/renderer/   interfaz (HTML/CSS/JS sin bundler); textos en js/strings.js (ES/EN automático)
library/        herramientas incluidas
tests/          tests con carpetas simuladas
```

## Fuente tipográfica

El tema usa Fira Code. Si no está instalada en el equipo, cae a Cascadia Mono / Consolas. Para incluirla en el `.exe`, copia `FiraCode-VF.woff2` en `src/renderer/fonts/`.

## Pendiente (fases siguientes)

- Fase 2: importar `.vantyx`/ZIP desde la interfaz, varias versiones por herramienta, elegir versión.
- Fase 3: tipo ScriptUI (requiere permisos de administrador y elegir versión de After Effects), adoptar instalaciones existentes, firma del `.exe` (ver docs/RELEASING.md).
