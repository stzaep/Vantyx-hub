// =========================================================
//  Vantyx Organizer - client/js/vtx-defaults.js
//  Catálogo de tipos de item, extensiones conocidas y la
//  configuración por defecto (preset "General").
// =========================================================
(function (root) {
    'use strict';
    var VTX = root.VTX = root.VTX || {};

    // Tipos de item que una categoría puede aceptar.
    VTX.KINDS = [
        { id: 'comp',        label: 'Compositions',     hint: 'Comps que no se usan dentro de otra comp' },
        { id: 'precomp',     label: 'Precomps',         hint: 'Comps anidadas dentro de otra comp' },
        { id: 'video',       label: 'Videos',           hint: 'Archivos de vídeo' },
        { id: 'sequence',    label: 'Image sequences',  hint: 'Secuencias de imágenes (frame_0001.png...)' },
        { id: 'image',       label: 'Images',           hint: 'Imágenes fijas (png, jpg, psd...)' },
        { id: 'vector',      label: 'Vectors',          hint: 'ai, eps, svg, pdf' },
        { id: 'audio',       label: 'Audio',            hint: 'Archivos de audio' },
        { id: 'solid',       label: 'Solids',           hint: 'Sólidos (incluye nulos y capas de ajuste)' },
        { id: 'placeholder', label: 'Placeholders',     hint: 'Marcadores de posición' },
        { id: 'missing',     label: 'Missing footage',  hint: 'Archivos cuyo origen no se encuentra' },
        { id: 'other',       label: 'Other files',      hint: 'Footage que no encaja en ningún tipo anterior' }
    ];

    function words(s) { return s.split(' '); }

    VTX.EXT = {
        video:  words('mp4 mov m4v avi mkv webm mxf mpg mpeg mpe m2v m2t m2ts mts ts wmv flv f4v 3gp 3g2 r3d braw ogv vob dv'),
        audio:  words('wav mp3 aac aif aiff m4a flac ogg oga wma mp2 ac3 caf'),
        image:  words('png jpg jpeg jpe bmp tif tiff psd psb tga targa exr hdr dpx cin webp heic heif gif rla rpf pxr pict pct sgi'),
        vector: words('ai eps svg pdf')
    };

    VTX.NAME_MODES = [
        { id: 'none',       label: 'No name filter' },
        { id: 'contains',   label: 'Name contains' },
        { id: 'startsWith', label: 'Name starts with' },
        { id: 'endsWith',   label: 'Name ends with' },
        { id: 'regex',      label: 'Name matches regex' }
    ];

    VTX.SCOPES = [
        { id: 'loose', label: 'Only loose items (project root)' },
        { id: 'all',   label: 'All items (also inside folders)' }
    ];

    function cat(id, name, enabled, kinds) {
        return { id: id, name: name, enabled: enabled, kinds: kinds, extensions: [], nameRule: { mode: 'none', value: '' } };
    }

    VTX.defaults = {
        categories: function () {
            // El ORDEN importa: gana la primera categoría activa que coincida.
            return [
                cat('c_missing',  'Missing Footage', false, ['missing']),
                cat('c_precomps', 'Precomps',        true,  ['precomp']),
                cat('c_comps',    'Compositions',    true,  ['comp']),
                cat('c_videos',   'Videos',          true,  ['video']),
                cat('c_images',   'Images',          true,  ['image', 'vector']),
                cat('c_seqs',     'Sequences',       true,  ['sequence']),
                cat('c_audio',    'Audio',           true,  ['audio']),
                cat('c_solids',   'Solids',          true,  ['solid'])
            ];
        },
        options: function () {
            return {
                scope: 'loose',
                fallback: { enabled: false, name: 'Other' },
                previewBeforeOrganize: false
            };
        },
        preset: function (id, name) {
            return { id: id || 'general', name: name || 'General', categories: VTX.defaults.categories(), options: VTX.defaults.options() };
        },
        config: function () {
            return {
                version: 1,
                savedAt: 0,
                ui: { theme: 'dark', collapsed: {} },
                activePresetId: 'general',
                presets: [VTX.defaults.preset('general', 'General')]
            };
        }
    };
})(typeof window !== 'undefined' ? window : global);
