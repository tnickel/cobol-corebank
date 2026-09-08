const http = require('node:http');

/**
 * Customer load simulator: N parallel clients calling the bank API via HTTP loopback.
 * Exposes live per-client activity + recent event feed for the Simulator UI.
 */
class CustomerSimulator {
    constructor(port) {
        this.port = port;
        this.running = false;
        this.stopRequested = false;
        this.startedAt = null;
        this.finishedAt = null;
        this.config = null;
        this.stats = this._emptyStats();
        this._runPromise = null;
        this.clientStates = new Map();
        this.recentEvents = [];
        this.maxEvents = 80;
    }

    _emptyStats() {
        return {
            clients_configured: 0,
            clients_active: 0,
            clients_finished: 0,
            transactions_ok: 0,
            transactions_failed: 0,
            transfers_ok: 0,
            deposits_ok: 0,
            reads_ok: 0,
            last_error: null,
            elapsed_ms: 0
        };
    }

    _pushEvent(evt) {
        this.recentEvents.unshift({
            ...evt,
            ts: new Date().toISOString()
        });
        if (this.recentEvents.length > this.maxEvents) {
            this.recentEvents.length = this.maxEvents;
        }
    }

    _setClient(id, patch) {
        const prev = this.clientStates.get(id) || {
            id,
            status: 'idle',
            action: null,
            detail: '',
            step: 0,
            total: 0,
            ok: 0,
            fail: 0
        };
        this.clientStates.set(id, { ...prev, ...patch, id, updated_at: Date.now() });
    }

    status() {
        const elapsed = this.startedAt
            ? (this.finishedAt || Date.now()) - this.startedAt
            : 0;
        const clients = [...this.clientStates.values()]
            .sort((a, b) => a.id - b.id)
            .map((c) => ({
                id: c.id,
                status: c.status,
                action: c.action,
                detail: c.detail,
                step: c.step,
                total: c.total,
                ok: c.ok,
                fail: c.fail
            }));

        return {
            running: this.running,
            stop_requested: this.stopRequested,
            started_at: this.startedAt ? new Date(this.startedAt).toISOString() : null,
            finished_at: this.finishedAt ? new Date(this.finishedAt).toISOString() : null,
            config: this.config,
            stats: {
                ...this.stats,
                elapsed_ms: elapsed,
                tps: elapsed > 0
                    ? Math.round(((this.stats.transactions_ok + this.stats.transactions_failed) / (elapsed / 1000)) * 10) / 10
                    : 0
            },
            clients,
            recent_events: this.recentEvents.slice(0, 40)
        };
    }

    async start(rawConfig) {
        if (this.running) {
            return { ok: false, error: 'Simulator läuft bereits' };
        }

        const clients = Math.min(Math.max(parseInt(rawConfig.clients, 10) || 10, 1), 200);
        const txsPerClient = Math.min(Math.max(parseInt(rawConfig.txs_per_client, 10) || 5, 1), 500);
        const delayMs = Math.min(Math.max(parseInt(rawConfig.delay_ms, 10) || 0, 0), 10000);
        const amount = Math.max(parseFloat(rawConfig.amount) || 0.01, 0.01);
        const mix = ['transfer', 'deposit', 'mixed', 'read'].includes(rawConfig.mix)
            ? rawConfig.mix
            : 'mixed';

        this.config = {
            clients,
            txs_per_client: txsPerClient,
            delay_ms: delayMs,
            amount,
            mix
        };
        this.stats = this._emptyStats();
        this.stats.clients_configured = clients;
        this.clientStates.clear();
        this.recentEvents = [];
        this.running = true;
        this.stopRequested = false;
        this.startedAt = Date.now();
        this.finishedAt = null;

        this._pushEvent({
            level: 'info',
            client_id: null,
            action: 'START',
            message: `Simulation gestartet · ${clients} Clients × ${txsPerClient} Tx · Mix ${mix}`
        });

        this._runPromise = this._run().finally(() => {
            this.running = false;
            this.finishedAt = Date.now();
            this.stats.clients_active = 0;
            this._pushEvent({
                level: this.stopRequested ? 'warn' : 'ok',
                client_id: null,
                action: this.stopRequested ? 'STOPPED' : 'DONE',
                message: this.stopRequested
                    ? 'Simulation gestoppt'
                    : `Simulation beendet · OK ${this.stats.transactions_ok} / Fail ${this.stats.transactions_failed}`
            });
        });

        return { ok: true, config: this.config };
    }

    async stop() {
        if (!this.running) {
            return { ok: false, error: 'Kein laufender Simulator' };
        }
        this.stopRequested = true;
        this._pushEvent({
            level: 'warn',
            client_id: null,
            action: 'STOP',
            message: 'Stop angefordert — Clients beenden aktuelle Buchung'
        });
        await this._runPromise;
        return { ok: true, status: this.status() };
    }

    async _httpJson(method, apiPath, body, clientId) {
        const payload = body ? JSON.stringify(body) : null;
        return new Promise((resolve) => {
            const req = http.request({
                hostname: '127.0.0.1',
                port: this.port,
                path: apiPath,
                method,
                headers: {
                    'Content-Type': 'application/json',
                    'X-Sim-Client-Id': String(clientId),
                    ...(payload ? { 'Content-Length': Buffer.byteLength(payload) } : {})
                },
                timeout: 120000
            }, (res) => {
                let data = '';
                res.on('data', (chunk) => { data += chunk; });
                res.on('end', () => {
                    try {
                        resolve({ statusCode: res.statusCode, data: JSON.parse(data || '{}') });
                    } catch {
                        resolve({ statusCode: res.statusCode, data: { raw: data } });
                    }
                });
            });
            req.on('error', (err) => resolve({ statusCode: 0, data: { error: err.message } }));
            req.on('timeout', () => {
                req.destroy();
                resolve({ statusCode: 0, data: { error: 'timeout' } });
            });
            if (payload) req.write(payload);
            req.end();
        });
    }

    async _loadAccounts(clientId) {
        const res = await this._httpJson('GET', '/api/accounts', null, clientId);
        const accounts = res.data?.data?.accounts || [];
        return accounts.filter((a) => a.status === 'ACTIVE' || !a.status);
    }

    _pickTxType(mix, index) {
        if (mix === 'transfer') return 'TRANSFER';
        if (mix === 'deposit') return 'DEPOSIT';
        if (mix === 'read') return 'READ';
        const cycle = index % 3;
        if (cycle === 0) return 'TRANSFER';
        if (cycle === 1) return 'DEPOSIT';
        return 'READ';
    }

    _shortIban(iban) {
        const s = String(iban || '');
        if (s.length <= 12) return s;
        return `${s.slice(0, 6)}…${s.slice(-4)}`;
    }

    async _clientLoop(clientId, accounts) {
        this.stats.clients_active++;
        this._setClient(clientId, {
            status: 'running',
            action: 'BOOT',
            detail: 'Client gestartet',
            step: 0,
            total: this.config.txs_per_client,
            ok: 0,
            fail: 0
        });

        try {
            for (let i = 0; i < this.config.txs_per_client; i++) {
                if (this.stopRequested) {
                    this._setClient(clientId, {
                        status: 'stopped',
                        action: 'STOP',
                        detail: 'Abbruch nach Stop-Signal',
                        step: i
                    });
                    break;
                }

                const type = this._pickTxType(this.config.mix, i + clientId);
                let ok = false;
                let detail = '';
                let eventMsg = '';

                if (type === 'READ') {
                    this._setClient(clientId, {
                        status: 'running',
                        action: 'READ',
                        detail: 'LIST_ACCOUNTS …',
                        step: i + 1
                    });
                    const res = await this._httpJson('GET', '/api/accounts', null, clientId);
                    ok = !!(res.data && res.data.success);
                    detail = ok ? 'Kontenliste gelesen' : (res.data?.error || 'Read fehlgeschlagen');
                    eventMsg = ok ? `Client ${clientId}: Konten abgefragt` : `Client ${clientId}: Read fehlgeschlagen`;
                    if (ok) this.stats.reads_ok++;
                } else if (type === 'DEPOSIT') {
                    if (accounts.length < 1) {
                        this.stats.last_error = 'Keine Konten für Einzahlung';
                        detail = this.stats.last_error;
                        eventMsg = detail;
                    } else {
                        const acc = accounts[clientId % accounts.length];
                        this._setClient(clientId, {
                            status: 'running',
                            action: 'DEPOSIT',
                            detail: `+${this.config.amount} → ${this._shortIban(acc.account_no)}`,
                            step: i + 1
                        });
                        const res = await this._httpJson('POST', '/api/deposit', {
                            to_account: acc.account_no,
                            amount: this.config.amount,
                            description: `SimClient ${clientId} Deposit #${i + 1}`
                        }, clientId);
                        ok = !!(res.data && res.data.success);
                        if (ok) {
                            this.stats.deposits_ok++;
                            detail = `Einzahlung ${this.config.amount} EUR auf ${this._shortIban(acc.account_no)}`;
                            eventMsg = `Client ${clientId}: DEPOSIT ${this.config.amount} → ${this._shortIban(acc.account_no)}`;
                        } else {
                            this.stats.last_error = res.data?.data?.message || res.data?.error || 'Deposit failed';
                            detail = this.stats.last_error;
                            eventMsg = `Client ${clientId}: Deposit fehlgeschlagen — ${detail}`;
                        }
                    }
                } else if (accounts.length < 2) {
                    this.stats.last_error = 'Zu wenige Konten für Transfer';
                    detail = this.stats.last_error;
                    eventMsg = detail;
                } else {
                    const from = accounts[clientId % accounts.length];
                    const to = accounts[(clientId + 1 + i) % accounts.length];
                    if (from.account_no === to.account_no) {
                        detail = 'Transfer übersprungen (gleiche Konten)';
                        eventMsg = `Client ${clientId}: ${detail}`;
                        ok = false;
                    } else {
                        this._setClient(clientId, {
                            status: 'running',
                            action: 'TRANSFER',
                            detail: `${this._shortIban(from.account_no)} → ${this._shortIban(to.account_no)} · ${this.config.amount}`,
                            step: i + 1
                        });
                        const res = await this._httpJson('POST', '/api/transfer', {
                            from_account: from.account_no,
                            to_account: to.account_no,
                            amount: this.config.amount,
                            description: `SimClient ${clientId} Tx #${i + 1}`
                        }, clientId);
                        ok = !!(res.data && res.data.success);
                        if (ok) {
                            this.stats.transfers_ok++;
                            detail = `Transfer ${this.config.amount} EUR`;
                            eventMsg = `Client ${clientId}: TRANSFER ${this._shortIban(from.account_no)} → ${this._shortIban(to.account_no)}`;
                        } else {
                            this.stats.last_error = res.data?.data?.message || res.data?.error || 'Transfer failed';
                            detail = this.stats.last_error;
                            eventMsg = `Client ${clientId}: Transfer fehlgeschlagen — ${detail}`;
                        }
                    }
                }

                if (ok) {
                    this.stats.transactions_ok++;
                    const cur = this.clientStates.get(clientId);
                    this._setClient(clientId, {
                        ok: (cur?.ok || 0) + 1,
                        detail,
                        action: type,
                        step: i + 1
                    });
                    this._pushEvent({ level: 'ok', client_id: clientId, action: type, message: eventMsg });
                } else {
                    this.stats.transactions_failed++;
                    const cur = this.clientStates.get(clientId);
                    this._setClient(clientId, {
                        fail: (cur?.fail || 0) + 1,
                        detail,
                        action: type,
                        step: i + 1
                    });
                    this._pushEvent({ level: 'error', client_id: clientId, action: type, message: eventMsg || detail });
                }

                if (this.config.delay_ms > 0 && i < this.config.txs_per_client - 1 && !this.stopRequested) {
                    this._setClient(clientId, {
                        action: 'WAIT',
                        detail: `Pause ${this.config.delay_ms} ms`
                    });
                    await new Promise((r) => setTimeout(r, this.config.delay_ms));
                }
            }

            if (!this.stopRequested) {
                this._setClient(clientId, {
                    status: 'done',
                    action: 'DONE',
                    detail: 'Client fertig',
                    step: this.config.txs_per_client
                });
            }
        } finally {
            this.stats.clients_active = Math.max(0, this.stats.clients_active - 1);
            this.stats.clients_finished++;
        }
    }

    async _run() {
        const seedAccounts = await this._loadAccounts('bootstrap');
        if (seedAccounts.length < 1) {
            this.stats.last_error = 'Keine Konten in der Bank — bitte zuerst INIT / Admin öffnen';
            this.stats.transactions_failed++;
            this._pushEvent({
                level: 'error',
                client_id: null,
                action: 'INIT',
                message: this.stats.last_error
            });
            return;
        }

        this._pushEvent({
            level: 'info',
            client_id: null,
            action: 'ACCOUNTS',
            message: `${seedAccounts.length} aktive Konten für Simulation geladen`
        });

        const workers = [];
        for (let c = 1; c <= this.config.clients; c++) {
            workers.push(this._clientLoop(c, seedAccounts));
        }
        await Promise.all(workers);
    }
}

module.exports = { CustomerSimulator };
