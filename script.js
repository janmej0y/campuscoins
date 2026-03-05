
(() => {
  'use strict';

  const DB_NAME = 'campuscoins-db';
  const DB_VERSION = 1;
  const TX_STORE = 'transactions';
  const RECEIPT_STORE = 'receipts';
  const SNAPSHOT_STORE = 'snapshots';

  const SETTINGS_KEY = 'campus_settings_v2';
  const BUDGETS_KEY = 'campus_budgets_v2';
  const MIGRATED_KEY = 'campus_migrated_expenses_v1';
  const CURRENCY_MIGRATION_KEY = 'campus_currency_inr_migrated_v1';
  const REMINDER_KEY = 'campus_last_reminder_date';

  const DEFAULT_SETTINGS = {
    theme: 'system',
    currency: 'INR',
    locale: navigator.language || 'en-US',
    reminderEnabled: false,
    reminderHour: 20,
    cloudEndpoint: '',
    cloudToken: '',
    pageSize: 10
  };

  const state = {
    db: null,
    transactions: [],
    budgets: {},
    settings: { ...DEFAULT_SETTINGS },
    filtered: [],
    selectedIds: new Set(),
    currentPage: 1,
    categoryChart: null,
    trendChart: null,
    lastDeleted: null,
    deferredInstallPrompt: null,
    swRegistration: null
  };

  const el = {};

  function q(id) { return document.getElementById(id); }
  function nowISODate() { return new Date().toISOString().slice(0, 10); }

  function uid() {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    return `tx_${Date.now()}_${Math.floor(Math.random() * 100000)}`;
  }

  function showToast(message, options = {}) {
    const toast = el.toast;
    toast.innerHTML = '';
    const msg = document.createElement('span');
    msg.textContent = message;
    toast.appendChild(msg);

    if (options.undo) {
      const undo = document.createElement('button');
      undo.className = 'btn';
      undo.textContent = 'Undo';
      undo.style.marginLeft = '0.5rem';
      undo.addEventListener('click', () => {
        options.undo();
        toast.classList.add('hidden');
      });
      toast.appendChild(undo);
    }

    toast.classList.remove('hidden');
    window.clearTimeout(showToast._t);
    showToast._t = window.setTimeout(() => toast.classList.add('hidden'), 3500);
  }

  function loadJSON(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch {
      return fallback;
    }
  }

  function saveJSON(key, value) { localStorage.setItem(key, JSON.stringify(value)); }

  function parseTags(input) {
    return input.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean).slice(0, 10);
  }

  function formatMoney(amount) {
    return new Intl.NumberFormat(state.settings.locale, {
      style: 'currency',
      currency: state.settings.currency,
      maximumFractionDigits: 2
    }).format(amount);
  }

  function recurringNextDate(dateStr, frequency) {
    const d = new Date(`${dateStr}T00:00:00`);
    if (frequency === 'weekly') d.setDate(d.getDate() + 7);
    if (frequency === 'monthly') d.setMonth(d.getMonth() + 1);
    if (frequency === 'yearly') d.setFullYear(d.getFullYear() + 1);
    return d.toISOString().slice(0, 10);
  }

  function openDB() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(TX_STORE)) {
          const s = db.createObjectStore(TX_STORE, { keyPath: 'id' });
          s.createIndex('date', 'date', { unique: false });
        }
        if (!db.objectStoreNames.contains(RECEIPT_STORE)) db.createObjectStore(RECEIPT_STORE, { keyPath: 'id' });
        if (!db.objectStoreNames.contains(SNAPSHOT_STORE)) db.createObjectStore(SNAPSHOT_STORE, { keyPath: 'id' });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  function idbTransaction(storeName, mode, action) {
    return new Promise((resolve, reject) => {
      const tx = state.db.transaction(storeName, mode);
      const store = tx.objectStore(storeName);
      const request = action(store);
      tx.oncomplete = () => resolve(request?.result);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  }

  function idbGetAll(store) { return idbTransaction(store, 'readonly', (s) => s.getAll()); }
  function idbPut(store, value) { return idbTransaction(store, 'readwrite', (s) => s.put(value)); }
  function idbDelete(store, key) { return idbTransaction(store, 'readwrite', (s) => s.delete(key)); }

  function idbGet(store, key) {
    return new Promise((resolve, reject) => {
      const tx = state.db.transaction(store, 'readonly');
      const s = tx.objectStore(store);
      const req = s.get(key);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  async function migrateFromLegacyLocalStorage() {
    if (localStorage.getItem(MIGRATED_KEY) === '1') return;
    const legacy = loadJSON('expenses', []);
    if (!Array.isArray(legacy) || legacy.length === 0) {
      localStorage.setItem(MIGRATED_KEY, '1');
      return;
    }

    const existing = await idbGetAll(TX_STORE);
    if (existing.length > 0) {
      localStorage.setItem(MIGRATED_KEY, '1');
      return;
    }

    for (const row of legacy) {
      const tx = {
        id: `legacy_${row.id || uid()}`,
        type: 'expense',
        description: String(row.description || 'Legacy transaction').slice(0, 120),
        amount: Math.abs(Number(row.amount || 0)),
        category: row.category || 'Other',
        date: row.date || nowISODate(),
        tags: [],
        notes: '',
        receiptId: null,
        recurring: { enabled: false, frequency: null },
        createdAt: Date.now(),
        updatedAt: Date.now()
      };
      if (tx.amount > 0) await idbPut(TX_STORE, tx);
    }

    localStorage.setItem(MIGRATED_KEY, '1');
  }

  function loadSettingsAndBudgets() {
    state.settings = { ...DEFAULT_SETTINGS, ...loadJSON(SETTINGS_KEY, {}) };
    state.budgets = loadJSON(BUDGETS_KEY, {});

    if (localStorage.getItem(CURRENCY_MIGRATION_KEY) !== '1') {
      state.settings.currency = 'INR';
      localStorage.setItem(CURRENCY_MIGRATION_KEY, '1');
      persistSettings();
    }

    el.themeSelect.value = state.settings.theme;
    el.currencySelect.value = state.settings.currency;
    el.cloudEndpoint.value = state.settings.cloudEndpoint;
    el.cloudToken.value = state.settings.cloudToken;
    applyTheme(state.settings.theme);
  }

  function persistSettings() { saveJSON(SETTINGS_KEY, state.settings); }
  function persistBudgets() { saveJSON(BUDGETS_KEY, state.budgets); }

  function applyTheme(themeMode) {
    const isLight = themeMode === 'light' || (themeMode === 'system' && window.matchMedia('(prefers-color-scheme: light)').matches);
    document.body.classList.toggle('light', isLight);
  }

  function categoryOptionsFromData() {
    const categories = new Set(['Food', 'Transport', 'Study', 'Entertainment', 'Health', 'Rent', 'Utilities', 'Shopping', 'Salary', 'Scholarship', 'Freelance', 'Other']);
    for (const tx of state.transactions) categories.add(tx.category);
    return Array.from(categories).sort();
  }

  function monthOptionsFromData() {
    const months = new Set(state.transactions.map((t) => t.date.slice(0, 7)));
    return Array.from(months).sort().reverse();
  }

  function txFingerprint(tx) {
    return [tx.type, tx.description.trim().toLowerCase(), Number(tx.amount).toFixed(2), tx.category.trim().toLowerCase(), tx.date].join('|');
  }
  function normalizeTransaction(raw) {
    const amount = Math.abs(Number(raw.amount));
    if (!amount || !raw.date || !raw.description) return null;
    return {
      id: raw.id || uid(),
      type: raw.type === 'income' ? 'income' : 'expense',
      description: String(raw.description).trim().slice(0, 120),
      amount,
      category: String(raw.category || 'Other').trim().slice(0, 40),
      date: String(raw.date).slice(0, 10),
      tags: Array.isArray(raw.tags) ? raw.tags.slice(0, 10) : parseTags(String(raw.tags || '')),
      notes: String(raw.notes || '').slice(0, 300),
      receiptId: raw.receiptId || null,
      recurring: raw.recurring?.enabled ? { enabled: true, frequency: raw.recurring.frequency || 'monthly' } : { enabled: false, frequency: null },
      createdAt: raw.createdAt || Date.now(),
      updatedAt: Date.now()
    };
  }

  async function loadTransactions() {
    state.transactions = (await idbGetAll(TX_STORE)).map(normalizeTransaction).filter(Boolean);
  }

  async function saveTransaction(tx) {
    const normalized = normalizeTransaction(tx);
    if (!normalized) throw new Error('Invalid transaction');
    await idbPut(TX_STORE, normalized);
    const idx = state.transactions.findIndex((t) => t.id === normalized.id);
    if (idx === -1) state.transactions.push(normalized);
    else state.transactions[idx] = normalized;
    return normalized;
  }

  async function deleteTransaction(id) {
    const tx = state.transactions.find((t) => t.id === id);
    if (!tx) return;
    await idbDelete(TX_STORE, id);
    if (tx.receiptId) await idbDelete(RECEIPT_STORE, tx.receiptId);
    state.transactions = state.transactions.filter((t) => t.id !== id);
  }

  async function maybeSaveReceipt(file) {
    if (!file) return null;
    const id = `rcpt_${uid()}`;
    await idbPut(RECEIPT_STORE, { id, name: file.name, mime: file.type, blob: file, createdAt: Date.now() });
    return id;
  }

  async function openReceipt(receiptId) {
    if (!receiptId) return;
    const data = await idbGet(RECEIPT_STORE, receiptId);
    if (!data || !data.blob) return showToast('Receipt not found');
    const url = URL.createObjectURL(data.blob);
    window.open(url, '_blank', 'noopener,noreferrer');
    setTimeout(() => URL.revokeObjectURL(url), 30000);
  }

  async function generateRecurringTransactions() {
    const today = nowISODate();
    const generated = [];

    for (const tx of [...state.transactions]) {
      if (!tx.recurring?.enabled || !tx.recurring.frequency) continue;
      let next = recurringNextDate(tx.date, tx.recurring.frequency);
      let safety = 0;
      while (next <= today && safety < 24) {
        generated.push({ ...tx, id: uid(), date: next, recurring: { ...tx.recurring }, createdAt: Date.now(), updatedAt: Date.now() });
        next = recurringNextDate(next, tx.recurring.frequency);
        safety += 1;
      }
    }

    if (generated.length) {
      for (const g of generated) await saveTransaction(g);
      showToast(`Generated ${generated.length} recurring transaction(s)`);
    }
  }

  function currentFilters() {
    return {
      search: el.search.value.trim().toLowerCase(),
      type: el.filterType.value,
      category: el.filterCategory.value,
      fromDate: el.fromDate.value,
      toDate: el.toDate.value,
      month: el.monthFilter.value,
      minAmount: Number(el.minAmount.value || 0),
      maxAmount: Number(el.maxAmount.value || 0),
      sortBy: el.sortBy.value
    };
  }

  function applyFilters() {
    const f = currentFilters();
    let rows = [...state.transactions];

    rows = rows.filter((t) => {
      if (f.type !== 'all' && t.type !== f.type) return false;
      if (f.category !== 'all' && t.category !== f.category) return false;
      if (f.month !== 'all' && !t.date.startsWith(f.month)) return false;
      if (f.fromDate && t.date < f.fromDate) return false;
      if (f.toDate && t.date > f.toDate) return false;
      if (f.minAmount && t.amount < f.minAmount) return false;
      if (f.maxAmount && t.amount > f.maxAmount) return false;
      if (f.search) {
        const hay = `${t.description} ${t.notes || ''} ${(t.tags || []).join(' ')}`.toLowerCase();
        if (!hay.includes(f.search)) return false;
      }
      return true;
    });

    rows.sort((a, b) => {
      if (f.sortBy === 'date_asc') return a.date.localeCompare(b.date);
      if (f.sortBy === 'amount_desc') return b.amount - a.amount;
      if (f.sortBy === 'amount_asc') return a.amount - b.amount;
      return b.date.localeCompare(a.date);
    });

    state.filtered = rows;
    const totalPages = Math.max(1, Math.ceil(rows.length / state.settings.pageSize));
    if (state.currentPage > totalPages) state.currentPage = totalPages;
  }

  function paginatedRows() {
    const start = (state.currentPage - 1) * state.settings.pageSize;
    return state.filtered.slice(start, start + state.settings.pageSize);
  }

  function computeSummary(rows) {
    const income = rows.filter((t) => t.type === 'income').reduce((s, t) => s + t.amount, 0);
    const expense = rows.filter((t) => t.type === 'expense').reduce((s, t) => s + t.amount, 0);
    const net = income - expense;

    const currentMonth = nowISODate().slice(0, 7);
    const monthExpense = state.transactions.filter((t) => t.type === 'expense' && t.date.startsWith(currentMonth)).reduce((s, t) => s + t.amount, 0);
    const budgetTotal = Object.values(state.budgets).reduce((s, n) => s + Number(n || 0), 0);
    const budgetUsed = budgetTotal > 0 ? Math.round((monthExpense / budgetTotal) * 100) : 0;

    const now = new Date();
    const startOfWeek = new Date(now);
    startOfWeek.setDate(now.getDate() - now.getDay());
    const weekKey = startOfWeek.toISOString().slice(0, 10);
    const monthKey = nowISODate().slice(0, 7);
    const yearKey = nowISODate().slice(0, 4);

    const weeklyNet = state.transactions.filter((t) => t.date >= weekKey).reduce((s, t) => s + (t.type === 'income' ? t.amount : -t.amount), 0);
    const monthlyNet = state.transactions.filter((t) => t.date.startsWith(monthKey)).reduce((s, t) => s + (t.type === 'income' ? t.amount : -t.amount), 0);
    const yearlyNet = state.transactions.filter((t) => t.date.startsWith(yearKey)).reduce((s, t) => s + (t.type === 'income' ? t.amount : -t.amount), 0);

    return { income, expense, net, budgetUsed, weeklyNet, monthlyNet, yearlyNet };
  }

  function renderSummary() {
    const s = computeSummary(state.filtered);
    el.summaryIncome.textContent = formatMoney(s.income);
    el.summaryExpense.textContent = formatMoney(s.expense);
    el.summaryNet.textContent = formatMoney(s.net);
    el.summaryNet.style.color = s.net < 0 ? 'var(--danger)' : 'var(--text)';
    el.summaryBudget.textContent = String(Math.max(0, s.budgetUsed)) + "%";
    el.summaryPeriod.textContent = 'Week: ' + formatMoney(s.weeklyNet) + ' | Month: ' + formatMoney(s.monthlyNet) + ' | Year: ' + formatMoney(s.yearlyNet);
  }
  function renderBudgetList() {
    const box = el.budgetList;
    box.innerHTML = '';

    const month = nowISODate().slice(0, 7);
    const expenseByCat = {};
    for (const tx of state.transactions) {
      if (tx.type !== 'expense' || !tx.date.startsWith(month)) continue;
      expenseByCat[tx.category] = (expenseByCat[tx.category] || 0) + tx.amount;
    }

    const entries = Object.entries(state.budgets);
    if (!entries.length) {
      box.innerHTML = '<p class="tx-sub">No budgets set yet.</p>';
      return;
    }

    for (const [cat, limit] of entries) {
      const spent = expenseByCat[cat] || 0;
      const pct = limit > 0 ? Math.min(160, Math.round((spent / limit) * 100)) : 0;
      const row = document.createElement('div');
      row.className = 'space-y-1';
      row.innerHTML = `
        <div class="flex justify-between text-sm">
          <span>${cat}</span>
          <span>${formatMoney(spent)} / ${formatMoney(Number(limit))}</span>
        </div>
        <div class="progress"><span style="width:${Math.min(100, pct)}%"></span></div>
      `;
      box.appendChild(row);

      const alertKey = `alert_${month}_${cat}`;
      if (limit > 0 && spent > limit && localStorage.getItem(alertKey) !== '1') {
        showToast(`Budget exceeded: ${cat}`);
        localStorage.setItem(alertKey, '1');
      }
    }
  }

  async function renderTransactions() {
    const list = el.transactionList;
    list.innerHTML = '';

    const rows = paginatedRows();
    if (!rows.length) list.innerHTML = '<p class="tx-sub">No transactions for current filters.</p>';

    for (const tx of rows) {
      const item = document.createElement('div');
      item.className = 'tx-item';
      const checked = state.selectedIds.has(tx.id) ? 'checked' : '';
      const tags = (tx.tags || []).join(', ');
      const amountPrefix = tx.type === 'expense' ? '-' : '+';
      const receiptBtn = tx.receiptId ? `<button class="btn" data-action="receipt" data-id="${tx.id}">Receipt</button>` : '';

      item.innerHTML = `
        <input type="checkbox" class="row-check" data-id="${tx.id}" ${checked} aria-label="Select transaction">
        <div>
          <div class="font-semibold">${tx.description}</div>
          <div class="tx-sub">${tx.date} | ${tx.type} | ${tx.category}</div>
          <div class="tx-sub">Tags: ${tags || '-'}${tx.notes ? ` | Notes: ${tx.notes}` : ''}</div>
          <div class="tx-sub">Recurring: ${tx.recurring?.enabled ? tx.recurring.frequency : 'no'}</div>
        </div>
        <div>
          <div class="tx-amount" style="color:${tx.type === 'expense' ? 'var(--danger)' : 'var(--accent-2)'}">${amountPrefix}${formatMoney(tx.amount)}</div>
          <div class="tx-actions">
            ${receiptBtn}
            <button class="btn" data-action="edit" data-id="${tx.id}">Edit</button>
            <button class="btn" data-action="delete" data-id="${tx.id}">Delete</button>
          </div>
        </div>
      `;
      list.appendChild(item);
    }

    const totalPages = Math.max(1, Math.ceil(state.filtered.length / state.settings.pageSize));
    el.pageInfo.textContent = `Page ${state.currentPage}/${totalPages}`;
    el.prevPage.disabled = state.currentPage <= 1;
    el.nextPage.disabled = state.currentPage >= totalPages;
  }

  function renderFilterOptions() {
    const cats = categoryOptionsFromData();
    const months = monthOptionsFromData();

    const currentCat = el.filterCategory.value || 'all';
    el.filterCategory.innerHTML = '<option value="all">All Categories</option>';
    cats.forEach((c) => {
      const o = document.createElement('option');
      o.value = c;
      o.textContent = c;
      el.filterCategory.appendChild(o);
    });
    if ([...el.filterCategory.options].some((o) => o.value === currentCat)) el.filterCategory.value = currentCat;

    const currentMonth = el.monthFilter.value || 'all';
    el.monthFilter.innerHTML = '<option value="all">All Months</option>';
    months.forEach((m) => {
      const [y, n] = m.split('-');
      const label = new Date(Number(y), Number(n) - 1, 1).toLocaleDateString(state.settings.locale, { month: 'long', year: 'numeric' });
      const o = document.createElement('option');
      o.value = m;
      o.textContent = label;
      el.monthFilter.appendChild(o);
    });
    if ([...el.monthFilter.options].some((o) => o.value === currentMonth)) el.monthFilter.value = currentMonth;
  }

  function chartDatasetForCategory(rows) {
    const byCat = {};
    rows.filter((r) => r.type === 'expense').forEach((r) => {
      byCat[r.category] = (byCat[r.category] || 0) + r.amount;
    });
    return { labels: Object.keys(byCat), values: Object.values(byCat) };
  }

  function chartDatasetForTrend(rows) {
    const byMonth = {};
    rows.forEach((r) => {
      const m = r.date.slice(0, 7);
      const delta = r.type === 'income' ? r.amount : -r.amount;
      byMonth[m] = (byMonth[m] || 0) + delta;
    });
    const labels = Object.keys(byMonth).sort();
    return { labels, values: labels.map((l) => byMonth[l]) };
  }

  function renderCharts() {
    if (typeof Chart === 'undefined') return;

    const cat = chartDatasetForCategory(state.filtered);
    const trend = chartDatasetForTrend(state.filtered);
    state.categoryChart?.destroy();
    state.trendChart?.destroy();

    state.categoryChart = new Chart(el.categoryChart, {
      type: 'pie',
      data: {
        labels: cat.labels,
        datasets: [{ data: cat.values, backgroundColor: ['#0ea5e9', '#10b981', '#f59e0b', '#ef4444', '#6366f1', '#22d3ee', '#f97316'] }]
      },
      options: { plugins: { legend: { labels: { color: getComputedStyle(document.body).getPropertyValue('--text') } } } }
    });

    state.trendChart = new Chart(el.trendChart, {
      type: 'bar',
      data: { labels: trend.labels, datasets: [{ label: 'Net', data: trend.values, backgroundColor: '#22c55e' }] },
      options: {
        scales: {
          x: { ticks: { color: getComputedStyle(document.body).getPropertyValue('--text') } },
          y: { ticks: { color: getComputedStyle(document.body).getPropertyValue('--text') } }
        }
      }
    });
  }

  async function refreshUI() {
    renderFilterOptions();
    applyFilters();
    renderSummary();
    renderBudgetList();
    await renderTransactions();
    renderCharts();
  }

  async function onEntrySubmit(e) {
    e.preventDefault();
    const file = el.receipt.files[0];
    const receiptId = await maybeSaveReceipt(file);
    const recurringEnabled = el.isRecurring.checked;

    const tx = {
      id: uid(),
      type: el.type.value,
      description: el.description.value,
      amount: el.amount.value,
      category: el.category.value,
      date: el.date.value,
      tags: parseTags(el.tags.value),
      notes: el.notes.value,
      receiptId,
      recurring: { enabled: recurringEnabled, frequency: recurringEnabled ? el.recurringFrequency.value : null }
    };

    await saveTransaction(tx);
    e.target.reset();
    el.date.value = nowISODate();
    el.recurringFrequency.disabled = true;
    state.currentPage = 1;
    await refreshUI();
    showToast('Transaction added');
  }
  function openEditModal(tx) {
    el.editId.value = tx.id;
    el.editType.value = tx.type;
    el.editDate.value = tx.date;
    el.editDescription.value = tx.description;
    el.editAmount.value = tx.amount;
    el.editCategory.value = tx.category;
    el.editTags.value = (tx.tags || []).join(', ');
    el.editNotes.value = tx.notes || '';
    el.editModal.classList.remove('hidden');
    el.editDescription.focus();
  }

  function closeEditModal() { el.editModal.classList.add('hidden'); }

  async function onEditSubmit(e) {
    e.preventDefault();
    const id = el.editId.value;
    const current = state.transactions.find((t) => t.id === id);
    if (!current) return;

    await saveTransaction({
      ...current,
      type: el.editType.value,
      date: el.editDate.value,
      description: el.editDescription.value,
      amount: el.editAmount.value,
      category: el.editCategory.value,
      tags: parseTags(el.editTags.value),
      notes: el.editNotes.value
    });

    closeEditModal();
    await refreshUI();
    showToast('Transaction updated');
  }

  async function onTransactionListClick(e) {
    const btn = e.target.closest('button[data-action]');
    if (!btn) return;
    const action = btn.dataset.action;
    const id = btn.dataset.id;
    const tx = state.transactions.find((t) => t.id === id);
    if (!tx) return;

    if (action === 'edit') return openEditModal(tx);
    if (action === 'receipt') return openReceipt(tx.receiptId);

    if (action === 'delete') {
      state.lastDeleted = tx;
      await deleteTransaction(id);
      state.selectedIds.delete(id);
      await refreshUI();
      showToast('Transaction deleted', {
        undo: async () => {
          const undoTx = { ...state.lastDeleted, receiptId: null };
          await saveTransaction(undoTx);
          await refreshUI();
          showToast('Undo complete');
        }
      });
    }
  }

  async function onTransactionListChange(e) {
    const rowCheck = e.target.closest('.row-check');
    if (!rowCheck) return;
    const id = rowCheck.dataset.id;
    if (rowCheck.checked) state.selectedIds.add(id);
    else state.selectedIds.delete(id);

    const pageIds = paginatedRows().map((r) => r.id);
    const selectedOnPage = pageIds.every((idVal) => state.selectedIds.has(idVal));
    el.selectAll.checked = selectedOnPage && pageIds.length > 0;
  }

  async function onBulkDelete() {
    if (state.selectedIds.size === 0) return showToast('No transactions selected');
    const ids = [...state.selectedIds];
    for (const id of ids) await deleteTransaction(id);
    state.selectedIds.clear();
    await refreshUI();
    showToast(`Deleted ${ids.length} transactions`);
  }

  async function onBulkTag() {
    if (state.selectedIds.size === 0) return showToast('No transactions selected');
    const tag = window.prompt('Tag to add to selected transactions:');
    if (!tag) return;
    const clean = tag.trim().toLowerCase();
    if (!clean) return;

    for (const id of state.selectedIds) {
      const tx = state.transactions.find((t) => t.id === id);
      if (!tx) continue;
      const tags = new Set(tx.tags || []);
      tags.add(clean);
      await saveTransaction({ ...tx, tags: [...tags] });
    }

    await refreshUI();
    showToast('Tag applied to selected transactions');
  }

  async function onBudgetSubmit(e) {
    e.preventDefault();
    const cat = el.budgetCategory.value;
    const amount = Number(el.budgetAmount.value || 0);
    if (!cat || amount < 0) return;
    state.budgets[cat] = amount;
    persistBudgets();
    el.budgetForm.reset();
    await refreshUI();
    showToast('Budget saved');
  }

  function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
  }

  function exportCSV() {
    if (!state.transactions.length) return showToast('No transactions to export');
    const headers = ['id', 'type', 'description', 'amount', 'category', 'date', 'tags', 'notes'];
    const rows = state.transactions.map((t) => [
      t.id,
      t.type,
      `"${String(t.description).replace(/"/g, '""')}"`,
      t.amount,
      t.category,
      t.date,
      `"${(t.tags || []).join('|')}"`,
      `"${String(t.notes || '').replace(/"/g, '""')}"`
    ].join(','));

    const content = [headers.join(','), ...rows].join('\n');
    const blob = new Blob([content], { type: 'text/csv;charset=utf-8' });
    downloadBlob(blob, `campuscoins_${Date.now()}.csv`);
    showToast('CSV exported');
  }

  function exportJSON() {
    const payload = {
      exportedAt: new Date().toISOString(),
      transactions: state.transactions,
      budgets: state.budgets,
      settings: state.settings
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    downloadBlob(blob, `campuscoins_${Date.now()}.json`);
    showToast('JSON exported');
  }

  async function createBackupSnapshot() {
    const snapshot = {
      id: `snapshot_${Date.now()}`,
      createdAt: new Date().toISOString(),
      transactions: state.transactions,
      budgets: state.budgets,
      settings: state.settings
    };
    await idbPut(SNAPSHOT_STORE, snapshot);
    showToast('Backup snapshot created');
  }

  async function downloadLatestSnapshot() {
    const snaps = await idbGetAll(SNAPSHOT_STORE);
    if (!snaps.length) return showToast('No backup snapshot found');
    snaps.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    const latest = snaps[0];
    const blob = new Blob([JSON.stringify(latest, null, 2)], { type: 'application/json' });
    downloadBlob(blob, 'campuscoins_backup_' + latest.createdAt.slice(0, 10) + '.json');
    showToast('Backup downloaded');
  }

  async function restoreLatestSnapshot() {
    const snaps = await idbGetAll(SNAPSHOT_STORE);
    if (!snaps.length) return showToast('No backup snapshot found');
    snaps.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    const latest = snaps[0];

    for (const t of state.transactions) await idbDelete(TX_STORE, t.id);
    state.transactions = [];
    for (const tx of (latest.transactions || [])) await saveTransaction(tx);

    state.budgets = latest.budgets || {};
    state.settings = { ...DEFAULT_SETTINGS, ...(latest.settings || {}) };
    persistBudgets();
    persistSettings();
    applyTheme(state.settings.theme);
    el.themeSelect.value = state.settings.theme;
    el.currencySelect.value = state.settings.currency;
    el.cloudEndpoint.value = state.settings.cloudEndpoint || '';
    el.cloudToken.value = state.settings.cloudToken || '';

    await refreshUI();
    showToast('Backup restored');
  }
  async function importJSONFile(file, mode) {
    const text = await file.text();
    let data;
    try { data = JSON.parse(text); }
    catch { showToast('Invalid JSON file'); return; }

    const incoming = Array.isArray(data) ? data : (Array.isArray(data.transactions) ? data.transactions : []);
    const normalized = incoming.map(normalizeTransaction).filter(Boolean);

    if (!normalized.length && mode !== 'replace') {
      showToast('No valid transactions in import');
      return;
    }

    if (mode === 'replace') {
      for (const t of state.transactions) await idbDelete(TX_STORE, t.id);
      state.transactions = [];
    }

    const seen = new Set(state.transactions.map(txFingerprint));
    let added = 0;
    let skipped = 0;

    for (const tx of normalized) {
      const fp = txFingerprint(tx);
      if (seen.has(fp)) { skipped += 1; continue; }
      seen.add(fp);
      tx.id = uid();
      await saveTransaction(tx);
      added += 1;
    }

    if (data.budgets && typeof data.budgets === 'object') {
      state.budgets = { ...state.budgets, ...data.budgets };
      persistBudgets();
    }

    if (data.settings && typeof data.settings === 'object') {
      state.settings = { ...state.settings, ...data.settings };
      persistSettings();
      applyTheme(state.settings.theme);
    }

    await refreshUI();
    showToast(`Import complete: added ${added}, skipped ${skipped}`);
  }

  async function pushCloud() {
    const endpoint = el.cloudEndpoint.value.trim();
    const token = el.cloudToken.value.trim();
    if (!endpoint) return showToast('Cloud endpoint is required');

    const payload = {
      exportedAt: new Date().toISOString(),
      transactions: state.transactions,
      budgets: state.budgets,
      settings: state.settings
    };

    const res = await fetch(endpoint, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {})
      },
      body: JSON.stringify(payload)
    });

    if (!res.ok) throw new Error(`Cloud push failed (${res.status})`);
    state.settings.cloudEndpoint = endpoint;
    state.settings.cloudToken = token;
    persistSettings();
    showToast('Cloud push complete');
  }

  async function pullCloud() {
    const endpoint = el.cloudEndpoint.value.trim();
    const token = el.cloudToken.value.trim();
    if (!endpoint) return showToast('Cloud endpoint is required');

    const res = await fetch(endpoint, {
      method: 'GET',
      headers: token ? { Authorization: `Bearer ${token}` } : {}
    });

    if (!res.ok) throw new Error(`Cloud pull failed (${res.status})`);
    const data = await res.json();
    const file = new File([JSON.stringify(data)], 'cloud.json', { type: 'application/json' });
    await importJSONFile(file, 'replace');
    showToast('Cloud pull complete');
  }

  async function enableReminders() {
    if (!('Notification' in window)) return showToast('Notifications not supported');
    const permission = await Notification.requestPermission();
    if (permission !== 'granted') return showToast('Notifications denied');

    const hourInput = window.prompt('Reminder hour (0-23):', String(state.settings.reminderHour));
    const hour = Number(hourInput);
    if (Number.isFinite(hour) && hour >= 0 && hour <= 23) state.settings.reminderHour = hour;
    state.settings.reminderEnabled = true;
    persistSettings();
    showToast('Daily reminders enabled');
  }

  function maybeSendReminder() {
    if (!state.settings.reminderEnabled || Notification.permission !== 'granted') return;
    const now = new Date();
    const hour = now.getHours();
    const today = now.toISOString().slice(0, 10);
    const last = localStorage.getItem(REMINDER_KEY);
    if (hour === Number(state.settings.reminderHour) && today !== last) {
      new Notification('Campus Coins', { body: 'Log your expenses for today.', icon: 'assets/icon-192.png' });
      localStorage.setItem(REMINDER_KEY, today);
    }
  }

  function runTests() {
    const failures = [];
    const assert = (name, cond) => { if (!cond) failures.push(name); };

    const sample = [
      { type: 'income', amount: 100, category: 'Salary', date: '2026-03-01', description: 'A', tags: [], notes: '' },
      { type: 'expense', amount: 40, category: 'Food', date: '2026-03-02', description: 'B', tags: [], notes: '' },
      { type: 'expense', amount: 10, category: 'Food', date: '2026-03-03', description: 'C', tags: [], notes: '' }
    ].map((s) => normalizeTransaction({ ...s, id: uid() }));

    const summary = {
      income: sample.filter((t) => t.type === 'income').reduce((a, t) => a + t.amount, 0),
      expense: sample.filter((t) => t.type === 'expense').reduce((a, t) => a + t.amount, 0)
    };

    assert('summary_income', summary.income === 100);
    assert('summary_expense', summary.expense === 50);
    assert('net_calc', summary.income - summary.expense === 50);
    assert('tag_parser', parseTags('a, b, a').length === 3);
    assert('recurring_next', recurringNextDate('2026-03-01', 'weekly') === '2026-03-08');

    if (failures.length) {
      console.error('Tests failed:', failures);
      showToast(`Tests failed (${failures.length})`);
    } else {
      showToast('All tests passed');
    }
  }
  function setupPWA() {
    if (!('serviceWorker' in navigator)) return;

    navigator.serviceWorker.register('service-worker.js').then((reg) => {
      state.swRegistration = reg;
      if (reg.waiting) el.updateBanner.classList.remove('hidden');

      reg.addEventListener('updatefound', () => {
        const nw = reg.installing;
        if (!nw) return;
        nw.addEventListener('statechange', () => {
          if (nw.state === 'installed' && navigator.serviceWorker.controller) {
            el.updateBanner.classList.remove('hidden');
          }
        });
      });
    }).catch((err) => console.error('SW register failed', err));

    navigator.serviceWorker.addEventListener('controllerchange', () => window.location.reload());

    window.addEventListener('beforeinstallprompt', (e) => {
      e.preventDefault();
      state.deferredInstallPrompt = e;
      el.installBanner.classList.remove('hidden');
    });
  }

  function bindElements() {
    [
      'entry-form', 'type', 'date', 'description', 'amount', 'category', 'tags', 'notes', 'receipt',
      'is-recurring', 'recurring-frequency', 'budget-form', 'budget-category', 'budget-amount', 'budget-list',
      'export-csv', 'export-json', 'create-backup', 'download-backup', 'restore-backup', 'import-mode', 'import-json',
      'cloud-endpoint', 'cloud-token', 'cloud-push', 'cloud-pull',
      'search', 'filter-type', 'filter-category', 'from-date', 'to-date', 'month-filter', 'min-amount', 'max-amount', 'sort-by',
      'transaction-list', 'select-all', 'bulk-delete', 'bulk-tag', 'prev-page', 'next-page', 'page-info',
      'summary-income', 'summary-expense', 'summary-net', 'summary-budget', 'summary-period',
      'category-chart', 'trend-chart',
      'theme-select', 'currency-select', 'enable-reminders', 'run-tests',
      'edit-modal', 'edit-form', 'edit-id', 'edit-type', 'edit-date', 'edit-description', 'edit-amount', 'edit-category', 'edit-tags', 'edit-notes', 'cancel-edit',
      'install-banner', 'install-app', 'dismiss-install', 'update-banner', 'update-app',
      'toast'
    ].forEach((id) => {
      el[id.replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = q(id);
    });
  }

  function wireEvents() {
    el.entryForm.addEventListener('submit', (e) => onEntrySubmit(e).catch((err) => showToast(err.message || 'Save failed')));
    el.isRecurring.addEventListener('change', () => { el.recurringFrequency.disabled = !el.isRecurring.checked; });

    [el.search, el.filterType, el.filterCategory, el.fromDate, el.toDate, el.monthFilter, el.minAmount, el.maxAmount, el.sortBy]
      .forEach((node) => node.addEventListener('input', async () => { state.currentPage = 1; await refreshUI(); }));
    el.monthFilter.addEventListener('change', async () => { state.currentPage = 1; await refreshUI(); });

    el.prevPage.addEventListener('click', async () => { state.currentPage = Math.max(1, state.currentPage - 1); await refreshUI(); });
    el.nextPage.addEventListener('click', async () => {
      const pages = Math.max(1, Math.ceil(state.filtered.length / state.settings.pageSize));
      state.currentPage = Math.min(pages, state.currentPage + 1);
      await refreshUI();
    });

    el.transactionList.addEventListener('click', (e) => onTransactionListClick(e).catch((err) => showToast(err.message || 'Action failed')));
    el.transactionList.addEventListener('change', (e) => onTransactionListChange(e));

    el.selectAll.addEventListener('change', async () => {
      const pageIds = paginatedRows().map((r) => r.id);
      if (el.selectAll.checked) pageIds.forEach((id) => state.selectedIds.add(id));
      else pageIds.forEach((id) => state.selectedIds.delete(id));
      await refreshUI();
    });

    el.bulkDelete.addEventListener('click', () => onBulkDelete().catch((err) => showToast(err.message || 'Bulk delete failed')));
    el.bulkTag.addEventListener('click', () => onBulkTag().catch((err) => showToast(err.message || 'Bulk tag failed')));
    el.budgetForm.addEventListener('submit', (e) => onBudgetSubmit(e));

    el.exportCsv.addEventListener('click', exportCSV);
    el.exportJson.addEventListener('click', exportJSON);
    el.createBackup.addEventListener('click', () => createBackupSnapshot().catch((err) => showToast(err.message || 'Backup failed')));
    el.downloadBackup.addEventListener('click', () => downloadLatestSnapshot().catch((err) => showToast(err.message || 'Download failed')));
    el.restoreBackup.addEventListener('click', () => restoreLatestSnapshot().catch((err) => showToast(err.message || 'Restore failed')));
    el.importJson.addEventListener('change', async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      await importJSONFile(file, el.importMode.value);
      el.importJson.value = '';
    });

    el.cloudPush.addEventListener('click', () => pushCloud().catch((err) => showToast(err.message || 'Cloud push failed')));
    el.cloudPull.addEventListener('click', () => pullCloud().catch((err) => showToast(err.message || 'Cloud pull failed')));

    el.themeSelect.addEventListener('change', async () => {
      state.settings.theme = el.themeSelect.value;
      persistSettings();
      applyTheme(state.settings.theme);
      await refreshUI();
    });

    el.currencySelect.addEventListener('change', async () => {
      state.settings.currency = el.currencySelect.value;
      persistSettings();
      await refreshUI();
    });

    el.enableReminders.addEventListener('click', () => enableReminders().catch((err) => showToast(err.message || 'Reminder failed')));
    el.runTests.addEventListener('click', () => runTests());

    el.editForm.addEventListener('submit', (e) => onEditSubmit(e).catch((err) => showToast(err.message || 'Edit failed')));
    el.cancelEdit.addEventListener('click', closeEditModal);
    el.editModal.addEventListener('click', (e) => { if (e.target === el.editModal) closeEditModal(); });

    el.installApp.addEventListener('click', async () => {
      if (!state.deferredInstallPrompt) return;
      state.deferredInstallPrompt.prompt();
      await state.deferredInstallPrompt.userChoice;
      state.deferredInstallPrompt = null;
      el.installBanner.classList.add('hidden');
    });
    el.dismissInstall.addEventListener('click', () => el.installBanner.classList.add('hidden'));

    el.updateApp.addEventListener('click', () => {
      if (state.swRegistration?.waiting) state.swRegistration.waiting.postMessage({ type: 'SKIP_WAITING' });
    });

    window.matchMedia('(prefers-color-scheme: light)').addEventListener('change', async () => {
      if (state.settings.theme === 'system') {
        applyTheme('system');
        await refreshUI();
      }
    });
  }

  async function init() {
    bindElements();
    state.db = await openDB();
    await migrateFromLegacyLocalStorage();
    loadSettingsAndBudgets();
    await loadTransactions();
    await generateRecurringTransactions();

    el.date.value = nowISODate();
    await refreshUI();
    wireEvents();
    setupPWA();

    setInterval(maybeSendReminder, 60000);
    maybeSendReminder();
  }

  document.addEventListener('DOMContentLoaded', () => {
    init().catch((err) => {
      console.error(err);
      showToast('Initialization failed');
    });
  });
})();








