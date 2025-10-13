

(() => {
    // ---------- Helpers ----------
    const $ = id => document.getElementById(id);
    const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2,6);
  
    // currency detection heuristic
    const locale = navigator.language || 'en-US';
    const currency = (locale && locale.includes('IN')) ? 'INR' : 'USD'; // simple heuristic
    const formatMoney = (value) => {
      try {
        return new Intl.NumberFormat(locale, { style: 'currency', currency }).format(value);
      } catch {
        return (value >= 0 ? '₹' : '-₹') + Math.abs(value).toFixed(2);
      }
    };
  
    // ---------- Storage keys ----------
    const STORAGE_KEY = 'exp_v2_data';
    const TEMPLATE_KEY = 'exp_v2_recur_templates';
    const LAST_RECURRING_RUN = 'exp_v2_last_recurr';
    const THEME_KEY = 'exp_v2_theme';
    const BUDGETS_KEY = 'exp_v2_budgets';
  
    // ---------- Default categories with icons & colors ----------
    const DEFAULT_CATEGORIES = [
      { id:'Food', label:'Food', icon:'🍔', color:'#fb923c' },
      { id:'Travel', label:'Travel', icon:'🚗', color:'#06b6d4' },
      { id:'Study', label:'Study', icon:'📚', color:'#7c3aed' },
      { id:'Entertainment', label:'Entertainment', icon:'🎮', color:'#f472b6' },
      { id:'Supplies', label:'Supplies', icon:'🖊️', color:'#f59e0b' },
      { id:'Rent', label:'Rent', icon:'🏠', color:'#ef4444' },
      { id:'Other', label:'Other', icon:'🔖', color:'#94a3b8' },
    ];
  
    // ---------- App state ----------
    let expenses = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
    let recurTemplates = JSON.parse(localStorage.getItem(TEMPLATE_KEY) || '[]');
    let budgets = JSON.parse(localStorage.getItem(BUDGETS_KEY) || '{}'); // budgets per month 'YYYY-MM': amount
    let pieChart = null, barChart = null;
  
    // ---------- DOM refs ----------
    const listEl = $('list'), emptyEl = $('empty');
    const filterMonth = $('filterMonth'), filterCategory = $('filterCategory'), searchEl = $('search');
    const qCategory = $('qCategory'), qTitle = $('qTitle'), qAmount = $('qAmount'), qType = $('qType'), qAdd = $('qAdd');
    const btnSeed = $('btnSeed'), btnClear = $('btnClear'), btnExport = $('btnExport'), btnExportJSON = $('btnExportJSON'), btnImport = $('btnImport'), importJson = $('importJson');
    const fab = $('fab'), modal = $('modal'), modalClose = $('modalClose'), form = $('form');
    const titleField = $('title'), amountField = $('amount'), dateField = $('date'), categoryField = $('category'), notesField = $('notes'), recurringField = $('recurring'), typeField = $('type'), deleteBtn = $('deleteBtn');
    const categoriesEl = $('categories'), filterType = $('typeFilter'), sortSelect = $('sort'), budgetInput = $('budgetInput'), saveBudget = $('saveBudget');
    const budgetFill = $('budgetFill'), budgetLabel = $('budgetLabel'), netBalanceEl = $('netBalance');
  
    const pieCtx = document.getElementById('pieChart').getContext('2d');
    const barCtx = document.getElementById('barChart').getContext('2d');
  
    // ---------- Theme ----------
    const themeSwitch = $('themeSwitch');
    function applyTheme(theme){
      document.documentElement.setAttribute('data-theme', theme);
      localStorage.setItem(THEME_KEY, theme);
      if(theme==='dark'){
        document.body.style.background = 'linear-gradient(180deg,#071029,#071629)';
        document.body.style.color = '#e6eef8';
      } else {
        document.body.style.background = 'linear-gradient(180deg,#f6f9fc,#eef2ff)';
        document.body.style.color = '#0f172a';
      }
    }
    const savedTheme = localStorage.getItem(THEME_KEY) || 'light';
    themeSwitch.checked = savedTheme === 'dark';
    applyTheme(savedTheme);
    themeSwitch.addEventListener('change', () => applyTheme(themeSwitch.checked ? 'dark' : 'light'));
  
    // ---------- Utilities ----------
    function saveAll(){
      localStorage.setItem(STORAGE_KEY, JSON.stringify(expenses));
      localStorage.setItem(TEMPLATE_KEY, JSON.stringify(recurTemplates));
      localStorage.setItem(BUDGETS_KEY, JSON.stringify(budgets));
    }
  
    function todayISO(offsetDays = 0){
      const d = new Date(); d.setDate(d.getDate() + offsetDays);
      return d.toISOString().slice(0,10);
    }
  
    function monthKeyFromDate(dateStr){
      return (dateStr || todayISO()).slice(0,7);
    }
  
    // ---------- Recurring templates application ----------
    function applyRecurringTemplatesIfNeeded(){
      const lastRun = localStorage.getItem(LAST_RECURRING_RUN) || '';
      const nowMonth = new Date().toISOString().slice(0,7);
      if(lastRun === nowMonth) return; // already applied this month
  
      // for each template create an expense for this month (unless already created)
      recurTemplates.forEach(t => {
        // create a new expense with same day as template.date, but in current month
        const baseDay = (t.date || todayISO()).slice(8,10);
        const newDate = `${nowMonth}-${baseDay}`;
        // avoid duplicates: check if an expense with templateId and same month exists
        const exists = expenses.some(e => e.templateId === t.id && e.date.slice(0,7) === nowMonth);
        if(!exists){
          const newExp = {
            id: uid(), title: t.title, amount: t.amount, category: t.category,
            date: newDate, notes: t.notes, type: t.type, createdAt: Date.now(), templateId: t.id
          };
          expenses.push(newExp);
        }
      });
  
      localStorage.setItem(LAST_RECURRING_RUN, nowMonth);
      saveAll();
    }
  
    // ---------- Render helpers ----------
    function buildCategoryOptions(selectEl){
      selectEl.innerHTML = DEFAULT_CATEGORIES.map(c => `<option value="${c.id}">${c.icon} ${c.label}</option>`).join('');
    }
  
    function renderCategories(){
      categoriesEl.innerHTML = DEFAULT_CATEGORIES.map(c => {
        const total = totalByCategory(c.id);
        return `
          <div class="cat-badge" data-cat="${c.id}">
            <div class="cat-color" style="background:${c.color}">${c.icon}</div>
            <div>
              <div style="font-weight:700">${c.label}</div>
              <div class="small muted">${formatMoney(total)}</div>
            </div>
          </div>
        `;
      }).join('');
    }
  
    function totalByCategory(catId){
      const month = filterMonth.value || new Date().toISOString().slice(0,7);
      return expenses.filter(e => e.category === catId && e.date.slice(0,7) === month && e.type === 'expense').reduce((s, x) => s + Number(x.amount || 0), 0);
    }
  
    function formatMoney(value){
      return formatMoneyNative(value);
    }
  
    // local function name distinct to avoid overshadowing
    function formatMoneyNative(value){
      try { return new Intl.NumberFormat(locale, { style:'currency', currency }).format(Number(value || 0)); }
      catch { return `₹${Number(value||0).toFixed(2)}`; }
    }
  
    function renderList(){
      const q = (searchEl.value || '').toLowerCase();
      const monthFilter = filterMonth.value;
      const catFilter = filterCategory.value;
      const typeFilter = filterType.value;
      const sortVal = sortSelect.value;
  
      let items = expenses.slice();
  
      if(monthFilter && monthFilter !== 'all') items = items.filter(it => it.date.slice(0,7) === monthFilter);
      if(catFilter && catFilter !== 'all') items = items.filter(it => it.category === catFilter);
      if(typeFilter && typeFilter !== 'all') items = items.filter(it => it.type === typeFilter);
      if(q) items = items.filter(it => (it.title + ' ' + (it.notes || '')).toLowerCase().includes(q));
  
      if(sortVal === 'new') items.sort((a,b)=>b.date.localeCompare(a.date) || b.createdAt - a.createdAt);
      if(sortVal === 'old') items.sort((a,b)=>a.date.localeCompare(b.date) || a.createdAt - b.createdAt);
      if(sortVal === 'high') items.sort((a,b)=>b.amount - a.amount);
      if(sortVal === 'low') items.sort((a,b)=>a.amount - b.amount);
  
      listEl.innerHTML = '';
      if(!items.length){ emptyEl.style.display = ''; return; } else { emptyEl.style.display = 'none'; }
  
      items.forEach(it => {
        const cat = DEFAULT_CATEGORIES.find(c => c.id === it.category) || DEFAULT_CATEGORIES[DEFAULT_CATEGORIES.length-1];
        const el = document.createElement('div'); el.className = 'item fade-in';
        el.innerHTML = `
          <div class="meta">
            <div class="dot" style="background:${cat.color}">${cat.icon}</div>
            <div class="info">
              <div class="title">${it.title}</div>
              <div class="sub">${cat.label} • ${it.date} ${it.notes ? ' • '+it.notes : ''}</div>
            </div>
          </div>
          <div class="right">
            <div class="amount" style="color:${it.type==='income'? 'var(--success)' : 'inherit'}">${formatMoneyNative(it.type === 'income' ? it.amount : -Math.abs(it.amount))}</div>
            <div class="actions">
              <button class="ghost" data-edit="${it.id}">Edit</button>
              <button class="ghost danger" data-del="${it.id}">Delete</button>
            </div>
          </div>
        `;
        listEl.appendChild(el);
      });
  
      // attach handlers
      listEl.querySelectorAll('[data-edit]').forEach(btn => {
        btn.onclick = (e) => openEdit(btn.getAttribute('data-edit'));
      });
      listEl.querySelectorAll('[data-del]').forEach(btn => {
        btn.onclick = (e) => {
          const id = btn.getAttribute('data-del');
          if(confirm('Delete this record?')) {
            expenses = expenses.filter(x => x.id !== id);
            saveAll(); renderAll();
          }
        };
      });
    }
  
    function renderFilters(){
      // months present in data
      const months = [...new Set(expenses.map(e => e.date.slice(0,7)))].sort((a,b)=>b.localeCompare(a));
      filterMonth.innerHTML = '<option value="all">All months</option>' + months.map(m => `<option value="${m}">${m}</option>`).join('');
      // categories
      filterCategory.innerHTML = '<option value="all">All categories</option>' + DEFAULT_CATEGORIES.map(c => `<option value="${c.id}">${c.icon} ${c.label}</option>`).join('');
    }
  
    // ---------- charts ----------
    function buildCharts(){
      const pieData = categoryChartData();
      if(pieChart) pieChart.destroy();
      pieChart = new Chart(pieCtx, {
        type:'pie',
        data:{
          labels: pieData.labels,
          datasets: [{ data: pieData.values, backgroundColor: pieData.colors, borderColor:'#fff', borderWidth:1 }]
        },
        options:{ plugins:{ legend:{position:'bottom'} } }
      });
  
      const barData = monthlyChartData();
      if(barChart) barChart.destroy();
      barChart = new Chart(barCtx, {
        type:'bar',
        data:{
          labels: barData.labels,
          datasets: [{ label: 'Net', data: barData.values, backgroundColor: barData.colors }]
        },
        options:{ scales:{ y:{ beginAtZero:true } }, plugins:{ legend:{display:false} } }
      });
    }
  
    function categoryChartData(){
      const month = filterMonth.value || new Date().toISOString().slice(0,7);
      const cats = DEFAULT_CATEGORIES.map(c => c.id);
      const labels = [], values = [], colors = [];
      cats.forEach(id => {
        const v = expenses.filter(e=> e.category === id && e.date.slice(0,7) === month && e.type === 'expense').reduce((s,x)=>s+Number(x.amount||0),0);
        labels.push(id);
        values.push(v);
        const c = DEFAULT_CATEGORIES.find(x => x.id === id).color;
        colors.push(c);
      });
      return { labels, values, colors };
    }
  
    function monthlyChartData(){
      // last 6 months
      const months = [];
      const now = new Date();
      for(let i=5;i>=0;i--){
        const d = new Date(now.getFullYear(), now.getMonth()-i, 1);
        months.push(d.toISOString().slice(0,7));
      }
      const labels = months;
      const values = months.map(m => {
        const income = expenses.filter(e=> e.date.slice(0,7)===m && e.type==='income').reduce((s,x)=>s+Number(x.amount||0),0);
        const expense = expenses.filter(e=> e.date.slice(0,7)===m && e.type==='expense').reduce((s,x)=>s+Number(x.amount||0),0);
        return income - expense;
      });
      const colors = values.map(v => v >= 0 ? 'rgba(16,185,129,0.8)' : 'rgba(239,68,68,0.8)');
      return { labels, values, colors };
    }
  
    // ---------- budget & notifications ----------
    function updateBudgetUI(){
      const month = filterMonth.value && filterMonth.value !== 'all' ? filterMonth.value : new Date().toISOString().slice(0,7);
      const budgetVal = Number(budgets[month] || 0);
      const spent = expenses.filter(e=> e.date.slice(0,7)===month && e.type==='expense').reduce((s,x)=>s+Number(x.amount||0),0);
      const remaining = Math.max(budgetVal - spent, 0);
      const percent = budgetVal > 0 ? Math.min(100, Math.round((spent / budgetVal) * 100)) : 0;
      budgetFill.style.width = percent + '%';
      budgetLabel.textContent = `${formatMoneyNative(spent)} / ${formatMoneyNative(budgetVal)}`;
      // net balance
      const income = expenses.filter(e=> e.date.slice(0,7)===month && e.type==='income').reduce((s,x)=>s+Number(x.amount||0),0);
      netBalanceEl.textContent = formatMoneyNative(income - spent);
  
      // notification if over threshold
      if(budgetVal > 0 && percent >= 90){
        showBudgetWarning(percent, spent, budgetVal);
      }
    }
  
    function showBudgetWarning(percent, spent, budgetVal){
      if(!('Notification' in window)) return;
      if(Notification.permission === 'granted'){
        const title = 'Budget alert';
        const body = `You have used ${percent}% of your budget (${formatMoneyNative(spent)} of ${formatMoneyNative(budgetVal)})`;
        new Notification(title, { body });
      } else {
        Notification.requestPermission();
      }
    }
  
    // ---------- CRUD ----------
    function addExpense(obj){
      const item = Object.assign({ id: uid(), createdAt: Date.now() }, obj);
      expenses.push(item);
      // if recurring checked -> add template
      if(obj.recurring){
        const template = { id: uid(), title: obj.title, amount: obj.amount, category: obj.category, date: obj.date, notes: obj.notes, type: obj.type };
        recurTemplates.push(template);
      }
      saveAll();
      renderAll(true);
    }
  
    function updateExpense(id, changes){
      const idx = expenses.findIndex(e=> e.id===id); if(idx===-1) return;
      expenses[idx] = Object.assign({}, expenses[idx], changes);
      saveAll(); renderAll();
    }
  
    function removeExpense(id){
      expenses = expenses.filter(e=> e.id !== id);
      saveAll(); renderAll();
    }
  
    // ---------- export / import ----------
    function exportCSV(){
      if(!expenses.length) return alert('No records to export');
      const header = ['id','title','amount','category','date','notes','type','createdAt'];
      const rows = expenses.map(r => header.map(h => `"${String(r[h]||'').replace(/"/g,'""')}"`).join(','));
      const csv = [header.join(','), ...rows].join('\n');
      const blob = new Blob([csv], { type:'text/csv' });
      const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'expenses.csv'; a.click();
      URL.revokeObjectURL(a.href);
    }
    function exportJSON(){
      const blob = new Blob([JSON.stringify({ expenses, recurTemplates, budgets }, null, 2)], { type: 'application/json' });
      const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'expenses.json'; a.click();
      URL.revokeObjectURL(a.href);
    }
    function importJSON(file){
      const reader = new FileReader();
      reader.onload = () => {
        try {
          const data = JSON.parse(reader.result);
          if(data.expenses) expenses = data.expenses;
          if(data.recurTemplates) recurTemplates = data.recurTemplates;
          if(data.budgets) budgets = data.budgets;
          saveAll(); renderAll();
          alert('Imported successfully');
        } catch (err) {
          alert('Invalid JSON file');
        }
      };
      reader.readAsText(file);
    }
  
    // ---------- UI actions ----------
    let editingId = null;
    function openAdd(){
      editingId = null;
      $('modalTitle').textContent = 'Add record';
      deleteBtn.style.display = 'none';
      form.reset();
      dateField.value = todayISO();
      modal.style.display = 'flex'; modal.setAttribute('aria-hidden','false');
    }
    function openEdit(id){
      const rec = expenses.find(e=> e.id === id); if(!rec) return;
      editingId = id;
      $('modalTitle').textContent = 'Edit record';
      titleField.value = rec.title; amountField.value = rec.amount; dateField.value = rec.date; categoryField.value = rec.category;
      notesField.value = rec.notes || ''; recurringField.checked = !!rec.templateId; typeField.value = rec.type || 'expense';
      deleteBtn.style.display = '';
      modal.style.display = 'flex'; modal.setAttribute('aria-hidden','false');
    }
    function closeModal(){
      modal.style.display = 'none'; modal.setAttribute('aria-hidden','true');
    }
  
    // ---------- Render all ----------
    function renderAll(skipChart=false){
      renderFilters(); renderList(); renderCategories(); updateBudgetUI();
      if(!skipChart) buildCharts();
    }
  
    // ---------- seed data ----------
    function seedExample(){
      expenses = [
        { id: uid(), title:'Cafeteria', amount:50, category:'Food', date: todayISO(-3), notes:'Lunch', type:'expense', createdAt:Date.now() },
        { id: uid(), title:'Metro', amount:25, category:'Travel', date: todayISO(-2), notes:'Ride', type:'expense', createdAt:Date.now() },
        { id: uid(), title:'Notebook', amount:120, category:'Supplies', date: todayISO(-10), notes:'A4', type:'expense', createdAt:Date.now() },
        { id: uid(), title:'Part-time', amount:3000, category:'Other', date: todayISO(-15), notes:'Freelance', type:'income', createdAt:Date.now() },
      ];
      recurTemplates = [];
      budgets = {};
      saveAll(); renderAll();
    }
  
    // ---------- events ----------
    // FAB / modal
    fab.addEventListener('click', openAdd);
    $('openModalBtn').addEventListener('click', (e)=>{ e.preventDefault(); openAdd(); });
  
    modalClose.addEventListener('click', closeModal);
    window.addEventListener('click', (e)=> { if(e.target === modal) closeModal(); });
  
    form.addEventListener('submit', (ev) => {
      ev.preventDefault();
      const obj = {
        title: titleField.value.trim() || 'Untitled',
        amount: Number(amountField.value) || 0,
        date: dateField.value || todayISO(),
        category: categoryField.value || 'Other',
        notes: notesField.value.trim(),
        type: typeField.value || 'expense'
      };
      if(editingId){
        updateExpense(editingId, obj);
      } else {
        if(recurringField.checked) obj.recurring = true;
        addExpense(obj);
      }
      closeModal();
    });
  
    deleteBtn.addEventListener('click', () => {
      if(!editingId) return;
      if(confirm('Delete record permanently?')) {
        removeExpense(editingId); closeModal();
      }
    });
  
    // quick add
    qAdd.addEventListener('click', (e) => {
      e.preventDefault();
      const t = qTitle.value.trim(); const a = Number(qAmount.value) || 0; const c = qCategory.value; const tp = qType.value;
      if(!t || !a) return alert('Provide title & amount');
      addExpense({ title: t, amount: a, category: c, date: todayISO(), notes:'', type: tp });
      qTitle.value=''; qAmount.value='';
    });
  
    // filters & controls
    [filterMonth, filterCategory, searchEl, sortSelect, filterType].forEach(el => el.addEventListener('input', () => { renderAll(true); buildCharts(); }));
    $('btnSeed').addEventListener('click', seedExample);
    $('btnClear').addEventListener('click', ()=> { if(confirm('Clear all data?')){ expenses=[]; recurTemplates=[]; budgets={}; saveAll(); renderAll(); } });
  
    // export / import
    btnExport.addEventListener('click', exportCSV);
    btnExportJSON.addEventListener('click', exportJSON);
    btnImport.addEventListener('click', ()=> importJson.click());
    importJson.addEventListener('change', (ev) => { const f = ev.target.files[0]; if(!f) return; importJSON(f); ev.target.value = ''; });
  
    // categories click to filter
    document.addEventListener('click', (e) => {
      const badge = e.target.closest('.cat-badge');
      if(!badge) return;
      const cat = badge.dataset.cat;
      filterCategory.value = cat;
      renderAll(true); buildCharts();
    });
  
    // save budget
    saveBudget.addEventListener('click', ()=> {
      const val = Number(budgetInput.value || 0);
      const month = filterMonth.value && filterMonth.value !== 'all' ? filterMonth.value : (new Date()).toISOString().slice(0,7);
      if(val <= 0){ delete budgets[month]; } else budgets[month] = val;
      saveAll(); updateBudgetUI();
      alert('Budget saved for ' + month);
    });
  
    // notification permission on start (ask politely)
    if('Notification' in window && Notification.permission === 'default') {
      setTimeout(()=> Notification.requestPermission(), 2000);
    }
  
    // recurring apply on load
    applyRecurringTemplatesIfNeeded();
  
    // initial population of selects
    buildCategoryOptions(categoryField); buildCategoryOptions(qCategory);
    // set month picker initial
    filterMonth.value = (new Date()).toISOString().slice(0,7);
  
    // theme: apply saved
    const storedTheme = localStorage.getItem(THEME_KEY) || 'light';
    applyTheme(storedTheme);
    themeSwitch.checked = storedTheme === 'dark';
  
    // build charts + render
    renderAll();
    buildCharts();
  
    // ensure UI updates for budget
    updateBudgetUI();
  
    // expose for debugging
    window._tracker = {
      expenses, recurTemplates, budgets, addExpense, updateExpense, removeExpense
    };
  
  })();
  