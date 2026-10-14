# Vantyx Organizer

Panel CEP para After Effects que organiza el panel Project con un clic, con categorías, reglas y presets personalizables. Mismo estilo visual que Vantyx Studio.

## Instalación
1. Copia la carpeta `VantyxOrganizer` a:
   - Windows: `%APPDATA%\Adobe\CEP\extensions\`
   - macOS: `~/Library/Application Support/Adobe/CEP/extensions/`
2. Si ya usas Vantyx Studio, `PlayerDebugMode` ya está activo (extensiones sin firmar). Si no: clave `PlayerDebugMode = 1` en `HKCU\Software\Adobe\CSXS.<n>` (Windows) o `defaults write com.adobe.CSXS.<n> PlayerDebugMode 1` (macOS), con `<n>` = 9, 10, 11, 12...
3. Reinicia After Effects → Window → Extensions → Vantyx Organizer.

## Uso
- **ORGANIZE PROJECT**: escanea, clasifica y mueve según el preset activo. Ctrl/Cmd+Z deshace toda la ejecución de una vez.
- **Preview changes**: resumen por carpeta antes de aplicar (con botón "Organize now").
- **⚙ Settings**: presets (nuevo, duplicar, renombrar, borrar, restaurar), categorías (activar, nombre de carpeta, tipos, extensiones, filtro por nombre, orden, borrar) y opciones.

## Reglas
- Gana la primera categoría activa que coincide (el orden importa).
- Una categoría acepta un item si (su tipo está en "Item types" **o** su extensión está en "Extra extensions") **y** cumple el filtro de nombre.
- `/` en el nombre crea subcarpetas (`Assets/Video`). Las carpetas existentes con el mismo nombre se reutilizan.
- Solo se mueven items; nunca se eliminan, duplican, renombran ni reimportan. Las carpetas no se mueven.

## Persistencia
Cada cambio se guarda al instante en el panel y en `<userData>/VantyxOrganizer/config.json`. Al abrir se usa la copia más reciente.

## Estructura
```
CSXS/manifest.xml        registro de la extensión
client/                  panel (HTML/CSS/JS)
  js/vtx-classifier.js   motor de reglas (sin DOM ni AE)
  js/vtx-state.js        presets y categorías
  js/vtx-storage.js      guardado automático (panel + disco)
  js/vtx-host.js         puente con ExtendScript
  js/vtx-ui-*.js         vistas principal y ajustes
host/                    ExtendScript (vtx-main.jsx incluye el JSON para ES3)
  modules/scan.jsx       inventario (solo lectura)
  modules/apply.jsx      mover items (un grupo de deshacer)
  modules/storage.jsx    config.json con escritura segura
```
