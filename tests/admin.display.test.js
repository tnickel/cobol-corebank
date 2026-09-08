'use strict';

/**
 * Lightweight contract checks for shapes the Admin / Simulator UIs render.
 */

const { describe, it, before } = require('node:test');
const assert = require('node:assert/strict');
const { requestJson } = require('./lib/http');

const BASE = process.env.TEST_BASE_URL || 'http://127.0.0.1:3000';

describe('Admin display contract (system-status)', () => {
    let body;

    before(async () => {
        const res = await requestJson(BASE, 'GET', '/api/system-status');
        if (res.statusCode !== 200) {
            throw new Error(`Server nicht erreichbar: ${BASE}`);
        }
        body = res.body;
    });

    it('KPI worker pool fields are numbers Admin can format as "N / concurrency"', () => {
        const q = body.queue;
        assert.ok(Number.isFinite(q.active_workers));
        assert.ok(Number.isFinite(q.recent_active_workers));
        assert.ok(Number.isFinite(q.peak_active_workers));
        assert.ok(Number.isFinite(q.concurrency));
        assert.ok(q.active_workers <= q.concurrency);
        assert.ok(q.recent_active_workers <= q.concurrency);
    });

    it('live telemetry fields used by load-viz exist', () => {
        const live = body.live;
        for (const key of [
            'clients_active',
            'http_requests_active',
            'http_requests_peak',
            'transactions_per_sec',
            'tcp_connections',
            'connections_active'
        ]) {
            assert.equal(typeof live[key], 'number', `live.${key}`);
        }
    });

    it('simulator block is embeddable in Admin without undefined crashes', () => {
        const sim = body.simulator;
        assert.equal(typeof sim.running, 'boolean');
        assert.ok(sim.stats);
        assert.equal(typeof sim.stats.transactions_ok, 'number');
        assert.equal(typeof sim.stats.write_ok === 'number' || sim.stats.write_ok == null, true);
        assert.ok(Array.isArray(sim.clients));
        assert.ok(Array.isArray(sim.recent_events));
    });

    it('database string does not leak credentials', () => {
        assert.ok(body.database);
        assert.doesNotMatch(String(body.database), /cobol\.cobol|password|=[^/@]+@/i);
    });
});
