'use strict';

const http = require('node:http');

function requestJson(baseUrl, method, path, body, headers = {}) {
    const url = new URL(path, baseUrl);
    const payload = body == null ? null : JSON.stringify(body);
    return new Promise((resolve, reject) => {
        const req = http.request({
            hostname: url.hostname,
            port: url.port,
            path: url.pathname + url.search,
            method,
            headers: {
                'Content-Type': 'application/json',
                ...(payload ? { 'Content-Length': Buffer.byteLength(payload) } : {}),
                ...headers
            },
            timeout: 60000
        }, (res) => {
            let data = '';
            res.on('data', (c) => { data += c; });
            res.on('end', () => {
                let parsed = null;
                try { parsed = data ? JSON.parse(data) : null; } catch { parsed = { raw: data }; }
                resolve({ statusCode: res.statusCode, headers: res.headers, body: parsed, raw: data });
            });
        });
        req.on('error', reject);
        req.on('timeout', () => {
            req.destroy();
            reject(new Error('timeout'));
        });
        if (payload) req.write(payload);
        req.end();
    });
}

function sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
}

async function waitFor(predicate, { timeoutMs = 15000, intervalMs = 200, label = 'condition' } = {}) {
    const start = Date.now();
    let last;
    while (Date.now() - start < timeoutMs) {
        last = await predicate();
        if (last) return last;
        await sleep(intervalMs);
    }
    throw new Error(`Timeout waiting for ${label}`);
}

/**
 * Minimal bank API mock for CustomerSimulator unit tests.
 * Tracks write counts so tests can assert real write traffic.
 */
function createMockBankServer() {
    const state = {
        accounts: [
            { account_no: 'DE1001', holder_name: 'A', balance: 1000, status: 'ACTIVE' },
            { account_no: 'DE1002', holder_name: 'B', balance: 1000, status: 'ACTIVE' },
            { account_no: 'DE1003', holder_name: 'C', balance: 500, status: 'ACTIVE' }
        ],
        transfers: 0,
        deposits: 0,
        reads: 0,
        clientIds: new Set()
    };

    const server = http.createServer((req, res) => {
        const simId = req.headers['x-sim-client-id'];
        if (simId) state.clientIds.add(String(simId));

        let body = '';
        req.on('data', (c) => { body += c; });
        req.on('end', () => {
            const url = new URL(req.url, 'http://127.0.0.1');
            const send = (code, obj) => {
                const raw = JSON.stringify(obj);
                res.writeHead(code, { 'Content-Type': 'application/json' });
                res.end(raw);
            };

            if (url.pathname === '/api/accounts' && req.method === 'GET') {
                state.reads++;
                return send(200, {
                    success: true,
                    durationMs: 1,
                    data: {
                        status: 'ok',
                        total_accounts: state.accounts.length,
                        accounts: state.accounts
                    }
                });
            }

            let parsed = {};
            try { parsed = body ? JSON.parse(body) : {}; } catch { /* ignore */ }

            if (url.pathname === '/api/deposit' && req.method === 'POST') {
                state.deposits++;
                const acc = state.accounts.find((a) => a.account_no === parsed.to_account);
                if (acc) acc.balance = Number(acc.balance) + Number(parsed.amount || 0);
                return send(200, {
                    success: true,
                    durationMs: 2,
                    data: { status: 'ok', message: 'Deposit ok', to_account: parsed.to_account, amount: parsed.amount }
                });
            }

            if (url.pathname === '/api/transfer' && req.method === 'POST') {
                state.transfers++;
                const from = state.accounts.find((a) => a.account_no === parsed.from_account);
                const to = state.accounts.find((a) => a.account_no === parsed.to_account);
                const amount = Number(parsed.amount || 0);
                if (from && to && Number(from.balance) >= amount) {
                    from.balance = Number(from.balance) - amount;
                    to.balance = Number(to.balance) + amount;
                    return send(200, {
                        success: true,
                        durationMs: 3,
                        data: { status: 'ok', message: 'Transfer ok' }
                    });
                }
                return send(200, {
                    success: false,
                    durationMs: 3,
                    data: { status: 'error', message: 'Insufficient funds' }
                });
            }

            send(404, { error: 'not found' });
        });
    });

    return {
        state,
        listen() {
            return new Promise((resolve) => {
                server.listen(0, '127.0.0.1', () => {
                    const { port } = server.address();
                    resolve(port);
                });
            });
        },
        close() {
            return new Promise((resolve, reject) => {
                server.close((err) => (err ? reject(err) : resolve()));
            });
        }
    };
}

module.exports = {
    requestJson,
    sleep,
    waitFor,
    createMockBankServer
};
