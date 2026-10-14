'use strict';
// Error with a stable machine-readable code. The UI maps `code` to a
// localized message; `message` is the English fallback.
class HubError extends Error {
    constructor(code, message, details) {
        super(message || code);
        this.name = 'HubError';
        this.code = code;
        this.details = details || null;
    }
}
module.exports = { HubError };
