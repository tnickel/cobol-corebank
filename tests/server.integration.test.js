'use strict';

/**
 * Integration tests against a running CoreBank server (default http://127.0.0.1:3000).
 * Verifies simulator APIs AND that /api/system-status reflects load correctly for Admin UI.
 */

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { requestJson, sleep, waitFor } = require('./lib/http');

const BASE = process.env.TEST_BASE_URL || 'http://127.0.0.1:3000';

async function systemStatus() {
    const res = await requestJson(BASE, 'GET', '/api/system-status');
    assert.equal(res.statusCode, 200, `system-status HTTP ${res.statusCode}`);
    return res.body;
}

async function simStatus() {
    const res = await requestJson(BASE, 'GET', '/api/simulate/status');
    assert.equal(res.statusCode, 200);
    return res.body;
}

async function ensureIdleSimulator() {
    const st = await simStatus();
    if (st.running) {
        await requestJson(BASE, 'POST', '/api/simulate/stop', {});
        await waitFor(async () => !(await simStatus()).running, {
            timeoutMs: 60000,
            label: 'simulator idle'
        });
    }
}

describe('Server + Simulator integration', () => {
    before(async () => {
        let probe;
        try {
            probe = await requestJson(BASE, 'GET', '/api/system-status');
        } catch (err) {
            throw new Error(
                `Server nicht erreichbar unter ${BASE}. Bitte startadmin.bat / node backend/server.js. (${err.message})`
            );
        }
        assert.equal(probe.statusCode, 200);
        assert.equal(probe.body.status, 'online');
        await ensureIdleSimulator();
    });

    after(async () => {
        try {
            await ensureIdleSimulator();
        } catch {
            /* ignore cleanup errors */
        }
    });

    it('system-status exposes queue + live fields Admin UI needs', async () => {
        const body = await systemStatus();
        assert.ok(body.queue, 'queue missing');
        assert.equal(typeof body.queue.active_workers, 'number');
        assert.equal(typeof body.queue.recent_active_workers, 'number');
        assert.equal(typeof body.queue.peak_active_workers, 'number');
        assert.equal(typeof body.queue.concurrency, 'number');
        assert.ok(body.queue.concurrency >= 1);
        assert.equal(typeof body.queue.total_processed, 'number');
        assert.equal(typeof body.queue.depth, 'number');
        assert.ok(body.live, 'live missing');
        assert.equal(typeof body.live.clients_active, 'number');
        assert.equal(typeof body.live.transactions_per_sec, 'number');
        assert.ok(body.simulator, 'simulator snapshot missing');
        assert.equal(typeof body.simulator.running, 'boolean');
    });

    it('accounts endpoint returns seeded accounts for simulation', async () => {
        const res = await requestJson(BASE, 'GET', '/api/accounts');
        assert.equal(res.statusCode, 200);
        assert.equal(res.body.success, true);
        const accounts = res.body.data?.accounts || [];
        assert.ok(accounts.length >= 2, 'need >= 2 accounts for transfer sim');
    });

    it('continuous ops simulation writes to DB and lights up worker pool in system-status', async () => {
        const before = await systemStatus();
        const processedBefore = before.queue.total_processed || 0;
        const txBefore = await requestJson(BASE, 'GET', '/api/transactions');
        const journalBefore = txBefore.body.data?.total_transactions
            ?? (txBefore.body.data?.transactions || []).length
            ?? 0;

        const start = await requestJson(BASE, 'POST', '/api/simulate/start', {
            clients: 10,
            txs_per_client: 4,
            delay_ms: 20,
            amount: 0.01,
            mix: 'ops',
            continuous: true
        });
        assert.equal(start.statusCode, 200);
        assert.equal(start.body.ok, true);
        assert.equal(start.body.config.continuous, true);
        assert.equal(start.body.config.mix, 'ops');

        // During run: simulator + workers + writes must move
        const hot = await waitFor(async () => {
            const sys = await systemStatus();
            const sim = sys.simulator || {};
            const q = sys.queue || {};
            const live = sys.live || {};
            const busyWorkers = (q.active_workers || 0) > 0 || (q.recent_active_workers || 0) > 0;
            const writing = (sim.stats?.write_ok || 0) >= 5;
            const clientsSeen = (live.clients_active || 0) >= 2 || (sim.stats?.clients_active || 0) >= 2;
            if (sim.running && busyWorkers && writing && clientsSeen) {
                return { sys, sim, q, live };
            }
            return null;
        }, { timeoutMs: 25000, intervalMs: 250, label: 'hot system-status under load' });

        assert.equal(hot.sim.running, true);
        assert.ok(hot.q.peak_active_workers >= 1, 'peak_active_workers should rise');
        assert.ok(
            (hot.q.active_workers || 0) + (hot.q.recent_active_workers || 0) >= 1,
            'Admin KPI would show 0 workers — pool not reflecting load'
        );
        assert.ok(hot.sim.stats.write_ok >= 5, `write_ok=${hot.sim.stats.write_ok}`);
        assert.ok(
            (hot.live.transactions_per_sec || 0) > 0 || (hot.live.transactions_in_window || 0) > 0,
            'TPS/window should show activity for Admin'
        );
        assert.ok(
            (hot.live.clients_active || 0) >= 1,
            'clients_active should count sim:* clients'
        );

        // Double-start must 409
        const dup = await requestJson(BASE, 'POST', '/api/simulate/start', {
            clients: 1,
            continuous: true
        });
        assert.equal(dup.statusCode, 409);
        assert.equal(dup.body.ok, false);

        const stop = await requestJson(BASE, 'POST', '/api/simulate/stop', {});
        assert.equal(stop.statusCode, 200);
        assert.equal(stop.body.ok, true);

        await waitFor(async () => !(await simStatus()).running, {
            timeoutMs: 60000,
            label: 'sim stopped'
        });

        const after = await systemStatus();
        assert.equal(after.simulator.running, false);
        assert.ok(
            (after.queue.total_processed || 0) > processedBefore,
            `total_processed should grow (${processedBefore} → ${after.queue.total_processed})`
        );
        assert.ok(
            (after.queue.peak_active_workers || 0) >= 1,
            'peak_active_workers retained after run'
        );
        assert.ok((after.simulator.stats.write_ok || 0) >= 5);

        await sleep(300);
        const txAfter = await requestJson(BASE, 'GET', '/api/transactions');
        const journalAfter = txAfter.body.data?.total_transactions
            ?? (txAfter.body.data?.transactions || []).length
            ?? 0;
        assert.ok(
            journalAfter > journalBefore,
            `Journal must grow with real writes (${journalBefore} → ${journalAfter})`
        );

        const journal = txAfter.body.data?.transactions || [];
        const simTx = journal.filter((t) => /SimClient/i.test(t.description || ''));
        assert.ok(simTx.length >= 1, 'Journal should contain SimClient descriptions');
    });

    it('batch transfer simulation completes and updates queue counters', async () => {
        await ensureIdleSimulator();
        const before = await systemStatus();

        const start = await requestJson(BASE, 'POST', '/api/simulate/start', {
            clients: 6,
            txs_per_client: 3,
            delay_ms: 0,
            amount: 0.01,
            mix: 'transfer',
            continuous: false
        });
        assert.equal(start.statusCode, 200);
        assert.equal(start.body.config.continuous, false);

        await waitFor(async () => {
            const st = await simStatus();
            return !st.running;
        }, { timeoutMs: 60000, label: 'batch complete' });

        const st = await simStatus();
        assert.ok(st.stats.transfers_ok + st.stats.transactions_failed >= 1);
        assert.equal(st.stats.clients_finished, 6);

        const after = await systemStatus();
        assert.ok((after.queue.total_processed + after.queue.total_failed) >=
            (before.queue.total_processed + before.queue.total_failed));
        assert.equal(after.simulator.running, false);
        assert.ok(after.simulator.finished_at);
    });

    it('Admin-facing status remains coherent while idle after load', async () => {
        await ensureIdleSimulator();
        await sleep(500);
        const body = await systemStatus();
        assert.equal(body.simulator.running, false);
        assert.equal(body.queue.active_workers, 0);
        assert.equal(body.queue.depth, 0);
        // recent may still be >0 briefly; after sleep should be 0
        assert.ok((body.queue.recent_active_workers || 0) <= body.queue.concurrency);
        assert.equal(typeof body.bind_host, 'string');
    });
});
