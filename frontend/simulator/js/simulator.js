const API = window.location.origin;

const cfgClients = document.getElementById('cfgClients');
const cfgTxs = document.getElementById('cfgTxs');
const cfgDelay = document.getElementById('cfgDelay');
const cfgAmount = document.getElementById('cfgAmount');
const cfgClientsLabel = document.getElementById('cfgClientsLabel');
const cfgTxsLabel = document.getElementById('cfgTxsLabel');
const cfgDelayLabel = document.getElementById('cfgDelayLabel');
const cfgTotalLabel = document.getElementById('cfgTotalLabel');
const simForm = document.getElementById('simForm');
const btnStart = document.getElementById('btnStart');
const btnStop = document.getElementById('btnStop');
const simLog = document.getElementById('simLog');
const toastContainer = document.getElementById('toastContainer');

let selectedMix = 'mixed';
let pollTimer = null;
let wasRunning = false;

function showToast(message, type = 'success') {
    if (!toastContainer) return;
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.innerHTML = `<span class="toast-text">${message}</span>`;
    toastContainer.appendChild(toast);
    setTimeout(() => toast.remove(), 3500);
}

function logLine(msg) {
    const ts = new Date().toLocaleTimeString('de-DE');
    const line = `[${ts}] ${msg}`;
    if (simLog.textContent.startsWith('Bereit.')) {
        simLog.textContent = line;
    } else {
        simLog.textContent = `${simLog.textContent}\n${line}`;
    }
    simLog.scrollTop = simLog.scrollHeight;
}

function syncLabels() {
    const clients = Number(cfgClients.value);
    const txs = Number(cfgTxs.value);
    cfgClientsLabel.textContent = String(clients);
    cfgTxsLabel.textContent = String(txs);
    cfgDelayLabel.textContent = `${cfgDelay.value} ms`;
    cfgTotalLabel.textContent = String(clients * txs);
}

cfgClients.addEventListener('input', syncLabels);
cfgTxs.addEventListener('input', syncLabels);
cfgDelay.addEventListener('input', syncLabels);
syncLabels();

document.getElementById('cfgMix').addEventListener('click', (e) => {
    const btn = e.target.closest('.sim-mix-btn');
    if (!btn) return;
    document.querySelectorAll('.sim-mix-btn').forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');
    selectedMix = btn.dataset.mix;
});

document.querySelectorAll('[data-preset]').forEach((btn) => {
    btn.addEventListener('click', () => {
        const presets = {
            light: { clients: 10, txs: 5, delay: 0 },
            medium: { clients: 25, txs: 10, delay: 0 },
            heavy: { clients: 50, txs: 20, delay: 0 },
            burst: { clients: 100, txs: 5, delay: 0 }
        };
        const p = presets[btn.dataset.preset];
        if (!p) return;
        cfgClients.value = p.clients;
        cfgTxs.value = p.txs;
        cfgDelay.value = p.delay;
        syncLabels();
        showToast(`Preset „${btn.textContent.trim()}“ geladen`);
    });
});

function setRunningUi(running, done = false) {
    btnStart.disabled = running;
    btnStop.disabled = !running;
    const badge = document.getElementById('simRunBadge');
    const text = document.getElementById('simRunText');
    const monitorBadge = document.getElementById('monitorBadge');
    badge.classList.toggle('is-running', running);
    badge.classList.toggle('is-done', !running && done);
    if (running) {
        text.textContent = 'Simulation läuft';
        monitorBadge.textContent = 'Running';
    } else if (done) {
        text.textContent = 'Abgeschlossen';
        monitorBadge.textContent = 'Done';
    } else {
        text.textContent = 'Bereit';
        monitorBadge.textContent = 'Idle';
    }
}

function renderStatus(status) {
    const s = status.stats || {};
    const cfg = status.config || {};
    const totalPlanned = (cfg.clients || 0) * (cfg.txs_per_client || 0);
    const doneTx = (s.transactions_ok || 0) + (s.transactions_failed || 0);
    const pct = totalPlanned > 0 ? Math.min(100, Math.round((doneTx / totalPlanned) * 100)) : 0;

    document.getElementById('statClientsActive').textContent = s.clients_active ?? 0;
    document.getElementById('statOk').textContent = s.transactions_ok ?? 0;
    document.getElementById('statFail').textContent = s.transactions_failed ?? 0;
    document.getElementById('statTps').textContent = Number(s.tps || 0).toFixed(1);
    document.getElementById('statElapsed').textContent = `${((s.elapsed_ms || 0) / 1000).toFixed(1)}s`;
    document.getElementById('progressPct').textContent = `${pct}%`;
    document.getElementById('progressFill').style.width = `${pct}%`;
    document.getElementById('brkTransfers').textContent = s.transfers_ok ?? 0;
    document.getElementById('brkDeposits').textContent = s.deposits_ok ?? 0;
    document.getElementById('brkReads').textContent = s.reads_ok ?? 0;
    document.getElementById('brkFinished').textContent =
        `${s.clients_finished ?? 0} / ${cfg.clients || s.clients_configured || 0}`;

    if (s.last_error && status.running) {
        // keep last error visible in log occasionally via polling diff would be noisy; skip
    }
}

async function pollStatus() {
    try {
        const res = await fetch(`${API}/api/simulate/status`);
        const status = await res.json();
        renderStatus(status);

        if (status.running) {
            wasRunning = true;
            setRunningUi(true);
        } else {
            setRunningUi(false, wasRunning);
            if (wasRunning) {
                wasRunning = false;
                const s = status.stats || {};
                logLine(
                    `Fertig — OK ${s.transactions_ok}, Fehler ${s.transactions_failed}, ` +
                    `TPS ${s.tps}, Dauer ${(s.elapsed_ms / 1000).toFixed(1)}s` +
                    (s.last_error ? ` | Letzter Fehler: ${s.last_error}` : '')
                );
                showToast('Simulation abgeschlossen', s.transactions_failed ? 'error' : 'success');
            }
            if (pollTimer) {
                clearInterval(pollTimer);
                pollTimer = null;
            }
        }
    } catch (err) {
        console.error(err);
    }
}

function startPolling() {
    if (pollTimer) clearInterval(pollTimer);
    pollTimer = setInterval(pollStatus, 400);
    pollStatus();
}

simForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const body = {
        clients: Number(cfgClients.value),
        txs_per_client: Number(cfgTxs.value),
        delay_ms: Number(cfgDelay.value),
        amount: Number(cfgAmount.value) || 0.01,
        mix: selectedMix
    };

    try {
        const res = await fetch(`${API}/api/simulate/start`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        });
        const result = await res.json();
        if (!result.ok) {
            showToast(result.error || 'Start fehlgeschlagen', 'error');
            return;
        }
        wasRunning = true;
        setRunningUi(true);
        logLine(
            `Start: ${body.clients} Clients × ${body.txs_per_client} Tx ` +
            `(Mix=${body.mix}, Betrag=${body.amount}, Delay=${body.delay_ms}ms)`
        );
        showToast('Simulation gestartet');
        startPolling();
    } catch (err) {
        showToast('Verbindung zum Backend fehlgeschlagen', 'error');
    }
});

btnStop.addEventListener('click', async () => {
    try {
        btnStop.disabled = true;
        logLine('Stop angefordert…');
        const res = await fetch(`${API}/api/simulate/stop`, { method: 'POST' });
        const result = await res.json();
        if (!result.ok) {
            showToast(result.error || 'Stop fehlgeschlagen', 'error');
            btnStop.disabled = false;
            return;
        }
        showToast('Simulation gestoppt');
        pollStatus();
    } catch (err) {
        showToast('Stop fehlgeschlagen', 'error');
        btnStop.disabled = false;
    }
});

// Initial status
pollStatus();
