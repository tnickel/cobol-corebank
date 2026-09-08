'use strict';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { CustomerSimulator } = require('../backend/simulator');
const { createMockBankServer, sleep, waitFor } = require('./lib/http');

describe('CustomerSimulator (unit / mock bank)', () => {
    let mock;
    let port;
    let sim;

    before(async () => {
        mock = createMockBankServer();
        port = await mock.listen();
        sim = new CustomerSimulator(port);
    });

    after(async () => {
        if (sim.running) await sim.stop();
        await mock.close();
    });

    it('rejects double start', async () => {
        const first = await sim.start({
            clients: 2,
            txs_per_client: 50,
            delay_ms: 20,
            mix: 'ops',
            continuous: true,
            amount: 0.01
        });
        assert.equal(first.ok, true);
        assert.equal(first.config.continuous, true);
        assert.equal(first.config.mix, 'ops');

        const second = await sim.start({ clients: 1, continuous: true });
        assert.equal(second.ok, false);
        assert.match(second.error, /läuft bereits/i);

        await sim.stop();
    });

    it('batch mode finishes and records DB-like writes', async () => {
        mock.state.transfers = 0;
        mock.state.deposits = 0;
        mock.state.reads = 0;

        const start = await sim.start({
            clients: 3,
            txs_per_client: 4,
            delay_ms: 0,
            mix: 'ops',
            continuous: false,
            amount: 0.01
        });
        assert.equal(start.ok, true);
        assert.equal(start.config.mode, 'batch');

        await waitFor(() => !sim.status().running, { timeoutMs: 20000, label: 'batch finish' });

        const st = sim.status();
        assert.equal(st.running, false);
        assert.ok(st.stats.transactions_ok + st.stats.transactions_failed >= 12);
        assert.ok(st.stats.write_ok > 0, 'expected write_ok > 0');
        assert.ok(mock.state.transfers + mock.state.deposits > 0, 'mock bank must receive writes');
        assert.ok(st.stats.clients_finished === 3);
    });

    it('continuous mode loops until stop and keeps writing', async () => {
        mock.state.transfers = 0;
        mock.state.deposits = 0;

        const start = await sim.start({
            clients: 4,
            txs_per_client: 3,
            delay_ms: 5,
            mix: 'ops',
            continuous: true,
            amount: 0.01
        });
        assert.equal(start.ok, true);

        await waitFor(
            () => sim.status().stats.write_ok >= 8,
            { timeoutMs: 15000, label: 'write_ok >= 8' }
        );

        const mid = sim.status();
        assert.equal(mid.running, true);
        assert.equal(mid.config.continuous, true);
        assert.ok(mid.stats.clients_active >= 1);
        assert.ok(mid.clients.some((c) => c.status === 'running'));
        assert.ok(mid.recent_events.length > 0);
        assert.ok(mock.state.clientIds.size >= 1);

        const writesBeforeStop = mid.stats.write_ok;
        await sleep(400);
        assert.ok(sim.status().stats.write_ok >= writesBeforeStop);

        const stop = await sim.stop();
        assert.equal(stop.ok, true);
        assert.equal(sim.status().running, false);
        assert.ok(sim.status().stats.write_ok >= writesBeforeStop);
    });

    it('transfer mix issues transfer POSTs to the bank', async () => {
        mock.state.transfers = 0;
        const start = await sim.start({
            clients: 2,
            txs_per_client: 6,
            delay_ms: 0,
            mix: 'transfer',
            continuous: false,
            amount: 0.01
        });
        assert.equal(start.ok, true);
        await waitFor(() => !sim.status().running, { timeoutMs: 15000, label: 'transfer batch' });
        assert.ok(mock.state.transfers >= 6, `expected transfers, got ${mock.state.transfers}`);
        assert.ok(sim.status().stats.transfers_ok >= 1);
    });

    it('aliases production mix names to ops', async () => {
        const start = await sim.start({
            clients: 1,
            txs_per_client: 1,
            mix: 'production',
            continuous: false
        });
        assert.equal(start.ok, true);
        assert.equal(start.config.mix, 'ops');
        await waitFor(() => !sim.status().running, { timeoutMs: 10000, label: 'alias batch' });
    });
});
