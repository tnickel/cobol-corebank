const http = require('node:http');

/**
 * Customer load simulator: N parallel clients calling the bank API via HTTP loopback.
 * Supports batch runs and continuous (loop) mode for real DB write load.
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
        this._sharedAccounts = [];
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
            write_ok: 0,
            rounds_completed: 0,
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
            fail: 0,
            round: 0
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
                round: c.round || 0,
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
        const continuous = !!(rawConfig.continuous || rawConfig.loop || rawConfig.mode === 'continuous');
        let mix = String(rawConfig.mix || 'ops').toLowerCase();
        if (mix === 'transfers') mix = 'transfer';
        if (mix === 'deposits') mix = 'deposit';
        if (mix === 'betrieb' || mix === 'production' || mix === 'prod') mix = 'ops';
        if (!['transfer', 'deposit', 'mixed', 'read', 'ops'].includes(mix)) {
            mix = continuous ? 'ops' : 'mixed';
        }

        this.config = {
            clients,
            txs_per_client: txsPerClient,
            delay_ms: delayMs,
            amount,
            mix,
            continuous,
            mode: continuous ? 'continuous' : 'batch'
        };
        this.stats = this._emptyStats();
        this.stats.clients_configured = clients;
        this.clientStates.clear();
        this.recentEvents = [];
        this._sharedAccounts = [];
        this.running = true;
        this.stopRequested = false;
        this.startedAt = Date.now();
        this.finishedAt = null;

        const modeLabel = continuous
            ? `Dauerbetrieb (Loop) · Stop manuell`
            : `Batch ${clients}×${txsPerClient}`;
        this._pushEvent({
            level: 'info',
            client_id: null,
            action: 'START',
            message: `Simulation gestartet · ${clients} Clients · Mix ${mix} · ${modeLabel}`
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
                    ? `Dauerbetrieb gestoppt · OK ${this.stats.transactions_ok} / Fail ${this.stats.transactions_failed} · Writes ${this.stats.write_ok}`
                    : `Simulation beendet · OK ${this.stats.transactions_ok} / Fail ${this.stats.transactions_failed} · Writes ${this.stats.write_ok}`
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
        const active = accounts.filter((a) => a.status === 'ACTIVE' || !a.status);
        if (active.length) this._sharedAccounts = active;
        return active.length ? active : this._sharedAccounts;
    }

    _pickTxType(mix, index) {
        if (mix === 'transfer') return 'TRANSFER';
        if (mix === 'deposit') return 'DEPOSIT';
        if (mix === 'read') return 'READ';
        // ops = Produktionsmix: echte DB-Schreibungen dominieren
        if (mix === 'ops') {
            const r = (index * 17 + 11) % 100;
            if (r < 55) return 'TRANSFER';
            if (r < 90) return 'DEPOSIT';
            return 'READ';
        }
        // mixed: 2 Writes : 1 Read
        const cycle = index % 3;
        if (cycle === 0) return 'TRANSFER';
        if (cycle === 1) return 'DEPOSIT';
        return 'READ';
    }

    _txAmount(step) {
        const base = this.config.amount;
        // leichte Streuung für realistischere Buchungen (bleibt klein genug für Dauerlauf)
        const jitter = ((step * 7) % 5) * 0.01;
        return Math.round((base + jitter) * 100) / 100;
    }

    _shortIban(iban) {
        const s = String(iban || '');
        if (s.length <= 12) return s;
        return `${s.slice(0, 6)}…${s.slice(-4)}`;
    }

    _isWriteSuccess(res) {
        return !!(res.data && res.data.success && res.data.data && res.data.data.status === 'ok');
    }

    async _doDeposit(clientId, accounts, step, amount) {
        if (accounts.length < 1) {
            return { ok: false, detail: 'Keine Konten für Einzahlung', eventMsg: 'Keine Konten' };
        }
        const acc = accounts[(clientId + step) % accounts.length];
        this._setClient(clientId, {
            status: 'running',
            action: 'DEPOSIT',
            detail: `+${amount} → ${this._shortIban(acc.account_no)}`,
            step
        });
        const res = await this._httpJson('POST', '/api/deposit', {
            to_account: acc.account_no,
            amount,
            description: `SimClient ${clientId} Deposit #${step}`
        }, clientId);
        const ok = this._isWriteSuccess(res) || !!(res.data && res.data.success);
        if (ok) {
            this.stats.deposits_ok++;
            this.stats.write_ok++;
            return {
                ok: true,
                detail: `Einzahlung ${amount} EUR auf ${this._shortIban(acc.account_no)}`,
                eventMsg: `Client ${clientId}: DEPOSIT ${amount} → ${this._shortIban(acc.account_no)}`
            };
        }
        const err = res.data?.data?.message || res.data?.error || 'Deposit failed';
        this.stats.last_error = err;
        return { ok: false, detail: err, eventMsg: `Client ${clientId}: Deposit fehlgeschlagen — ${err}` };
    }

    async _doTransfer(clientId, accounts, step, amount) {
        if (accounts.length < 2) {
            return { ok: false, detail: 'Zu wenige Konten für Transfer', eventMsg: 'Zu wenige Konten' };
        }
        // Bevorzuge Konto mit Guthaben als Quelle
        const sorted = [...accounts].sort((a, b) => Number(b.balance || 0) - Number(a.balance || 0));
        const from = sorted[clientId % Math.min(sorted.length, 3)] || sorted[0];
        let to = accounts[(clientId + 1 + step) % accounts.length];
        if (to.account_no === from.account_no) {
            to = accounts[(clientId + 2 + step) % accounts.length];
        }
        if (!to || from.account_no === to.account_no) {
            return { ok: false, detail: 'Transfer übersprungen (gleiche Konten)', eventMsg: `Client ${clientId}: gleiche Konten` };
        }

        this._setClient(clientId, {
            status: 'running',
            action: 'TRANSFER',
            detail: `${this._shortIban(from.account_no)} → ${this._shortIban(to.account_no)} · ${amount}`,
            step
        });
        const res = await this._httpJson('POST', '/api/transfer', {
            from_account: from.account_no,
            to_account: to.account_no,
            amount,
            description: `SimClient ${clientId} Tx #${step}`
        }, clientId);
        const ok = this._isWriteSuccess(res) || !!(res.data && res.data.success);
        if (ok) {
            this.stats.transfers_ok++;
            this.stats.write_ok++;
            return {
                ok: true,
                detail: `Transfer ${amount} EUR`,
                eventMsg: `Client ${clientId}: TRANSFER ${this._shortIban(from.account_no)} → ${this._shortIban(to.account_no)}`
            };
        }
        const err = res.data?.data?.message || res.data?.error || 'Transfer failed';
        this.stats.last_error = err;
        return { ok: false, detail: err, eventMsg: `Client ${clientId}: Transfer fehlgeschlagen — ${err}` };
    }

    async _clientLoop(clientId) {
        this.stats.clients_active++;
        const continuous = this.config.continuous;
        const batchTotal = this.config.txs_per_client;
        this._setClient(clientId, {
            status: 'running',
            action: 'BOOT',
            detail: continuous ? 'Dauerbetrieb gestartet' : 'Client gestartet',
            step: 0,
            total: continuous ? 0 : batchTotal,
            round: 0,
            ok: 0,
            fail: 0
        });

        let accounts = this._sharedAccounts.slice();
        let step = 0;
        let round = 0;

        try {
            while (!this.stopRequested) {
                if (!continuous && step >= batchTotal) break;

                step++;
                if (continuous) {
                    round = Math.floor((step - 1) / Math.max(1, batchTotal)) + 1;
                }

                // Konten periodisch neu laden (frische Salden für echte Transfers)
                if (step === 1 || step % 8 === 0 || accounts.length < 2) {
                    this._setClient(clientId, { action: 'SYNC', detail: 'Konten/Salden laden…', step, round });
                    accounts = await this._loadAccounts(clientId);
                }

                const type = this._pickTxType(this.config.mix, step + clientId);
                const amount = this._txAmount(step);
                let result = { ok: false, detail: '', eventMsg: '' };

                if (type === 'READ') {
                    this._setClient(clientId, {
                        status: 'running',
                        action: 'READ',
                        detail: 'LIST_ACCOUNTS …',
                        step,
                        round
                    });
                    const res = await this._httpJson('GET', '/api/accounts', null, clientId);
                    result.ok = !!(res.data && res.data.success);
                    if (result.ok) {
                        this.stats.reads_ok++;
                        const list = res.data?.data?.accounts || [];
                        if (list.length) {
                            accounts = list.filter((a) => a.status === 'ACTIVE' || !a.status);
                            this._sharedAccounts = accounts;
                        }
                        result.detail = 'Kontenliste gelesen';
                        result.eventMsg = `Client ${clientId}: Konten abgefragt`;
                    } else {
                        result.detail = res.data?.error || 'Read fehlgeschlagen';
                        result.eventMsg = `Client ${clientId}: Read fehlgeschlagen`;
                    }
                } else if (type === 'DEPOSIT') {
                    result = await this._doDeposit(clientId, accounts, step, amount);
                } else {
                    result = await this._doTransfer(clientId, accounts, step, amount);
                    // Bei Konflikt/Deckung: Einzahlung nachlegen und Konten refreshen (Betriebsrealismus)
                    if (!result.ok && !this.stopRequested) {
                        await this._doDeposit(clientId, accounts, step, Math.max(amount * 5, 1));
                        accounts = await this._loadAccounts(clientId);
                    }
                }

                if (result.ok) {
                    this.stats.transactions_ok++;
                    const cur = this.clientStates.get(clientId);
                    this._setClient(clientId, {
                        ok: (cur?.ok || 0) + 1,
                        detail: result.detail,
                        action: type,
                        step,
                        round,
                        total: continuous ? 0 : batchTotal
                    });
                    this._pushEvent({ level: 'ok', client_id: clientId, action: type, message: result.eventMsg });
                } else {
                    this.stats.transactions_failed++;
                    const cur = this.clientStates.get(clientId);
                    this._setClient(clientId, {
                        fail: (cur?.fail || 0) + 1,
                        detail: result.detail,
                        action: type,
                        step,
                        round,
                        total: continuous ? 0 : batchTotal
                    });
                    this._pushEvent({
                        level: 'error',
                        client_id: clientId,
                        action: type,
                        message: result.eventMsg || result.detail
                    });
                }

                if (continuous && step % batchTotal === 0) {
                    this.stats.rounds_completed++;
                    this._setClient(clientId, {
                        action: 'ROUND',
                        detail: `Runde ${round} fertig — Loop weiter`,
                        round
                    });
                }

                if (this.config.delay_ms > 0 && !this.stopRequested) {
                    const moreWork = continuous || step < batchTotal;
                    if (moreWork) {
                        this._setClient(clientId, {
                            action: 'WAIT',
                            detail: `Pause ${this.config.delay_ms} ms`,
                            step,
                            round
                        });
                        await new Promise((r) => setTimeout(r, this.config.delay_ms));
                    }
                }
            }

            if (!this.stopRequested) {
                this._setClient(clientId, {
                    status: 'done',
                    action: 'DONE',
                    detail: 'Client fertig',
                    step,
                    round
                });
            } else {
                this._setClient(clientId, {
                    status: 'stopped',
                    action: 'STOP',
                    detail: 'Abbruch nach Stop-Signal',
                    step,
                    round
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
            message: `${seedAccounts.length} aktive Konten · echte PostgreSQL-Buchungen (TRANSFER/DEPOSIT)`
        });

        const workers = [];
        for (let c = 1; c <= this.config.clients; c++) {
            workers.push(this._clientLoop(c));
        }
        await Promise.all(workers);
    }
}

module.exports = { CustomerSimulator };
