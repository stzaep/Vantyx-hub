# Formato de paquete de herramienta (`.vantyx`)

Una herramienta es una **carpeta** o un **ZIP** (`.vantyx` o `.zip`) con esta estructura:

```
vantyx.json          <- descripción (obligatorio, en la raíz)
payload/             <- archivos que se instalan (el nombre se indica en "payload")
  CSXS/manifest.xml
  client/...
  host/...
```

## vantyx.json

| Campo | Obligatorio | Descripción |
|---|---|---|
| `id` | sí | Identificador único: minúsculas, números y guiones (`vantyx-organizer`). |
| `name` | sí | Nombre visible. |
| `version` | sí | `1.2.3` (admite `1.2.3-beta`). Sube la versión para que el Hub ofrezca "Actualizar". |
| `kind` | sí | Tipo de herramienta. Ahora: `cep`. |
| `description`, `author` | no | Texto informativo. |
| `payload` | no | Carpeta del paquete con los archivos (por defecto `payload`). |
| `installDir` | no | Nombre de la carpeta final dentro de `extensions` (por defecto, el nombre de `payload`). |
| `userData` | no | Carpetas con ajustes del usuario, p. ej. `["%APPDATA%/VantyxOrganizer"]`. Se **conservan** al desinstalar salvo que el usuario marque borrarlas. Deben estar en `%APPDATA%` o `%LOCALAPPDATA%` y contener "vantyx" en el nombre; si no, el Hub se niega a borrarlas. |
| `cep.requiresDebugMode` | no | `true` por defecto: el Hub activa `PlayerDebugMode` para extensiones sin firmar. |

## Reglas que el Hub aplica a cualquier paquete

- Rutas relativas y seguras: se rechazan `..`, rutas absolutas, letras de unidad y nombres reservados de Windows.
- ZIP: sin cifrado, sin ZIP64, CRC verificado, límites de tamaño y de ratio de compresión.
- Para `cep`, el payload debe incluir `CSXS/manifest.xml` con `ExtensionBundleId`.
- Todo se valida y se comprueba (hash SHA-256) **antes** de escribir nada.

## Añadir un tipo nuevo (p. ej. paneles ScriptUI)

1. Crear `src/kinds/<tipo>.js` con la misma interfaz que `cep.js` (`validateManifest`, `validatePayload`, `getTargets`, `afterInstall`).
2. Registrarlo en `src/kinds/index.js`.
3. Añadir tests en `tests/`.

El instalador, el desinstalador, los recibos y la interfaz no cambian.
