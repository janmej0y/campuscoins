(() => {
    // ---------- Helpers ----------
    const $ = id => document.getElementById(id);
    const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2,6);
  
    const locale = navigator.language || 'en-US';
    const currency = (locale && locale.includes('IN')) ? 'INR' : 'USD';
    const formatMoney = (value) => {
      try {
        return new Intl.NumberFormat(locale, { style: 'currency', currency }).format(value);
      } catch {
        return (value >= 0 ? '₹' : '-₹') + Math.abs(value).toFixed(2);
      }
    };
  
    // ---------- Storage ----------
    const STORAGE_KEY = 'exp_v2_data';
    const TEMPLATE_KEY = 'exp_v2_recur_templates';
    const LAST_RECURRING_RUN = 'exp_v2_last_recurr';
    const THEME_KEY = 'exp_v2_theme';
    const BUDGETS_KEY = 'exp_v2_budgets';
  
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
  
    let currentPage = 1;
    const itemsPerPage = 10;
  
    // ---------- DOM refs ----------
    const listEl = $('list'), emptyEl = $('empty'), paginationEl = document.createElement('div');
    paginationEl.id = 'pagination'; paginationEl.style.marginTop='12px';
    listEl.parentNode.appendChild(paginationEl);
  
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
    themeSwitch.checked = savedTheme==='dark';
    applyTheme(savedTheme);
    themeSwitch.addEventListener('change', () => applyTheme(themeSwitch.checked ? 'dark' : 'light'));
  
    // ---------- Utilities ----------
    function saveAll(){
      localStorage.setItem(STORAGE_KEY, JSON.stringify(expenses));
      localStorage.setItem(TEMPLATE_KEY, JSON.stringify(recurTemplates));
      localStorage.setItem(BUDGETS_KEY, JSON.stringify(budgets));
    }
  
    function todayISO(offsetDays = 0){
      const d = new Date(); d.setDate(d.getDate()+offsetDays);
      return d.toISOString().slice(0,10);
    }
  
    function monthKeyFromDate(dateStr){
      return (dateStr || todayISO()).slice(0,7);
    }
  
    // ---------- List filtering ----------
    function filteredExpenses(){
      const q = (searchEl.value || '').toLowerCase();
      const monthFilter = filterMonth.value;
      const catFilter = filterCategory.value;
      const typeFilterVal = filterType.value;
      const sortVal = sortSelect.value;
  
      let items = expenses.slice();
      if(monthFilter && monthFilter!=='all') items = items.filter(it => it.date.slice(0,7)===monthFilter);
      if(catFilter && catFilter!=='all') items = items.filter(it => it.category===catFilter);
      if(typeFilterVal && typeFilterVal!=='all') items = items.filter(it => it.type===typeFilterVal);
      if(q) items = items.filter(it => (it.title+' '+(it.notes||'')).toLowerCase().includes(q));
  
      if(sortVal==='new') items.sort((a,b)=>b.date.localeCompare(a.date)||b.createdAt-a.createdAt);
      if(sortVal==='old') items.sort((a,b)=>a.date.localeCompare(b.date)||a.createdAt-b.createdAt);
      if(sortVal==='high') items.sort((a,b)=>b.amount-a.amount);
      if(sortVal==='low') items.sort((a,b)=>a.amount-b.amount);
  
      return items;
    }
  
    function renderList(){
      const items = filteredExpenses();
      const totalPages = Math.ceil(items.length/itemsPerPage);
      const start = (currentPage-1)*itemsPerPage;
      const end = start+itemsPerPage;
      const pageItems = items.slice(start,end);
  
      listEl.innerHTML = '';
      if(!items.length){ emptyEl.style.display=''; paginationEl.innerHTML=''; return; } 
      else { emptyEl.style.display='none'; }
  
      pageItems.forEach(it=>{
        const cat = DEFAULT_CATEGORIES.find(c=>c.id===it.category)||DEFAULT_CATEGORIES[DEFAULT_CATEGORIES.length-1];
        const el = document.createElement('div'); el.className='item fade-in';
        el.innerHTML = `
          <div class="meta">
            <div class="dot" style="background:${cat.color}">${cat.icon}</div>
            <div class="info">
              <div class="title">${it.title}</div>
              <div class="sub">${cat.label} • ${it.date} • ${it.notes||''}</div>
            </div>
          </div>
          <div class="right">
            <div class="amount" style="color:${it.type==='income'?'var(--success)':'inherit'}">
              ${formatMoney(it.type==='income'? it.amount : -Math.abs(it.amount))}
            </div>
            <div class="actions">
              <button class="ghost" data-edit="${it.id}">Edit</button>
              <button class="ghost danger" data-del="${it.id}">Delete</button>
            </div>
          </div>
        `;
        listEl.appendChild(el);
      });
  
      // attach edit/delete
      listEl.querySelectorAll('[data-edit]').forEach(btn=>btn.onclick=()=>openEdit(btn.getAttribute('data-edit')));
      listEl.querySelectorAll('[data-del]').forEach(btn=>{
        btn.onclick=()=>{
          const id=btn.getAttribute('data-del');
          if(confirm('Delete this record?')){
            expenses = expenses.filter(x=>x.id!==id);
            saveAll(); renderAll();
          }
        };
      });
  
      // pagination buttons
      renderPagination(totalPages);
    }
  
    function renderPagination(totalPages){
      paginationEl.innerHTML='';
      for(let i=1;i<=totalPages;i++){
        const btn=document.createElement('button');
        btn.textContent=i;
        btn.disabled=i===currentPage;
        btn.style.margin='0 3px';
        btn.onclick=()=>{ currentPage=i; renderList(); };
        paginationEl.appendChild(btn);
      }
    }
  
    // ---------- Other render functions ----------
    function buildCategoryOptions(selectEl){
      selectEl.innerHTML = DEFAULT_CATEGORIES.map(c=>`<option value="${c.id}">${c.icon} ${c.label}</option>`).join('');
    }
  
    // ... keep all other functions (charts, budget, add/update/remove, export/import) as in your original script
  
    // ---------- Event listeners ----------
    [filterMonth, filterCategory, searchEl, sortSelect, filterType].forEach(el=>{
      el.addEventListener('input',()=>{ currentPage=1; renderList(); });
    });
  
    // Initialize selects
    buildCategoryOptions(categoryField); buildCategoryOptions(qCategory);
    filterMonth.value = (new Date()).toISOString().slice(0,7);
  
    renderList();
  
  })();
  