const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { CustomerSimulator } = require('./simulator');

const PORT = process.env.PORT || 3000;
const PROJECT_ROOT = path.resolve(__dirname, '..');
const COBOL_EXE = path.join(PROJECT_ROOT, 'bin', 'cobol_bank.exe');
const FRONTEND_DIR = path.join(PROJECT_ROOT, 'frontend');

/** Parallel COBOL workers — PostgreSQL MVCC + row locks handle contention */
const TX_CONCURRENCY = Math.max(1, parseInt(process.env.TX_CONCURRENCY || '16', 10));
const customerSimulator = new CustomerSimulator(PORT);

const GNUCOBOL_BASE = "C:\\Users\\tnickel\\AppData\\Local\\Programs\\GnuCOBOL 3.2";
const customEnv = {
    ...process.env,
    PATH: `${path.join(GNUCOBOL_BASE, 'bin')};${path.join(GNUCOBOL_BASE, 'mingw64', 'bin')};${process.env.PATH || ''}`,
    COB_CONFIG_DIR: path.join(GNUCOBOL_BASE, 'config'),
    COB_COPY_DIR: path.join(GNUCOBOL_BASE, 'copy'),
    COB_CFLAGS: `-I "${path.join(GNUCOBOL_BASE, 'include')}"`,
    COB_LDFLAGS: `-L "${path.join(GNUCOBOL_BASE, 'lib')}"`
};

let lastExecutionInfo = {
    command: 'INIT',
    args: [],
    stdout: 'System startup',
    stderr: '',
    durationMs: 0,
    timestamp: new Date().toISOString()
};

/**
 * Bounded worker pool for COBOL processes.
 * With PostgreSQL, writes can run truly in parallel; row-level locks
 * (SELECT ... FOR UPDATE) in COBOL keep account balances consistent.
 */
class BankTransactionQueue {
    constructor(concurrency = 16) {
        this.concurrency = concurrency;
        this.queue = [];
        this.running = 0;
        this.totalProcessed = 0;
        this.totalFailed = 0;
        this.latencies = [];
        this.maxLatenciesHistory = 200;
        this.peakQueueDepth = 0;
    }

    get depth() {
        return this.queue.length;
    }

    get active() {
        return this.running;
    }

    get avgLatencyMs() {
        if (this.latencies.length === 0) return 0;
        const sum = this.latencies.reduce((a, b) => a + b, 0);
        return Math.round((sum / this.latencies.length) * 10) / 10;
    }

    enqueue(taskFn, meta = {}) {
        return new Promise((resolve, reject) => {
            this.queue.push({
                taskFn,
                meta,
                enqueuedAt: Date.now(),
                resolve,
                reject
            });
            if (this.queue.length > this.peakQueueDepth) {
                this.peakQueueDepth = this.queue.length;
            }
            this._processNext();
        });
    }

    async _processNext() {
        if (this.running >= this.concurrency || this.queue.length === 0) {
            return;
        }

        this.running++;
        const item = this.queue.shift();
        const start = Date.now();

        try {
            let result = null;
            let retries = 3;
            while (retries > 0) {
                result = await item.taskFn();
                const isBusy = result && result.data && (
                    (result.data.status === 'error' && /deadlock|could not serialize|lock timeout|busy/i.test(result.data.message || '')) ||
                    (result.data.raw && /deadlock|could not serialize|lock timeout|busy/i.test(result.data.raw))
                );

                if (isBusy && retries > 1) {
                    retries--;
                    await new Promise(r => setTimeout(r, 40 * (4 - retries)));
                    continue;
                }
                break;
            }

            const latency = Date.now() - start;
            this.latencies.push(latency);
            if (this.latencies.length > this.maxLatenciesHistory) {
                this.latencies.shift();
            }

            if (result && result.success) {
                this.totalProcessed++;
            } else {
                this.totalFailed++;
            }

            item.resolve(result);
        } catch (err) {
            this.totalFailed++;
            item.reject(err);
        } finally {
            this.running--;
            this._processNext();
        }
    }
}

const txQueue = new BankTransactionQueue(TX_CONCURRENCY);

/**
 * Live admin telemetry: clients, connections, transactions/sec
 */
class LiveMetrics {
    constructor() {
        this.clients = new Map();
        this.txTimestamps = [];
        this.activeHttpRequests = 0;
        this.peakHttpRequests = 0;
        this.clientTtlMs = 45000;
        this.tpsWindowMs = 5000;
    }

    clientKey(req) {
        const simId = req.headers['x-sim-client-id'];
        if (simId) return `sim:${simId}`;
        const ip = req.socket?.remoteAddress || req.headers['x-forwarded-for'] || 'unknown';
        return String(ip).replace(/^::ffff:/, '');
    }

    touchClient(req) {
        this.clients.set(this.clientKey(req), Date.now());
    }

    beginHttp() {
        this.activeHttpRequests++;
        if (this.activeHttpRequests > this.peakHttpRequests) {
            this.peakHttpRequests = this.activeHttpRequests;
        }
    }

    endHttp() {
        this.activeHttpRequests = Math.max(0, this.activeHttpRequests - 1);
    }

    recordTransaction() {
        const now = Date.now();
        this.txTimestamps.push(now);
        this._prune(now);
    }

    _prune(now = Date.now()) {
        const clientCutoff = now - this.clientTtlMs;
        for (const [key, seen] of this.clients) {
            if (seen < clientCutoff) this.clients.delete(key);
        }
        const txCutoff = now - this.tpsWindowMs;
        while (this.txTimestamps.length && this.txTimestamps[0] < txCutoff) {
            this.txTimestamps.shift();
        }
    }

    snapshot() {
        this._prune();
        const windowSec = this.tpsWindowMs / 1000;
        const tps = Math.round((this.txTimestamps.length / windowSec) * 10) / 10;
        return {
            clients_active: this.clients.size,
            clients_ttl_sec: this.clientTtlMs / 1000,
            http_requests_active: this.activeHttpRequests,
            http_requests_peak: this.peakHttpRequests,
            transactions_per_sec: tps,
            transactions_window_sec: windowSec,
            transactions_in_window: this.txTimestamps.length
        };
    }
}

const liveMetrics = new LiveMetrics();

function runCobol(args) {
    return new Promise((resolve) => {
        const start = Date.now();
        execFile(COBOL_EXE, args, { cwd: PROJECT_ROOT, env: customEnv }, (error, stdout, stderr) => {
            const durationMs = Date.now() - start;
            const cleanStdout = (stdout || '').trim();
            const cleanStderr = (stderr || '').trim();

            lastExecutionInfo = {
                command: args[0] || 'NONE',
                args: args,
                stdout: cleanStdout,
                stderr: cleanStderr,
                durationMs: durationMs,
                timestamp: new Date().toISOString()
            };

            let parsedJson = null;
            try {
                const jsonMatch = cleanStdout.match(/\{[\s\S]*\}/);
                if (jsonMatch) {
                    parsedJson = JSON.parse(jsonMatch[0]);
                }
            } catch (e) {
                // Ignore parsing errors
            }

            const success = !error && parsedJson && parsedJson.status === 'ok';
            // Count completed COBOL jobs toward live TPS (skip bootstrap INIT spam later if needed)
            if (args[0] !== 'INIT') {
                liveMetrics.recordTransaction();
            }

            resolve({
                success,
                exitCode: error ? (error.code || 1) : 0,
                durationMs,
                data: parsedJson || { status: error ? 'error' : 'raw', raw: cleanStdout, stderr: cleanStderr }
            });
        });
    });
}

function readJsonBody(req) {
    return new Promise((resolve, reject) => {
        let body = '';
        req.on('data', chunk => { body += chunk; });
        req.on('end', () => {
            try {
                resolve(body ? JSON.parse(body) : {});
            } catch (err) {
                reject(err);
            }
        });
        req.on('error', reject);
    });
}

const MIME_TYPES = {
    '.html': 'text/html; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.js': 'application/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.svg': 'image/svg+xml',
    '.png': 'image/png',
    '.ico': 'image/x-icon'
};

function serveStatic(req, res, pathname) {
    let rel = pathname;
    if (rel === '/simulator' || rel === '/simulator/') {
        rel = '/simulator/index.html';
    } else if (rel === '/') {
        rel = '/index.html';
    }

    rel = rel.replace(/^\/+/, '').replace(/\//g, path.sep);
    let filePath = path.join(FRONTEND_DIR, rel);
    filePath = path.normalize(filePath);

    if (!filePath.startsWith(FRONTEND_DIR)) {
        res.writeHead(403);
        res.end('Access Denied');
        return;
    }

    fs.stat(filePath, (err, stats) => {
        if (err || !stats.isFile()) {
            res.writeHead(404, { 'Content-Type': 'text/plain' });
            res.end('404 Not Found');
            return;
        }

        const ext = path.extname(filePath).toLowerCase();
        const contentType = MIME_TYPES[ext] || 'application/octet-stream';
        res.writeHead(200, { 'Content-Type': contentType });
        fs.createReadStream(filePath).pipe(res);
    });
}

const server = http.createServer(async (req, res) => {
    liveMetrics.touchClient(req);
    liveMetrics.beginHttp();
    let httpCounted = true;
    const releaseHttp = () => {
        if (!httpCounted) return;
        httpCounted = false;
        liveMetrics.endHttp();
    };
    res.on('finish', releaseHttp);
    res.on('close', releaseHttp);

    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
        res.writeHead(204);
        res.end();
        return;
    }

    const url = new URL(req.url, `http://${req.headers.host}`);
    const pathname = url.pathname;

    if (pathname.startsWith('/api/')) {
        res.setHeader('Content-Type', 'application/json; charset=utf-8');

        try {
            if (pathname === '/api/accounts' && req.method === 'GET') {
                const result = await runCobol(['LIST_ACCOUNTS']);
                res.writeHead(200);
                res.end(JSON.stringify(result));
                return;
            }

            if (pathname === '/api/transactions' && req.method === 'GET') {
                const result = await runCobol(['LIST_TRANSACTIONS']);
                res.writeHead(200);
                res.end(JSON.stringify(result));
                return;
            }

            if (pathname === '/api/transfer' && req.method === 'POST') {
                const body = await readJsonBody(req);
                const { from_account, to_account, amount, description } = body;
                if (!from_account || !to_account || !amount) {
                    res.writeHead(400);
                    res.end(JSON.stringify({ error: 'Missing required parameters' }));
                    return;
                }
                const cleanDesc = (description || 'Ueberweisung').replace(/["\r\n]/g, ' ');
                const result = await txQueue.enqueue(
                    () => runCobol(['TRANSFER', from_account, to_account, String(amount), cleanDesc]),
                    { type: 'TRANSFER', from: from_account, to: to_account, amount }
                );
                res.writeHead(200);
                res.end(JSON.stringify(result));
                return;
            }

            if (pathname === '/api/deposit' && req.method === 'POST') {
                const body = await readJsonBody(req);
                const { to_account, amount, description } = body;
                if (!to_account || !amount) {
                    res.writeHead(400);
                    res.end(JSON.stringify({ error: 'Missing to_account or amount' }));
                    return;
                }
                const cleanDesc = (description || 'Bareinzahlung').replace(/["\r\n]/g, ' ');
                const result = await txQueue.enqueue(
                    () => runCobol(['DEPOSIT', to_account, String(amount), cleanDesc]),
                    { type: 'DEPOSIT', to: to_account, amount }
                );
                res.writeHead(200);
                res.end(JSON.stringify(result));
                return;
            }

            if (pathname === '/api/accounts' && req.method === 'POST') {
                const body = await readJsonBody(req);
                const { account_no, holder_name, account_type, initial_balance, interest_rate } = body;
                if (!account_no || !holder_name) {
                    res.writeHead(400);
                    res.end(JSON.stringify({ error: 'Missing account_no or holder_name' }));
                    return;
                }
                const cleanAccNo = account_no.trim();
                const cleanHolder = holder_name.trim().replace(/["\r\n]/g, ' ');
                const cleanType = (account_type || 'GIRO').trim();
                const cleanBal = String(initial_balance || 0);
                const cleanRate = String(interest_rate || 0);

                const result = await txQueue.enqueue(
                    () => runCobol(['CREATE_ACCOUNT', cleanAccNo, cleanHolder, cleanType, cleanBal, cleanRate]),
                    { type: 'CREATE_ACCOUNT', account_no: cleanAccNo }
                );
                res.writeHead(200);
                res.end(JSON.stringify(result));
                return;
            }

            if (pathname === '/api/calc-interest' && req.method === 'POST') {
                const result = await txQueue.enqueue(
                    () => runCobol(['CALC_INTEREST']),
                    { type: 'CALC_INTEREST' }
                );
                res.writeHead(200);
                res.end(JSON.stringify(result));
                return;
            }

            if (pathname === '/api/stress-test' && req.method === 'POST') {
                const body = await readJsonBody(req);
                const count = Math.min(Math.max(parseInt(body.count) || 100, 1), 200);
                const testType = body.type === 'READ' ? 'READ' : 'TRANSFER';

                const startTime = Date.now();
                const promises = [];

                if (testType === 'TRANSFER') {
                    const accRes = await runCobol(['LIST_ACCOUNTS']);
                    const accounts = (accRes.data && accRes.data.accounts) || [];
                    if (accounts.length < 2) {
                        res.writeHead(400);
                        res.end(JSON.stringify({ error: 'Not enough accounts for transfer test' }));
                        return;
                    }
                    const src = accounts[0].account_no;
                    const dst = accounts[1].account_no;

                    for (let i = 0; i < count; i++) {
                        const from = i % 2 === 0 ? src : dst;
                        const to = i % 2 === 0 ? dst : src;
                        promises.push(
                            txQueue.enqueue(
                                () => runCobol(['TRANSFER', from, to, '0.01', `StressTest #${i + 1}`]),
                                { type: 'TRANSFER', stressIndex: i }
                            ).then(r => ({ ok: r.success, data: r.data }))
                             .catch(e => ({ ok: false, error: e.message }))
                        );
                    }
                } else {
                    for (let i = 0; i < count; i++) {
                        promises.push(
                            runCobol(['LIST_ACCOUNTS'])
                                .then(r => ({ ok: r.success, data: r.data }))
                                .catch(e => ({ ok: false, error: e.message }))
                        );
                    }
                }

                const results = await Promise.all(promises);
                const totalElapsedMs = Date.now() - startTime;
                const successes = results.filter(r => r.ok).length;
                const failures = results.filter(r => !r.ok);

                res.writeHead(200);
                res.end(JSON.stringify({
                    test_type: testType,
                    requested_count: count,
                    successes,
                    failures: failures.length,
                    total_elapsed_ms: totalElapsedMs,
                    avg_per_request_ms: Math.round((totalElapsedMs / count) * 10) / 10,
                    throughput_req_per_sec: Math.round((count / (totalElapsedMs / 1000)) * 10) / 10,
                    success_rate_percent: Math.round((successes / count) * 1000) / 10,
                    concurrency: TX_CONCURRENCY,
                    sample_failure: failures.length > 0 ? failures[0] : null
                }));
                return;
            }

            if (pathname === '/api/simulate/start' && req.method === 'POST') {
                const body = await readJsonBody(req);
                const result = await customerSimulator.start(body);
                res.writeHead(result.ok ? 200 : 409);
                res.end(JSON.stringify(result));
                return;
            }

            if (pathname === '/api/simulate/stop' && req.method === 'POST') {
                const result = await customerSimulator.stop();
                res.writeHead(result.ok ? 200 : 409);
                res.end(JSON.stringify(result));
                return;
            }

            if (pathname === '/api/simulate/status' && req.method === 'GET') {
                res.writeHead(200);
                res.end(JSON.stringify(customerSimulator.status()));
                return;
            }

            if (pathname === '/api/system-status' && req.method === 'GET') {
                const live = liveMetrics.snapshot();
                const tcpConnections = await new Promise((resolve) => {
                    server.getConnections((err, count) => {
                        resolve(err ? live.http_requests_active : count);
                    });
                });

                res.writeHead(200);
                res.end(JSON.stringify({
                    status: 'online',
                    cobol_compiler: 'GnuCOBOL 3.2+ (x86_64-pc-mingw64)',
                    sql_engine: 'GixSQL 1.0.20b with PostgreSQL',
                    journal_mode: 'MVCC',
                    concurrency_model: `PostgreSQL Parallel Workers (concurrency=${TX_CONCURRENCY}, atomic balance UPDATEs)`,
                    database: 'postgresql://cobol@127.0.0.1:5432/cobolbank',
                    database_size_bytes: null,
                    server_time: new Date().toISOString(),
                    live: {
                        ...live,
                        tcp_connections: tcpConnections,
                        connections_active: Math.max(tcpConnections, live.http_requests_active)
                    },
                    simulator: customerSimulator.status(),
                    queue: {
                        depth: txQueue.depth,
                        active_workers: txQueue.active,
                        concurrency: TX_CONCURRENCY,
                        total_processed: txQueue.totalProcessed,
                        total_failed: txQueue.totalFailed,
                        avg_latency_ms: txQueue.avgLatencyMs,
                        peak_depth: txQueue.peakQueueDepth
                    },
                    last_execution: lastExecutionInfo
                }));
                return;
            }

            if (pathname === '/api/last-execution' && req.method === 'GET') {
                res.writeHead(200);
                res.end(JSON.stringify(lastExecutionInfo));
                return;
            }

            res.writeHead(404);
            res.end(JSON.stringify({ error: 'Unknown API endpoint' }));
        } catch (err) {
            res.writeHead(500);
            res.end(JSON.stringify({ error: err.message }));
        }
        return;
    }

    serveStatic(req, res, pathname);
});

async function bootstrap() {
    console.log('Initializing PostgreSQL schema via COBOL INIT...');
    const res = await runCobol(['INIT']);
    console.log('COBOL INIT result:', res.data);
    if (!res.success) {
        console.error('WARNING: INIT failed — is PostgreSQL running on :5432?');
        console.error('  Run: powershell -File .\\scripts\\start_postgres.ps1');
    }
}

server.listen(PORT, async () => {
    console.log(`=======================================================`);
    console.log(`  COBOL CoreBank Admin Interface on port ${PORT}`);
    console.log(`  Access UI at: http://localhost:${PORT}`);
    console.log(`  Engine: GnuCOBOL 3.2 + GixSQL + PostgreSQL`);
    console.log(`  Concurrency: ${TX_CONCURRENCY} parallel COBOL workers`);
    console.log(`=======================================================`);
    await bootstrap();
});
