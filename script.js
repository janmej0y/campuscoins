(() => {
  let currentPage = 1;
const ITEMS_PER_PAGE = 10; // show 10 items per page

  // ---------- Helpers ----------
  const $ = id => document.getElementById(id);
  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2,6);

  // ---------- Locale & currency ----------
  const locale = navigator.language || 'en-US';
  const currency = locale.includes('IN') ? 'INR' : 'USD';
  const formatMoney = value => {
    try {
      return new Intl.NumberFormat(locale, { style: 'currency', currency }).format(Number(value || 0));
    } catch {
      return `₹${Number(value||0).toFixed(2)}`;
    }
  };

  // ---------- Storage keys ----------
  const STORAGE_KEY = 'exp_v2_data';
  const TEMPLATE_KEY = 'exp_v2_recur_templates';
  const LAST_RECURRING = 'exp_v2_last_recurr';
  const THEME_KEY = 'exp_v2_theme';
  const BUDGETS_KEY = 'exp_v2_budgets';

  // ---------- Default categories ----------
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
  let budgets = JSON.parse(localStorage.getItem(BUDGETS_KEY) || '{}');
  let pieChart = null, barChart = null;

  // ---------- DOM references ----------
  const listEl = $('list'), emptyEl = $('empty');
  const filterMonth = $('filterMonth'), filterCategory = $('filterCategory'), searchEl = $('search');
  const qCategory = $('qCategory'), qTitle = $('qTitle'), qAmount = $('qAmount'), qType = $('qType'), qAdd = $('qAdd');
  const btnSeed = $('btnSeed'), btnClear = $('btnClear');
  const btnExport = $('btnExport'), btnExportJSON = $('btnExportJSON'), btnImport = $('btnImport'), importJson = $('importJson');
  const fab = $('fab'), modal = $('modal'), modalClose = $('modalClose'), form = $('form');
  const titleField = $('title'), amountField = $('amount'), dateField = $('date'), categoryField = $('category'), notesField = $('notes'), recurringField = $('recurring'), typeField = $('type'), deleteBtn = $('deleteBtn');
  const categoriesEl = $('categories'), filterType = $('typeFilter'), sortSelect = $('sort');
  const budgetInput = $('budgetInput'), saveBudget = $('saveBudget');
  const budgetFill = $('budgetFill'), budgetLabel = $('budgetLabel'), netBalanceEl = $('netBalance');
  const pieCtx = document.getElementById('pieChart').getContext('2d');
  const barCtx = document.getElementById('barChart').getContext('2d');
  const themeSwitch = $('themeSwitch');

  // ---------- Theme ----------
  function applyTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem(THEME_KEY, theme);
    if(theme==='dark') {
      document.body.style.background = 'linear-gradient(180deg,#071029,#071629)';
      document.body.style.color = '#e6eef8';
    } else {
      document.body.style.background = 'linear-gradient(180deg,#f6f9fc,#eef2ff)';
      document.body.style.color = '#0f172a';
    }
  }
  themeSwitch.addEventListener('change', () => applyTheme(themeSwitch.checked ? 'dark' : 'light'));
  applyTheme(localStorage.getItem(THEME_KEY) || 'light');
  themeSwitch.checked = localStorage.getItem(THEME_KEY) === 'dark';

  // ---------- Utilities ----------
  function saveAll() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(expenses));
    localStorage.setItem(TEMPLATE_KEY, JSON.stringify(recurTemplates));
    localStorage.setItem(BUDGETS_KEY, JSON.stringify(budgets));
  }
  const todayISO = offset => {
    const d = new Date(); d.setDate(d.getDate() + (offset||0));
    return d.toISOString().slice(0,10);
  };
  const monthKey = date => (date||todayISO()).slice(0,7);

  // ---------- Recurring ----------
  function applyRecurringTemplatesIfNeeded() {
    const lastRun = localStorage.getItem(LAST_RECURRING) || '';
    const currentMonth = new Date().toISOString().slice(0,7);
    if(lastRun === currentMonth) return;
    recurTemplates.forEach(t => {
      const day = (t.date || todayISO()).slice(8,10);
      const newDate = `${currentMonth}-${day}`;
      const exists = expenses.some(e => e.templateId === t.id && e.date.slice(0,7) === currentMonth);
      if(!exists){
        expenses.push({
          id: uid(), title: t.title, amount: t.amount, category: t.category,
          date: newDate, notes: t.notes, type: t.type, createdAt: Date.now(), templateId: t.id
        });
      }
    });
    localStorage.setItem(LAST_RECURRING, currentMonth);
    saveAll();
  }

  // ---------- Render ----------
  function buildCategoryOptions(selectEl) {
    selectEl.innerHTML = DEFAULT_CATEGORIES.map(c => `<option value="${c.id}">${c.icon} ${c.label}</option>`).join('');
  }

  function renderCategories() {
    categoriesEl.innerHTML = DEFAULT_CATEGORIES.map(c => {
      const total = totalByCategory(c.id);
      return `<div class="cat-badge" data-cat="${c.id}">
                <div class="cat-color" style="background:${c.color}">${c.icon}</div>
                <div>
                  <div style="font-weight:700">${c.label}</div>
                  <div class="small muted">${formatMoney(total)}</div>
                </div>
              </div>`;
    }).join('');
  }

  function totalByCategory(catId) {
    const month = filterMonth.value !== 'all' ? filterMonth.value : monthKey();
    return expenses.filter(e => e.category === catId && e.date.slice(0,7) === month && e.type === 'expense')
                   .reduce((s,x)=>s+Number(x.amount||0),0);
  }

  function renderFilters() {
    const months = [...new Set(expenses.map(e => e.date.slice(0,7)))].sort((a,b)=>b.localeCompare(a));
    filterMonth.innerHTML = '<option value="all">All months</option>' + months.map(m=>`<option value="${m}">${m}</option>`).join('');
    filterCategory.innerHTML = '<option value="all">All categories</option>' + DEFAULT_CATEGORIES.map(c=>`<option value="${c.id}">${c.icon} ${c.label}</option>`).join('');
  }

  function renderList(){
    const q = (searchEl.value || '').toLowerCase();
    const monthFilter = filterMonth.value;
    const catFilter = filterCategory.value;
    const typeFilterVal = filterType.value;
    const sortVal = sortSelect.value;
  
    let items = expenses.slice();
  
    if(monthFilter && monthFilter !== 'all') items = items.filter(it => it.date.slice(0,7) === monthFilter);
    if(catFilter && catFilter !== 'all') items = items.filter(it => it.category === catFilter);
    if(typeFilterVal && typeFilterVal !== 'all') items = items.filter(it => it.type === typeFilterVal);
    if(q) items = items.filter(it => (it.title + ' ' + (it.notes || '')).toLowerCase().includes(q));
  
    if(sortVal === 'new') items.sort((a,b)=>b.date.localeCompare(a.date) || b.createdAt - a.createdAt);
    if(sortVal === 'old') items.sort((a,b)=>a.date.localeCompare(b.date) || a.createdAt - b.createdAt);
    if(sortVal === 'high') items.sort((a,b)=>b.amount - a.amount);
    if(sortVal === 'low') items.sort((a,b)=>a.amount - b.amount);
  
    const totalPages = Math.ceil(items.length / ITEMS_PER_PAGE);
    if(currentPage > totalPages) currentPage = totalPages || 1;
  
    const startIdx = (currentPage - 1) * ITEMS_PER_PAGE;
    const pagedItems = items.slice(startIdx, startIdx + ITEMS_PER_PAGE);
  
    listEl.innerHTML = '';
    if(!items.length){ emptyEl.style.display = ''; return; } else { emptyEl.style.display = 'none'; }
  
    pagedItems.forEach(it => {
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
      btn.onclick = () => openEdit(btn.getAttribute('data-edit'));
    });
    listEl.querySelectorAll('[data-del]').forEach(btn => {
      btn.onclick = () => {
        const id = btn.getAttribute('data-del');
        if(confirm('Delete this record?')) {
          expenses = expenses.filter(x => x.id !== id);
          saveAll(); renderAll();
        }
      };
    });
  
    renderPagination(totalPages);
  }
  function renderPagination(totalPages){
    let pagContainer = document.getElementById('pagination');
    if(!pagContainer){
      pagContainer = document.createElement('div');
      pagContainer.id = 'pagination';
      pagContainer.style.marginTop = '12px';
      pagContainer.style.display = 'flex';
      pagContainer.style.justifyContent = 'center';
      pagContainer.style.gap = '6px';
      listEl.parentNode.appendChild(pagContainer);
    }
    pagContainer.innerHTML = '';
  
    if(totalPages <= 1) return;
  
    for(let i=1; i<=totalPages; i++){
      const btn = document.createElement('button');
      btn.textContent = i;
      btn.className = 'ghost';
      if(i === currentPage) btn.style.fontWeight = '700';
      btn.onclick = () => { currentPage = i; renderList(); };
      pagContainer.appendChild(btn);
    }
  }
  
  function buildCharts() {
    const pieData = { labels:[], values:[], colors:[] };
    const month = filterMonth.value !== 'all' ? filterMonth.value : monthKey();
    DEFAULT_CATEGORIES.forEach(c=>{
      const v = expenses.filter(e=>e.category===c.id && e.date.slice(0,7)===month && e.type==='expense')
                        .reduce((s,x)=>s+Number(x.amount||0),0);
      pieData.labels.push(c.label); pieData.values.push(v); pieData.colors.push(c.color);
    });
    if(pieChart) pieChart.destroy();
    pieChart = new Chart(pieCtx,{type:'pie', data:{labels:pieData.labels, datasets:[{data:pieData.values, backgroundColor:pieData.colors, borderColor:'#fff'}]}, options:{plugins:{legend:{position:'bottom'}}}});

    const months = [];
    const now = new Date();
    for(let i=5;i>=0;i--){ const d=new Date(now.getFullYear(),now.getMonth()-i,1); months.push(d.toISOString().slice(0,7)); }
    const barValues = months.map(m=>{
      const income = expenses.filter(e=>e.date.slice(0,7)===m && e.type==='income').reduce((s,x)=>s+Number(x.amount||0),0);
      const expense = expenses.filter(e=>e.date.slice(0,7)===m && e.type==='expense').reduce((s,x)=>s+Number(x.amount||0),0);
      return income-expense;
    });
    const colors = barValues.map(v=>v>=0?'rgba(16,185,129,0.8)':'rgba(239,68,68,0.8)');
    if(barChart) barChart.destroy();
    barChart = new Chart(barCtx,{type:'bar', data:{labels:months, datasets:[{label:'Net', data:barValues, backgroundColor:colors}]}, options:{scales:{y:{beginAtZero:true}}, plugins:{legend:{display:false}}}});
  }

  function updateBudgetUI() {
    const month = filterMonth.value !== 'all' ? filterMonth.value : monthKey();
    const budgetVal = Number(budgets[month]||0);
    const spent = expenses.filter(e=>e.date.slice(0,7)===month && e.type==='expense').reduce((s,x)=>s+Number(x.amount||0),0);
    budgetFill.style.width = budgetVal>0 ? Math.min(100, Math.round((spent/budgetVal)*100))+'%' : '0%';
    budgetLabel.textContent = `${formatMoney(spent)} / ${formatMoney(budgetVal)}`;

    const income = expenses.filter(e=>e.date.slice(0,7)===month && e.type==='income').reduce((s,x)=>s+Number(x.amount||0),0);
    netBalanceEl.textContent = formatMoney(income-spent);

    if(budgetVal>0 && spent/budgetVal>=0.9) showBudgetWarning(spent, budgetVal);
  }

  function showBudgetWarning(spent, budgetVal) {
    if(!('Notification' in window)) return;
    if(Notification.permission==='granted'){
      new Notification('Budget alert', { body:`You have used ${formatMoney(spent)} of ${formatMoney(budgetVal)}` });
    } else {
      Notification.requestPermission();
    }
  }

  // ---------- CRUD ----------
  let editingId = null;
  function openAdd(){
    editingId=null;
    $('modalTitle').textContent='Add record';
    deleteBtn.style.display='none';
    form.reset(); dateField.value=todayISO(); modal.style.display='flex';
  }
  function openEdit(id){
    const rec = expenses.find(e=>e.id===id); if(!rec) return;
    editingId=id;
    $('modalTitle').textContent='Edit record';
    titleField.value=rec.title; amountField.value=rec.amount; dateField.value=rec.date; categoryField.value=rec.category;
    notesField.value=rec.notes||''; recurringField.checked=!!rec.templateId; typeField.value=rec.type||'expense';
    deleteBtn.style.display=''; modal.style.display='flex';
  }
  function closeModal(){ modal.style.display='none'; }

  function addExpense(obj){
    const item={id:uid(), createdAt:Date.now(), ...obj};
    expenses.push(item);
    if(obj.recurring){
      recurTemplates.push({ id:uid(), title:obj.title, amount:obj.amount, category:obj.category, date:obj.date, notes:obj.notes, type:obj.type });
    }
    saveAll(); renderAll();
  }

  function updateExpense(id,obj){
    const idx = expenses.findIndex(e=>e.id===id); if(idx===-1) return;
    expenses[idx] = {...expenses[idx], ...obj};
    saveAll(); renderAll();
  }

  function removeExpense(id){
    expenses = expenses.filter(e=>e.id!==id); saveAll(); renderAll();
  }

  // ---------- Export / Import ----------
  function exportCSV(){
    if(!expenses.length){ alert('No records to export'); return; }
    const header = ['id','title','amount','category','date','notes','type','createdAt'];
    const rows = expenses.map(r=>header.map(h=>`"${String(r[h]||'').replace(/"/g,'""')}"`).join(','));
    const blob = new Blob([header.join(',')+'\n'+rows.join('\n')], { type:'text/csv' });
    const a = document.createElement('a'); a.href=URL.createObjectURL(blob); a.download='expenses.csv'; a.click();
  }

  function exportJSON(){
    const blob = new Blob([JSON.stringify({ expenses,recurTemplates,budgets },null,2)], { type:'application/json' });
    const a=document.createElement('a'); a.href=URL.createObjectURL(blob); a.download='expenses.json'; a.click();
  }

  function importJSON(file){
    const reader = new FileReader();
    reader.onload = ()=> {
      try{
        const data=JSON.parse(reader.result);
        if(data.expenses) expenses=data.expenses;
        if(data.recurTemplates) recurTemplates=data.recurTemplates;
        if(data.budgets) budgets=data.budgets;
        saveAll(); renderAll(); alert('Imported successfully');
      } catch(e){ alert('Invalid JSON file'); }
    };
    reader.readAsText(file);
  }

  // ---------- Event listeners ----------
  filterMonth.onchange = ()=>{ renderAll(); };
  filterCategory.onchange = ()=>{ renderAll(); };
  searchEl.oninput = ()=>{ renderList(); buildCharts(); renderCategories(); updateBudgetUI(); };
  filterType.onchange = ()=>{ renderList(); buildCharts(); renderCategories(); updateBudgetUI(); };
  sortSelect.onchange = ()=>{ renderList(); };

  fab.onclick = openAdd;
  modalClose.onclick = closeModal;
  window.onclick = e=>{ if(e.target===modal) closeModal(); };

  form.onsubmit = e=>{
    e.preventDefault();
    const obj={ title:titleField.value, amount:Number(amountField.value), date:dateField.value, category:categoryField.value, notes:notesField.value, type:typeField.value, recurring:recurringField.checked };
    if(editingId) updateExpense(editingId,obj); else addExpense(obj);
    closeModal();
  };

  deleteBtn.onclick = ()=>{
    if(editingId && confirm('Delete this record?')){ removeExpense(editingId); closeModal(); }
  };

  // Quick add
  qAdd.onclick = e=>{ e.preventDefault(); const obj={ title:qTitle.value, amount:Number(qAmount.value), category:qCategory.value, type:qType.value, date:todayISO() }; addExpense(obj); qTitle.value=''; qAmount.value=''; };

  btnSeed.onclick = ()=>{ DEFAULT_CATEGORIES.forEach(c=>addExpense({ title:c.label+' sample', amount:Math.floor(Math.random()*500), category:c.id, date:todayISO(), type:'expense' })); };
  btnClear.onclick = ()=>{ if(confirm('Clear all records?')){ expenses=[]; saveAll(); renderAll(); } };
  btnExport.onclick=exportCSV;
  btnExportJSON.onclick=exportJSON;
  btnImport.onclick=()=>importJson.click();
  importJson.onchange = ()=>{ if(importJson.files.length) importJSON(importJson.files[0]); };
  saveBudget.onclick=()=>{ budgets[monthKey()] = Number(budgetInput.value||0); saveAll(); updateBudgetUI(); };

  // ---------- Initial render ----------
  buildCategoryOptions(categoryField);
  buildCategoryOptions(qCategory);
  applyRecurringTemplatesIfNeeded();

  function renderAll(){
    renderFilters();
    renderList();
    renderCategories();
    buildCharts();
    updateBudgetUI();
  }

  renderAll();
})();
