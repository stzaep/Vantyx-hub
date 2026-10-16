'use strict';

const { Client } = require('@xhayper/discord-rpc');

const CLIENT_ID = '1560425473048313946';
const IMAGE_KEY = 'vantyx_logo';

function createDiscordPresence() {
    let client = null;
    let enabled = false;
    let connecting = false;
    let startedAt = null;
    let retryTimer = null;
    let stopped = false;

    function clearRetry() {
        if (retryTimer) {
            clearTimeout(retryTimer);
            retryTimer = null;
        }
    }

    function scheduleRetry() {
        clearRetry();
        if (!enabled || stopped) return;

        retryTimer = setTimeout(() => {
            retryTimer = null;
            connect();
        }, 10000);
    }

    async function disconnect() {
        clearRetry();
        connecting = false;

        const current = client;
        client = null;

        if (current) {
            try {
                if (current.user && typeof current.user.clearActivity === 'function') {
                    await current.user.clearActivity();
                }
            } catch (_) {}

            try {
                if (typeof current.destroy === 'function') {
                    await current.destroy();
                } else if (typeof current.destroy === 'function') {
                    current.destroy();
                }
            } catch (_) {}
        }
    }

    async function connect() {
        if (!enabled || stopped || connecting || client) return;

        connecting = true;
        const current = new Client({ clientId: CLIENT_ID });
        client = current;

        current.on('ready', () => {
            if (!enabled || stopped || client !== current) return;

            connecting = false;
            if (!startedAt) startedAt = new Date();

            try {
                current.user.setActivity({
                    details: 'Vantyx Hub',
                    state: 'Creating with Vantyx',
                    startTimestamp: startedAt,
                    largeImageKey: IMAGE_KEY,
                    largeImageText: 'Vantyx Hub'
                });
            } catch (_) {
                scheduleRetry();
            }
        });

        current.on('disconnected', () => {
            if (client !== current) return;
            client = null;
            connecting = false;
            scheduleRetry();
        });

        try {
            await current.login();
        } catch (_) {
            if (client === current) client = null;
            connecting = false;
            try {
                if (typeof current.destroy === 'function') await current.destroy();
            } catch (_) {}
            scheduleRetry();
        }
    }

    async function setEnabled(value) {
        enabled = value === true;

        if (!enabled) {
            startedAt = null;
            await disconnect();
            return { enabled: false };
        }

        stopped = false;
        await connect();
        return { enabled: true };
    }

    async function stop() {
        stopped = true;
        enabled = false;
        startedAt = null;
        await disconnect();
    }

    return { setEnabled, stop };
}

module.exports = { createDiscordPresence };
