# Instalador y publicación de versiones de Vantyx Hub

> **Estado de verificación.** Las pruebas automáticas (`npm test`, 90 tests) cubren la lógica del actualizador, el IPC, el preload, la interfaz, los ajustes y la configuración del instalador. **Nada de esto se ha probado en Windows**: ni la compilación del `.exe`, ni la instalación, ni una actualización real. Haz la lista de comprobación del final (sección 5) antes de distribuir.

## 1. Qué hace cada pieza

| Pieza | Dónde | Para qué |
|---|---|---|
| Instalador NSIS | `electron-builder.yml` → `nsis` | Instala por usuario (sin administrador), carpeta elegible, accesos directos en escritorio y menú Inicio, entrada en «Aplicaciones instaladas». |
| Actualizador | `src/core/updater.js` + `electron-updater` | Consulta, descarga e instala versiones nuevas desde la interfaz. |
| Origen de actualizaciones | `electron-builder.yml` → `publish` | GitHub Releases (`latest.yml` + instalador). |
| Ajustes | `%APPDATA%\Vantyx Hub\settings.json` | «Buscar actualizaciones al abrir». Junto a `receipts.json`. |

Separación importante: el actualizador **solo cambia Vantyx Hub**. No toca `%APPDATA%\Adobe\CEP\extensions`, ni los recibos, ni los ajustes. Las herramientas de After Effects se siguen instalando/reparando/desinstalando solo desde sus botones. El desinstalador de Windows tampoco las toca ni borra `%APPDATA%\Vantyx Hub` (`deleteAppDataOnUninstall: false`).

## 2. Configuración que debes poner (una sola vez)

1. Crea un repositorio en GitHub para publicar las versiones. **Tiene que ser público**: la app no puede llevar ningún token, y un repositorio privado exige uno.
2. `electron-builder.yml` → `publish` ya apunta a `stzaep/Vantyx-hub`. Si cambias de usuario o repositorio, edita `owner` y `repo`. Con valores `YOUR_*` la app mostraría «origen de actualizaciones no configurado» y `npm run release` se negaría a publicar.
3. Sube el proyecto a ese repositorio. Para el flujo automático no necesitas crear ningún secreto: usa el `GITHUB_TOKEN` que GitHub da a cada ejecución.

Si prefieres tu propio servidor en vez de GitHub: cambia `publish` a `provider: generic` con `url: https://…` (HTTPS obligatorio) y sube allí el contenido de `dist/`.

## 3. Generar el instalador `.exe` (en Windows)

Requisitos: Windows 10/11 y [Node.js](https://nodejs.org) 20 o superior.

```bat
npm install
npm test
npm run dist
```

(o doble clic en `build-exe.bat`). Salida en `dist\`:

- `Vantyx-Hub-Setup-<versión>.exe` — el instalador que das a los usuarios.
- `Vantyx-Hub-Setup-<versión>.exe.blockmap` — permite descargar solo las diferencias.
- `latest.yml` — metadatos para el actualizador.

`npm run dist:portable` genera una versión portable aparte. **No se actualiza sola** (la interfaz lo explica) y no se recomienda distribuirla junto al instalador para no tener copias duplicadas.

Un solo icono/entrada: el instalador usa un identificador fijo (`appId: com.vantyx.hub`), así que instalar otra versión encima actualiza la existente en vez de crear una copia.

## 4. Publicar una versión nueva

Cada versión nueva tiene que ser **mayor** que la anterior (la app ignora la misma o una menor).

1. Cambia `version` en `package.json` (por ejemplo `0.1.0` → `0.2.0`). Es la única fuente de la versión.
2. Commit y push.
3. Crea y sube la etiqueta, con la `v` delante y el mismo número:
   ```bash
   git tag v0.2.0
   git push origin v0.2.0
   ```
4. El workflow `.github/workflows/release.yml` (Windows) ejecuta los tests, comprueba que la etiqueta coincide con `package.json` y que el `publish` está configurado, compila y **publica** el instalador, el `.blockmap` y `latest.yml` en GitHub Releases.
5. Escribe las notas en la release de GitHub (Releases → la versión → Edit). Esas notas son las que la app muestra como «Notas de la versión».

Sin GitHub Actions, desde tu PC: define `GH_TOKEN` (token personal con permiso de escritura en el repositorio, **solo en tu equipo**, nunca en el código) y ejecuta `npm run release`.

**Cómo llega a los usuarios:** la app instalada (con «Buscar actualizaciones al abrir» activo) o el botón «Check for updates» consulta `latest.yml` de la última release. Si la versión es mayor, muestra versión y notas; el usuario pulsa «Download update», ve el progreso y, al terminar, «Install and restart» (pide confirmación). Se espera que se instale en silencio, sin UAC (instalación por usuario), y que la app se reabra (por confirmar en Windows, sección 5).

Limitación: los usuarios que tengan una compilación anterior **sin** actualizador deben instalar a mano una vez la primera versión que lo incluye; a partir de ahí se actualizan solos.

## 5. Pruebas reales que faltan (en Windows)

- [ ] `npm run dist` termina sin errores y genera los 3 archivos de la sección 3.
- [ ] El instalador deja elegir carpeta, crea los accesos directos y la app aparece en «Aplicaciones instaladas».
- [ ] Volver a ejecutar el instalador actualiza la instalación existente (no crea otra).
- [ ] Desinstalar desde Windows conserva `%APPDATA%\Vantyx Hub` y las extensiones de `%APPDATA%\Adobe\CEP\extensions`.
- [ ] Publicar una versión de prueba (p. ej. `0.1.1`), abrir la `0.1.0` instalada y completar: buscar → descargar → instalar y reiniciar. Comprobar que siguen los ajustes y las herramientas instaladas.
- [ ] Sin Internet, «Check for updates» muestra el aviso de conexión y la app sigue funcionando.
- [ ] Con la actualización descargada, pulsar «Cancelar» en el diálogo no reinicia la app.

## 6. Firma digital (recomendada)

Ahora el instalador **no está firmado**. Windows SmartScreen avisará a los usuarios («Más información» → «Ejecutar de todos modos») y puede tardar en confiar en él. Para firmarlo necesitas un certificado de firma de código (de una autoridad certificadora, o un servicio como Azure Trusted Signing). Cuando lo tengas, en `electron-builder.yml` bajo `win:` añade la configuración de firma que corresponda a tu certificado (ver la documentación de electron-builder, «Code Signing») y `publisherName` con el nombre exacto del certificado; así `electron-updater` también verificará la firma de cada actualización. Los certificados y contraseñas van en secretos del CI o variables de entorno, nunca en el repositorio.

## 7. Lo que aún necesitas aportar

- [ ] Cuenta y repositorio público de GitHub (o un servidor HTTPS propio).
- [x] `owner` y `repo` en `electron-builder.yml` (`stzaep` / `Vantyx-hub`). Falta crear el repositorio público con ese nombre.
- [ ] Un PC con Windows (o los runners de GitHub Actions) para compilar y probar.
- [ ] Opcional pero recomendable: certificado de firma de código.
- [ ] Opcional: `build/icon.ico` definitivo (ya hay uno) y casilla de accesos directos durante la instalación — el instalador crea ambos accesos directos siempre; ofrecer una casilla para elegir exige una página NSIS personalizada que no se ha incluido por no poder probarla.
