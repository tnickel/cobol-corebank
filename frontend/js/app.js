/**
 * COBOL CoreBank - Admin Interface
 */

const API_BASE = window.location.origin;

// State
let accounts = [];
let transactions = [];
let systemStatus = {};
let currentAccountFilter = 'ALL';
let currentTxFilter = 'ALL';
let searchQuery = '';

// DOM Elements
const kpiTotalLiquidity = document.getElementById('kpiTotalLiquidity');
const kpiAccountCount = document.getElementById('kpiAccountCount');
const kpiGiroCount = document.getElementById('kpiGiroCount');
const kpiSparCount = document.getElementById('kpiSparCount');
const kpiBizCount = document.getElementById('kpiBizCount');
const kpiTransactionCount = document.getElementById('kpiTransactionCount');
const kpiDbSize = document.getElementById('kpiDbSize');
const kpiClientsActive = document.getElementById('kpiClientsActive');
const kpiConnectionsActive = document.getElementById('kpiConnectionsActive');
const kpiHttpInFlight = document.getElementById('kpiHttpInFlight');
const kpiTxPerSec = document.getElementById('kpiTxPerSec');
const accountsCounter = document.getElementById('accountsCounter');
const txCounter = document.getElementById('txCounter');
const accountsGrid = document.getElementById('accountsGrid');
const transactionsBody = document.getElementById('transactionsBody');
const accountSearch = document.getElementById('accountSearch');
const accountTypeFilter = document.getElementById('accountTypeFilter');
const txTypeFilter = document.getElementById('txTypeFilter');

// Inspector DOM
const inspectorDuration = document.getElementById('inspectorDuration');
const inspectorCommand = document.getElementById('inspectorCommand');
const inspectorTime = document.getElementById('inspectorTime');
const inspectorStdout = document.getElementById('inspectorStdout');
const engineLatency = document.getElementById('engineLatency');

// Queue & Concurrency DOM
const kpiQueueDepth = document.getElementById('kpiQueueDepth');
const kpiProcessedCount = document.getElementById('kpiProcessedCount');
const kpiPeakDepth = document.getElementById('kpiPeakDepth');
const kpiJournalModeTag = document.getElementById('kpiJournalModeTag');
const queueDepthVal = document.getElementById('queueDepthVal');
const queueActiveVal = document.getElementById('queueActiveVal');
const queueProcessedVal = document.getElementById('queueProcessedVal');
const queueFailedVal = document.getElementById('queueFailedVal');
const queueLatencyVal = document.getElementById('queueLatencyVal');
const queuePeakVal = document.getElementById('queuePeakVal');
const liveClientsVal = document.getElementById('liveClientsVal');
const liveConnectionsVal = document.getElementById('liveConnectionsVal');
const liveTpsVal = document.getElementById('liveTpsVal');
const liveHttpVal = document.getElementById('liveHttpVal');
const liveHttpPeakVal = document.getElementById('liveHttpPeakVal');
const btnStressTransfers = document.getElementById('btnStressTransfers');
const btnStressReads = document.getElementById('btnStressReads');
const stressProgress = document.getElementById('stressProgress');
const stressProgressFill = document.getElementById('stressProgressFill');
const stressStatusText = document.getElementById('stressStatusText');
const stressResultsBox = document.getElementById('stressResultsBox');

// Quick Transfer DOM
const quickTransferForm = document.getElementById('quickTransferForm');
const qtFromAccount = document.getElementById('qtFromAccount');
const qtToAccount = document.getElementById('qtToAccount');
const qtAmount = document.getElementById('qtAmount');
const qtDescription = document.getElementById('qtDescription');
const qtFromBalanceHint = document.getElementById('qtFromBalanceHint');
const btnExecuteTransfer = document.getElementById('btnExecuteTransfer');

// Modals
const newAccountModal = document.getElementById('newAccountModal');
const depositModal = document.getElementById('depositModal');
const newAccountForm = document.getElementById('newAccountForm');
const depositForm = document.getElementById('depositForm');
const depAccount = document.getElementById('depAccount');
const depAmount = document.getElementById('depAmount');
const depDescription = document.getElementById('depDescription');

/**
 * Format currency in EUR (German locale)
 */
function formatCurrency(amount) {
    return new Intl.NumberFormat('de-DE', {
        style: 'currency',
        currency: 'EUR'
    }).format(amount);
}

/**
 * Format timestamp
 */
function formatTimestamp(timestampStr) {
    if (!timestampStr) return '-';
    try {
        const d = new Date(timestampStr.replace(' ', 'T'));
        if (isNaN(d.getTime())) return timestampStr;
        return d.toLocaleDateString('de-DE', {
            day: '2-digit',
            month: '2-digit',
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
        });
    } catch (e) {
        return timestampStr;
    }
}

/**
 * Show toast notification
 */
function showToast(message, type = 'success') {
    const container = document.getElementById('toastContainer');
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    
    const icon = type === 'success' ? '✓' : '⚠';
    toast.innerHTML = `
        <span class="toast-icon font-bold">${icon}</span>
        <span class="toast-text">${message}</span>
    `;

    container.appendChild(toast);
    setTimeout(() => {
        toast.style.opacity = '0';
        toast.style.transform = 'translateX(50px)';
        toast.style.transition = 'all 0.3s ease';
        setTimeout(() => toast.remove(), 300);
    }, 4000);
}

/**
 * Update COBOL Inspector panel
 */
function updateInspector(durationMs, command, stdout) {
    if (inspectorDuration) inspectorDuration.textContent = `${durationMs} ms`;
    if (engineLatency) engineLatency.textContent = `${durationMs}ms`;
    if (inspectorCommand) inspectorCommand.textContent = command || 'CLI EXEC';
    if (inspectorTime) inspectorTime.textContent = new Date().toLocaleTimeString('de-DE');
    if (inspectorStdout) {
        try {
            // Pretty-print JSON if possible
            const parsed = typeof stdout === 'string' ? JSON.parse(stdout) : stdout;
            inspectorStdout.textContent = JSON.stringify(parsed, null, 2);
        } catch (e) {
            inspectorStdout.textContent = typeof stdout === 'string' ? stdout : JSON.stringify(stdout);
        }
    }
}

/**
 * Fetch System Status
 */
async function loadSystemStatus() {
    try {
        const res = await fetch(`${API_BASE}/api/system-status`);
        const data = await res.json();
        systemStatus = data;

        if (kpiDbSize) {
            kpiDbSize.textContent = data.journal_mode || 'MVCC';
        }
        if (kpiJournalModeTag) {
            kpiJournalModeTag.textContent = data.journal_mode || 'MVCC';
        }
        const badgeJournalMode = document.getElementById('badgeJournalMode');
        if (badgeJournalMode) {
            badgeJournalMode.textContent = data.sql_engine
                ? 'PostgreSQL MVCC'
                : 'PostgreSQL';
        }

        if (data.live) {
            const live = data.live;
            if (kpiClientsActive) kpiClientsActive.textContent = live.clients_active ?? 0;
            if (kpiConnectionsActive) kpiConnectionsActive.textContent = live.connections_active ?? live.tcp_connections ?? 0;
            if (kpiHttpInFlight) kpiHttpInFlight.textContent = live.http_requests_active ?? 0;
            if (kpiTxPerSec) {
                const tps = Number(live.transactions_per_sec ?? 0);
                kpiTxPerSec.textContent = tps.toFixed(1);
                kpiTxPerSec.classList.toggle('kpi-value-hot', tps > 0);
            }
            if (liveClientsVal) liveClientsVal.textContent = live.clients_active ?? 0;
            if (liveConnectionsVal) liveConnectionsVal.textContent = live.connections_active ?? live.tcp_connections ?? 0;
            if (liveTpsVal) liveTpsVal.textContent = Number(live.transactions_per_sec ?? 0).toFixed(1);
            if (liveHttpVal) liveHttpVal.textContent = live.http_requests_active ?? 0;
            if (liveHttpPeakVal) liveHttpPeakVal.textContent = live.http_requests_peak ?? 0;
        }

        if (data.queue) {
            const q = data.queue;
            if (kpiQueueDepth) {
                kpiQueueDepth.textContent = `${q.active_workers || 0} aktiv`;
            }
            if (kpiProcessedCount) kpiProcessedCount.textContent = q.total_processed ?? 0;
            if (kpiPeakDepth) kpiPeakDepth.textContent = q.peak_depth ?? 0;
            if (queueDepthVal) queueDepthVal.textContent = q.depth ?? 0;
            if (queueActiveVal) queueActiveVal.textContent = q.active_workers ?? 0;
            if (queueProcessedVal) queueProcessedVal.textContent = q.total_processed ?? 0;
            if (queueFailedVal) queueFailedVal.textContent = q.total_failed ?? 0;
            if (queueLatencyVal) queueLatencyVal.textContent = `${q.avg_latency_ms ?? 0} ms`;
            if (queuePeakVal) queuePeakVal.textContent = q.peak_depth ?? 0;
        }

        if (data.last_execution) {
            updateInspector(
                data.last_execution.durationMs,
                data.last_execution.command,
                data.last_execution.stdout
            );
        }
    } catch (err) {
        console.error('Failed to load system status:', err);
    }
}

/**
 * Fetch Accounts from COBOL
 */
async function loadAccounts() {
    try {
        const res = await fetch(`${API_BASE}/api/accounts`);
        const result = await res.json();

        if (result.durationMs !== undefined) {
            updateInspector(result.durationMs, 'LIST_ACCOUNTS', result.data);
        }

        if (result.data && result.data.accounts) {
            accounts = result.data.accounts;
            renderKPIs(result.data);
            renderAccounts();
            populateSelectOptions();
        }
    } catch (err) {
        console.error('Error fetching accounts:', err);
        showToast('Fehler beim Abrufen der Kontodaten aus COBOL', 'error');
    }
}

/**
 * Fetch Transactions from COBOL
 */
async function loadTransactions() {
    try {
        const res = await fetch(`${API_BASE}/api/transactions`);
        const result = await res.json();

        if (result.data && result.data.transactions) {
            transactions = result.data.transactions;
            renderTransactions();
        }
    } catch (err) {
        console.error('Error fetching transactions:', err);
    }
}

/**
 * Render KPIs
 */
function renderKPIs(data) {
    if (kpiTotalLiquidity && data.total_liquidity !== undefined) {
        kpiTotalLiquidity.textContent = formatCurrency(data.total_liquidity);
    }
    if (kpiAccountCount && data.total_accounts !== undefined) {
        kpiAccountCount.textContent = data.total_accounts;
    }

    const giros = accounts.filter(a => a.account_type === 'GIRO').length;
    const spars = accounts.filter(a => a.account_type === 'SPARKONTO').length;
    const biz = accounts.filter(a => a.account_type === 'BUSINESS').length;

    if (kpiGiroCount) kpiGiroCount.textContent = giros;
    if (kpiSparCount) kpiSparCount.textContent = spars;
    if (kpiBizCount) kpiBizCount.textContent = biz;
}

/**
 * Render Account Cards
 */
function renderAccounts() {
    if (!accountsGrid) return;

    let filtered = accounts.filter(acc => {
        const matchType = currentAccountFilter === 'ALL' || acc.account_type === currentAccountFilter;
        const matchSearch = !searchQuery || 
            acc.holder_name.toLowerCase().includes(searchQuery.toLowerCase()) ||
            acc.account_no.toLowerCase().includes(searchQuery.toLowerCase());
        return matchType && matchSearch;
    });

    if (accountsCounter) {
        accountsCounter.textContent = `${filtered.length} von ${accounts.length} Konten`;
    }

    if (filtered.length === 0) {
        accountsGrid.innerHTML = `
            <div class="loading-placeholder">
                Keine Konten für die aktuelle Auswahl gefunden.
            </div>
        `;
        return;
    }

    accountsGrid.innerHTML = filtered.map(acc => {
        const typeClass = acc.account_type === 'SPARKONTO' ? 'badge-spar' :
                         acc.account_type === 'BUSINESS' ? 'badge-business' : 'badge-giro';
        const typeName = acc.account_type === 'SPARKONTO' ? 'Sparkonto' :
                         acc.account_type === 'BUSINESS' ? 'Geschäftskonto' : 'Girokonto';

        const interestInfo = acc.interest_rate > 0 
            ? `<span class="account-rate">★ ${acc.interest_rate.toFixed(2)}% Zinsen p.a.</span>`
            : `<span class="text-muted text-xs">Keine Verzinsung</span>`;

        return `
            <div class="account-card type-${acc.account_type}">
                <div class="account-card-header">
                    <div class="account-holder">${escapeHtml(acc.holder_name)}</div>
                    <span class="account-badge ${typeClass}">${typeName}</span>
                </div>
                
                <div class="account-iban-row">
                    <span>${acc.account_no}</span>
                    <button class="btn-copy-iban" onclick="copyIban('${acc.account_no}')" title="IBAN kopieren">
                        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2">
                            <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
                            <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
                        </svg>
                    </button>
                </div>

                <div class="account-balance-area">
                    <div class="balance-label">Aktueller Saldo</div>
                    <div class="balance-amount">${formatCurrency(acc.balance)}</div>
                </div>

                <div class="account-card-footer">
                    ${interestInfo}
                    <div class="account-actions">
                        <button class="btn btn-secondary btn-sm" onclick="openDepositFor('${acc.account_no}')">
                            + Einzahlen
                        </button>
                        <button class="btn btn-primary btn-sm" onclick="openTransferFrom('${acc.account_no}')">
                            Überweisen
                        </button>
                    </div>
                </div>
            </div>
        `;
    }).join('');
}

/**
 * Render Transaction Table
 */
function renderTransactions() {
    if (!transactionsBody) return;

    let filtered = transactions.filter(tx => {
        if (currentTxFilter === 'ALL') return true;
        return tx.tx_type === currentTxFilter;
    });

    if (txCounter) {
        txCounter.textContent = `${filtered.length} Buchungen`;
    }
    if (kpiTransactionCount) {
        kpiTransactionCount.textContent = transactions.length;
    }

    if (filtered.length === 0) {
        transactionsBody.innerHTML = `
            <tr>
                <td colspan="7" class="loading-placeholder">Keine Buchungsposten vorhanden</td>
            </tr>
        `;
        return;
    }

    transactionsBody.innerHTML = filtered.map(tx => {
        const isPositive = tx.tx_type === 'DEPOSIT' || tx.tx_type === 'INTEREST';
        const sign = isPositive ? '+' : '-';
        const amountClass = isPositive ? 'amount-positive' : 'amount-negative';

        const typeBadge = tx.tx_type === 'DEPOSIT' ? '<span class="tx-pill pill-deposit">Einzahlung</span>' :
                          tx.tx_type === 'INTEREST' ? '<span class="tx-pill pill-interest">Zinsgutschrift</span>' :
                          '<span class="tx-pill pill-transfer">Überweisung</span>';

        return `
            <tr>
                <td class="font-mono text-muted">#${tx.id}</td>
                <td>${formatTimestamp(tx.created_at)}</td>
                <td>${typeBadge}</td>
                <td class="font-mono text-xs">
                    <span class="text-muted">${tx.from_account}</span>
                    <span class="text-secondary mx-1">→</span>
                    <span class="font-semibold text-white">${tx.to_account}</span>
                </td>
                <td>${escapeHtml(tx.description || '-')}</td>
                <td class="text-right tx-amount ${amountClass}">${sign} ${formatCurrency(Math.abs(tx.amount))}</td>
                <td class="text-center">
                    <span class="status-pill status-success">GEBUCHT</span>
                </td>
            </tr>
        `;
    }).join('');
}

/**
 * Populate select dropdowns for transfers & deposits
 */
function populateSelectOptions() {
    const fromOptions = accounts.map(a => 
        `<option value="${a.account_no}">${escapeHtml(a.holder_name)} (${formatCurrency(a.balance)})</option>`
    ).join('');

    const toOptions = accounts.map(a => 
        `<option value="${a.account_no}">${escapeHtml(a.holder_name)} - ${a.account_no}</option>`
    ).join('');

    if (qtFromAccount) {
        const prev = qtFromAccount.value;
        qtFromAccount.innerHTML = `<option value="">Konto wählen...</option>` + fromOptions;
        if (prev) qtFromAccount.value = prev;
        updateFromBalanceHint();
    }

    if (qtToAccount) {
        const prev = qtToAccount.value;
        qtToAccount.innerHTML = `<option value="">Empfänger wählen...</option>` + toOptions;
        if (prev) qtToAccount.value = prev;
    }

    if (depAccount) {
        const prev = depAccount.value;
        depAccount.innerHTML = `<option value="">Konto auswählen...</option>` + toOptions;
        if (prev) depAccount.value = prev;
    }
}

/**
 * Update balance hint under transfer dropdown
 */
function updateFromBalanceHint() {
    if (!qtFromAccount || !qtFromBalanceHint) return;
    const selectedIban = qtFromAccount.value;
    const acc = accounts.find(a => a.account_no === selectedIban);
    if (acc) {
        qtFromBalanceHint.innerHTML = `Verfügbares Guthaben: <strong class="text-white">${formatCurrency(acc.balance)}</strong>`;
    } else {
        qtFromBalanceHint.textContent = 'Guthaben: -';
    }
}

/**
 * Handle Quick Transfer Submit
 */
if (quickTransferForm) {
    quickTransferForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const from = qtFromAccount.value;
        const to = qtToAccount.value;
        const amount = parseFloat(qtAmount.value);
        const desc = qtDescription.value || 'Überweisung';

        if (!from || !to || isNaN(amount) || amount <= 0) {
            showToast('Bitte gültige Konten und Betrag eingeben', 'error');
            return;
        }

        if (from === to) {
            showToast('Absender- und Empfängerkonto müssen unterschiedlich sein', 'error');
            return;
        }

        btnExecuteTransfer.disabled = true;
        const btnText = btnExecuteTransfer.querySelector('.btn-text');
        const spinner = btnExecuteTransfer.querySelector('.btn-spinner');
        if (btnText) btnText.textContent = 'COBOL bucht...';

        try {
            const res = await fetch(`${API_BASE}/api/transfer`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    from_account: from,
                    to_account: to,
                    amount: amount,
                    description: desc
                })
            });
            const result = await res.json();

            if (result.durationMs !== undefined) {
                updateInspector(result.durationMs, 'TRANSFER', result.data);
            }

            if (result.success || (result.data && result.data.status === 'ok')) {
                showToast(`Überweisung von ${formatCurrency(amount)} erfolgreich verbucht!`, 'success');
                qtAmount.value = '';
                qtDescription.value = '';
                await Promise.all([loadAccounts(), loadTransactions(), loadSystemStatus()]);
            } else {
                const msg = (result.data && result.data.message) || 'Buchungsfehler';
                showToast(`COBOL-Fehler: ${msg}`, 'error');
            }
        } catch (err) {
            console.error('Transfer failed:', err);
            showToast('Verbindungsfehler zur COBOL-Engine', 'error');
        } finally {
            btnExecuteTransfer.disabled = false;
            if (btnText) btnText.textContent = 'Admin-Überweisung ausführen';
        }
    });
}

/**
 * Handle Quick Amount Chips
 */
document.querySelectorAll('.quick-amount-chips .chip').forEach(chip => {
    chip.addEventListener('click', () => {
        const amt = chip.getAttribute('data-amt');
        if (qtAmount) qtAmount.value = amt;
    });
});

/**
 * Handle Deposit Modal Submit
 */
if (depositForm) {
    depositForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const to = depAccount.value;
        const amount = parseFloat(depAmount.value);
        const desc = depDescription.value || 'Bareinzahlung';

        if (!to || isNaN(amount) || amount <= 0) {
            showToast('Ungültige Eingabe', 'error');
            return;
        }

        try {
            const res = await fetch(`${API_BASE}/api/deposit`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    to_account: to,
                    amount: amount,
                    description: desc
                })
            });
            const result = await res.json();

            if (result.durationMs !== undefined) {
                updateInspector(result.durationMs, 'DEPOSIT', result.data);
            }

            if (result.success || (result.data && result.data.status === 'ok')) {
                showToast(`Einzahlung von ${formatCurrency(amount)} gutgeschrieben!`, 'success');
                closeModal(depositModal);
                depositForm.reset();
                await Promise.all([loadAccounts(), loadTransactions(), loadSystemStatus()]);
            } else {
                const msg = (result.data && result.data.message) || 'Einzahlungsfehler';
                showToast(`Fehler: ${msg}`, 'error');
            }
        } catch (err) {
            console.error('Deposit failed:', err);
            showToast('Netzwerkfehler', 'error');
        }
    });
}

/**
 * Handle New Account Form Submit
 */
if (newAccountForm) {
    newAccountForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const account_no = document.getElementById('naAccountNo').value.trim();
        const holder_name = document.getElementById('naHolderName').value.trim();
        const account_type = document.getElementById('naAccountType').value;
        const initial_balance = parseFloat(document.getElementById('naInitialDeposit').value) || 0;
        const interest_rate = parseFloat(document.getElementById('naInterestRate').value) || 0;

        if (!account_no || !holder_name) {
            showToast('IBAN und Inhaber erforderlich', 'error');
            return;
        }

        try {
            const res = await fetch(`${API_BASE}/api/accounts`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    account_no,
                    holder_name,
                    account_type,
                    initial_balance,
                    interest_rate
                })
            });
            const result = await res.json();

            if (result.durationMs !== undefined) {
                updateInspector(result.durationMs, 'CREATE_ACCOUNT', result.data);
            }

            if (result.success || (result.data && result.data.status === 'ok')) {
                showToast(`Konto für ${holder_name} erfolgreich angelegt!`, 'success');
                closeModal(newAccountModal);
                newAccountForm.reset();
                await Promise.all([loadAccounts(), loadTransactions(), loadSystemStatus()]);
            } else {
                const msg = (result.data && result.data.message) || 'Kontoerstellung fehlgeschlagen';
                showToast(`COBOL-Fehler: ${msg}`, 'error');
            }
        } catch (err) {
            console.error('Account creation failed:', err);
            showToast('Verbindungsfehler zur Engine', 'error');
        }
    });
}

/**
 * Batch Interest Calculation
 */
const btnBatchInterest = document.getElementById('btnBatchInterest');
if (btnBatchInterest) {
    btnBatchInterest.addEventListener('click', async () => {
        if (!confirm('Möchten Sie den monatlichen COBOL-Zinslauf für alle Sparkonten jetzt starten?')) {
            return;
        }

        btnBatchInterest.disabled = true;
        try {
            const res = await fetch(`${API_BASE}/api/calc-interest`, { method: 'POST' });
            const result = await res.json();

            if (result.durationMs !== undefined) {
                updateInspector(result.durationMs, 'CALC_INTEREST', result.data);
            }

            if (result.data && result.data.status === 'ok') {
                const credited = result.data.accounts_credited || 0;
                const paid = result.data.total_interest_paid || 0;
                showToast(`Zinslauf beendet: ${credited} Sparkonten verzinst (${formatCurrency(paid)})`, 'success');
                await Promise.all([loadAccounts(), loadTransactions(), loadSystemStatus()]);
            } else {
                showToast('Zinslauf fehlgeschlagen', 'error');
            }
        } catch (err) {
            console.error('Interest batch failed:', err);
            showToast('Netzwerkfehler', 'error');
        } finally {
            btnBatchInterest.disabled = false;
        }
    });
}

/**
 * Helper: Generate German Demo IBAN
 */
function generateRandomIban() {
    const randomSuffix = Math.floor(1000000000 + Math.random() * 9000000000);
    return `DE8937040044${randomSuffix}`;
}

const btnGenerateIban = document.getElementById('btnGenerateIban');
if (btnGenerateIban) {
    btnGenerateIban.addEventListener('click', () => {
        const naAccountNo = document.getElementById('naAccountNo');
        if (naAccountNo) naAccountNo.value = generateRandomIban();
    });
}

/**
 * Shortcut handlers for account cards
 */
window.copyIban = function(iban) {
    navigator.clipboard.writeText(iban);
    showToast(`IBAN ${iban} in Zwischenablage kopiert!`);
};

window.openTransferFrom = function(iban) {
    if (qtFromAccount) {
        qtFromAccount.value = iban;
        updateFromBalanceHint();
        qtAmount.focus();
        qtAmount.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
};

window.openDepositFor = function(iban) {
    if (depAccount) depAccount.value = iban;
    openModal(depositModal);
};

/**
 * Modal helpers
 */
function openModal(modal) {
    if (modal) modal.classList.remove('hidden');
}

function closeModal(modal) {
    if (modal) modal.classList.add('hidden');
}

// Modal open buttons
document.getElementById('btnNewAccountModal')?.addEventListener('click', () => {
    const naAccountNo = document.getElementById('naAccountNo');
    if (naAccountNo && !naAccountNo.value) naAccountNo.value = generateRandomIban();
    openModal(newAccountModal);
});

document.getElementById('btnDepositModal')?.addEventListener('click', () => openModal(depositModal));
document.getElementById('btnTransferModal')?.addEventListener('click', () => {
    qtFromAccount.focus();
    qtFromAccount.scrollIntoView({ behavior: 'smooth', block: 'center' });
});

// Modal close buttons
document.getElementById('btnCloseNewAccountModal')?.addEventListener('click', () => closeModal(newAccountModal));
document.getElementById('btnCancelNewAccount')?.addEventListener('click', () => closeModal(newAccountModal));
document.getElementById('btnCloseDepositModal')?.addEventListener('click', () => closeModal(depositModal));
document.getElementById('btnCancelDeposit')?.addEventListener('click', () => closeModal(depositModal));

// Close modal on click outside or escape key
window.addEventListener('click', (e) => {
    if (e.target.classList.contains('modal-overlay')) {
        closeModal(e.target);
    }
});

window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
        closeModal(newAccountModal);
        closeModal(depositModal);
    }
});

// Filter & Search events
if (accountSearch) {
    accountSearch.addEventListener('input', (e) => {
        searchQuery = e.target.value.trim();
        renderAccounts();
    });
}

if (accountTypeFilter) {
    accountTypeFilter.addEventListener('click', (e) => {
        if (e.target.classList.contains('filter-btn')) {
            accountTypeFilter.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
            e.target.classList.add('active');
            currentAccountFilter = e.target.getAttribute('data-type');
            renderAccounts();
        }
    });
}

if (txTypeFilter) {
    txTypeFilter.addEventListener('click', (e) => {
        if (e.target.classList.contains('filter-btn')) {
            txTypeFilter.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
            e.target.classList.add('active');
            currentTxFilter = e.target.getAttribute('data-tx');
            renderTransactions();
        }
    });
}

document.getElementById('btnRefreshAccounts')?.addEventListener('click', () => {
    loadAccounts();
    loadTransactions();
    loadSystemStatus();
    showToast('Daten aktualisiert');
});

qtFromAccount?.addEventListener('change', updateFromBalanceHint);

function escapeHtml(str) {
    if (!str) return '';
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/**
 * Stress Test Runner: 100 Concurrent Requests
 */
async function runStressTest(testType) {
    if (!btnStressTransfers || !btnStressReads) return;
    btnStressTransfers.disabled = true;
    btnStressReads.disabled = true;
    if (stressProgress) stressProgress.classList.remove('hidden');
    if (stressProgressFill) {
        stressProgressFill.classList.add('animated');
    }
    if (stressStatusText) {
        stressStatusText.textContent = `Sende 100 simultane ${testType === 'TRANSFER' ? 'Überweisungen (PostgreSQL parallel)' : 'Leseabfragen (MVCC-Parallel)'}...`;
    }
    if (stressResultsBox) stressResultsBox.classList.add('hidden');

    try {
        const res = await fetch(`${API_BASE}/api/stress-test`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ count: 100, type: testType })
        });
        const result = await res.json();

        if (stressProgressFill) stressProgressFill.classList.remove('animated');
        if (stressProgress) stressProgress.classList.add('hidden');

        if (stressResultsBox) {
            stressResultsBox.classList.remove('hidden');
            const ok = result.success_rate_percent >= 100;
            stressResultsBox.innerHTML = `
                <div style="color: ${ok ? 'var(--emerald-400)' : 'var(--amber-400)'}; font-weight: 700; margin-bottom: 4px;">
                    ${ok ? '✔' : '⚠'} Lasttest abgeschlossen (${result.successes}/${result.requested_count})
                </div>
                <div>Erfolgsquote: <strong>${result.success_rate_percent}%</strong></div>
                <div>Gesamtzeit: <strong>${result.total_elapsed_ms} ms</strong> (Ø ${result.avg_per_request_ms} ms/Req)</div>
                <div>Durchsatz: <strong>${result.throughput_req_per_sec} Req/Sekunde</strong></div>
                <div style="font-size: 0.7rem; color: var(--text-muted); margin-top: 4px;">
                    Architektur: ${testType === 'TRANSFER' ? `PostgreSQL Parallel Workers (×${result.concurrency || 16})` : 'PostgreSQL MVCC (echtes paralleles Lesen)'}
                </div>
            `;
        }

        showToast(`Lasttest (${testType}): ${result.successes}/${result.requested_count} ok`, result.success_rate_percent >= 100 ? 'success' : 'error');
        await Promise.all([loadAccounts(), loadTransactions(), loadSystemStatus()]);
    } catch (err) {
        console.error('Stress test failed:', err);
        showToast('Fehler bei der Lasttest-Ausführung', 'error');
        if (stressStatusText) stressStatusText.textContent = 'Fehler beim Lasttest.';
    } finally {
        btnStressTransfers.disabled = false;
        btnStressReads.disabled = false;
    }
}

btnStressTransfers?.addEventListener('click', () => runStressTest('TRANSFER'));
btnStressReads?.addEventListener('click', () => runStressTest('READ'));

// Initial Boot
document.addEventListener('DOMContentLoaded', () => {
    loadAccounts();
    loadTransactions();
    loadSystemStatus();

    // Live telemetry every second (clients / connections / TPS)
    setInterval(() => {
        loadSystemStatus();
    }, 1000);
});
