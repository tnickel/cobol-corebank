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
const toastContainer = document.getElementById('toastContainer');
const activityFeed = document.getElementById('activityFeed');
const clientGrid = document.getElementById('clientGrid');
const simNowBanner = document.getElementById('simNowBanner');
const simStage = document.getElementById('simStage');
const simLivePill = document.getElementById('simLivePill');

let selectedMix = 'mixed';
let pollTimer = null;
let wasRunning = false;
let lastEventTs = null;
let knownEventKeys = new Set();

function showToast(message, type = 'success') {
    if (!toastContainer) return;
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.innerHTML = `<span class="toast-text">${message}</span>`;
    toastContainer.appendChild(toast);
    setTimeout(() => toast.remove(), 3500);
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
    simStage?.classList.toggle('is-running', running);
    simLivePill?.classList.toggle('is-hot', running);
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

function formatTime(iso) {
    try {
        return new Date(iso).toLocaleTimeString('de-DE', {
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit'
        });
    } catch {
        return '--:--:--';
    }
}

function renderActivityFeed(events) {
    if (!activityFeed) return;
    if (!events || !events.length) {
        activityFeed.innerHTML = '<div class="sim-activity-empty">Noch keine Aktivität — Simulation starten.</div>';
        document.getElementById('activityCount').textContent = '0 Events';
        return;
    }

    document.getElementById('activityCount').textContent = `${events.length} Events`;

    // Detect new leading event for pulse
    const newest = events[0];
    const key = `${newest.ts}|${newest.message}`;
    let pulse = false;
    if (lastEventTs && key !== lastEventTs && !knownEventKeys.has(key)) {
        pulse = newest.level === 'ok' || newest.action === 'TRANSFER' || newest.action === 'DEPOSIT';
    }
    lastEventTs = key;
    knownEventKeys.add(key);
    if (knownEventKeys.size > 200) {
        knownEventKeys = new Set([...knownEventKeys].slice(-100));
    }

    activityFeed.innerHTML = events.slice(0, 35).map((e) => `
        <div class="sim-event ${e.level || 'info'}">
            <span class="t">${formatTime(e.ts)}</span>
            <span class="a">${e.action || 'EVT'}</span>
            <span class="m">${escapeHtml(e.message || '')}</span>
        </div>
    `).join('');

    return pulse;
}

function escapeHtml(str) {
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

function renderClientGrid(clients) {
    if (!clientGrid) return;
    const hint = document.getElementById('clientsHint');
    if (!clients || !clients.length) {
        clientGrid.innerHTML = '';
        if (hint) hint.textContent = 'Warte auf Start…';
        return;
    }
    if (hint) {
        const running = clients.filter((c) => c.status === 'running').length;
        hint.textContent = `${running} aktiv · ${clients.length} gesamt`;
    }

    // Cap DOM cards for performance when many clients
    const show = clients.length > 60 ? clients.filter((c) => c.status === 'running').concat(
        clients.filter((c) => c.status !== 'running').slice(0, 40)
    ).slice(0, 60) : clients;

    clientGrid.innerHTML = show.map((c) => {
        const pct = c.total > 0 ? Math.round((c.step / c.total) * 100) : 0;
        return `
            <div class="sim-client-card is-${c.status || 'idle'}">
                <div class="sim-client-top">
                    <span class="sim-client-id">sim:${c.id}</span>
                    <span class="sim-client-action ${c.action || ''}">${c.action || 'IDLE'}</span>
                </div>
                <div class="sim-client-detail">${escapeHtml(c.detail || '—')}</div>
                <div class="sim-client-meta">
                    <span>${c.step || 0}/${c.total || 0}</span>
                    <span>OK ${c.ok || 0} · Err ${c.fail || 0}</span>
                </div>
                <div class="sim-client-bar"><i style="width:${pct}%"></i></div>
            </div>
        `;
    }).join('');
}

function updateNowBanner(status) {
    if (!simNowBanner) return;
    const clients = status.clients || [];
    const active = clients.filter((c) => c.status === 'running' && c.action && c.action !== 'WAIT' && c.action !== 'DONE');
    if (!status.running) {
        if (wasRunning || status.finished_at) {
            simNowBanner.textContent = 'Simulation beendet — Details im Event-Feed';
        } else {
            simNowBanner.textContent = 'Bereit — Szenario konfigurieren und starten';
        }
        return;
    }
    if (!active.length) {
        simNowBanner.textContent = 'Clients starten / warten…';
        return;
    }
    const sample = active[0];
    const more = active.length > 1 ? ` · +${active.length - 1} weitere aktiv` : '';
    simNowBanner.textContent = `sim:${sample.id} → ${sample.action}: ${sample.detail || ''}${more}`;
}

function updateMixBars(s) {
    const total = Math.max(1, (s.transfers_ok || 0) + (s.deposits_ok || 0) + (s.reads_ok || 0));
    const tPct = Math.round(((s.transfers_ok || 0) / total) * 100);
    const dPct = Math.round(((s.deposits_ok || 0) / total) * 100);
    const rPct = Math.round(((s.reads_ok || 0) / total) * 100);
    const set = (fillId, pctId, pct) => {
        const f = document.getElementById(fillId);
        const p = document.getElementById(pctId);
        if (f) f.style.width = `${pct}%`;
        if (p) p.textContent = `${pct}%`;
    };
    set('mixTransferFill', 'mixTransferPct', tPct);
    set('mixDepositFill', 'mixDepositPct', dPct);
    set('mixReadFill', 'mixReadPct', rPct);
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

    const sparkLabel = document.getElementById('sparkTpsLabel');
    if (sparkLabel) sparkLabel.textContent = `${Number(s.tps || 0).toFixed(1)} TPS`;

    updateMixBars(s);
    updateNowBanner(status);
    const pulse = renderActivityFeed(status.recent_events || []);
    renderClientGrid(status.clients || []);

    if (window.SimViz) {
        SimViz.update({
            running: status.running,
            clients: status.clients || [],
            tps: Number(s.tps || 0),
            pulse: !!pulse
        });
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
                showToast(
                    `Fertig: ${s.transactions_ok} OK / ${s.transactions_failed} Fehler`,
                    s.transactions_failed ? 'error' : 'success'
                );
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
    pollTimer = setInterval(pollStatus, 280);
    pollStatus();
}

simForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    knownEventKeys.clear();
    lastEventTs = null;
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
        simNowBanner.textContent = `Starte ${body.clients} Clients…`;
        showToast('Simulation gestartet');
        startPolling();
    } catch (err) {
        showToast('Verbindung zum Backend fehlgeschlagen', 'error');
    }
});

btnStop.addEventListener('click', async () => {
    try {
        btnStop.disabled = true;
        simNowBanner.textContent = 'Stop angefordert…';
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

document.addEventListener('DOMContentLoaded', () => {
    if (window.SimViz) SimViz.init();
    pollStatus();
});
