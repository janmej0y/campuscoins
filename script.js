document.addEventListener('DOMContentLoaded', () => {
    // --- Element Selectors ---
    const expenseForm = document.getElementById('expense-form');
    const expenseList = document.getElementById('expense-list');
    const monthlyTotalEl = document.getElementById('monthly-total');
    const monthFilter = document.getElementById('month-filter');
    const dateInput = document.getElementById('date');
    const toast = document.getElementById('toast');
    const toastMessage = document.getElementById('toast-message');

    // Edit Modal elements
    const editModal = document.getElementById('edit-modal');
    const editForm = document.getElementById('edit-form');
    const cancelEditBtn = document.getElementById('cancel-edit');
    const editId = document.getElementById('edit-id');
    const editDescription = document.getElementById('edit-description');
    const editAmount = document.getElementById('edit-amount');
    const editCategory = document.getElementById('edit-category');
    const editDate = document.getElementById('edit-date');
    
    // Data Management elements
    const exportCsvBtn = document.getElementById('export-csv');
    const importJsonInput = document.getElementById('import-json');

    // --- State Management ---
    let expenses = JSON.parse(localStorage.getItem('expenses')) || [];

    // --- Core Functions ---
    
    function saveExpenses() {
        localStorage.setItem('expenses', JSON.stringify(expenses));
    }

    function renderExpenses(filterMonth = '') {
        expenseList.innerHTML = '';
        let total = 0;
        
        const filteredExpenses = expenses
            .filter(expense => !filterMonth || expense.date.startsWith(filterMonth))
            .sort((a, b) => new Date(b.date) - new Date(a.date));

        if (filteredExpenses.length === 0) {
            expenseList.innerHTML = `<p class="text-gray-400 text-center p-8">No expenses found. Add one to get started!</p>`;
            monthlyTotalEl.textContent = 'Total for this period: $0.00';
            return;
        }

        filteredExpenses.forEach(expense => {
            const expenseEl = document.createElement('div');
            expenseEl.className = 'flex items-center justify-between bg-gray-800 p-4 rounded-lg shadow-md animate-fade-in';
            expenseEl.innerHTML = `
                <div class="flex items-center gap-4 flex-1 min-w-0">
                    <div class="text-2xl">${getCategoryEmoji(expense.category)}</div>
                    <div class="flex-1 min-w-0">
                        <p class="font-semibold text-white truncate">${expense.description}</p>
                        <p class="text-sm text-gray-400">${new Date(expense.date).toLocaleDateString()}</p>
                    </div>
                </div>
                <div class="text-right flex-shrink-0">
                    <p class="font-bold text-lg text-red-400">-$${parseFloat(expense.amount).toFixed(2)}</p>
                    <div class="flex gap-2 mt-1">
                        <button class="edit-btn text-xs text-blue-400 hover:text-blue-300" data-id="${expense.id}">Edit</button>
                        <button class="delete-btn text-xs text-red-400 hover:text-red-300" data-id="${expense.id}">Delete</button>
                    </div>
                </div>
            `;
            expenseList.appendChild(expenseEl);
            total += parseFloat(expense.amount);
        });

        monthlyTotalEl.textContent = `Total for this period: $${total.toFixed(2)}`;
    }

    function populateMonthFilter() {
        const months = new Set(expenses.map(exp => exp.date.substring(0, 7)));
        const sortedMonths = Array.from(months).sort().reverse();
        
        monthFilter.innerHTML = '<option value="">All Months</option>';
        sortedMonths.forEach(month => {
            const [year, monthNum] = month.split('-');
            const date = new Date(year, monthNum - 1, 1);
            const optionText = date.toLocaleString('default', { month: 'long', year: 'numeric' });
            monthFilter.innerHTML += `<option value="${month}">${optionText}</option>`;
        });
    }
    
    function getCategoryEmoji(category) {
        const emojis = {
            'Food': '🍔', 'Transport': '🚌', 'Study': '📚',
            'Entertainment': '🎬', 'Health': '💊', 'Other': '🛒'
        };
        return emojis[category] || '🛒';
    }
    
    function showToast(message, isSuccess = true) {
        toastMessage.textContent = message;
        toast.className = `fixed bottom-5 right-5 text-white py-2 px-4 rounded-lg shadow-lg transition-all duration-300 ${isSuccess ? 'bg-green-500' : 'bg-red-500'}`;
        toast.classList.remove('opacity-0', 'translate-y-10');
        setTimeout(() => {
            toast.classList.add('opacity-0', 'translate-y-10');
        }, 3000);
    }
    
    function openEditModal(id) {
        const expense = expenses.find(exp => exp.id === id);
        if (expense) {
            editId.value = expense.id;
            editDescription.value = expense.description;
            editAmount.value = expense.amount;
            editCategory.value = expense.category;
            editDate.value = expense.date;
            editModal.classList.remove('hidden');
            editModal.classList.add('flex');
        }
    }

    function closeEditModal() {
        editModal.classList.add('hidden');
        editModal.classList.remove('flex');
    }
    
    function updateUI() {
        renderExpenses(monthFilter.value);
        populateMonthFilter();
    }

    // --- Event Listeners ---
    
    expenseForm.addEventListener('submit', e => {
        e.preventDefault();
        const newExpense = {
            id: Date.now(),
            description: document.getElementById('description').value,
            amount: document.getElementById('amount').value,
            category: document.getElementById('category').value,
            date: dateInput.value
        };
        expenses.push(newExpense);
        saveExpenses();
        updateUI();
        expenseForm.reset();
        dateInput.value = new Date().toISOString().split('T')[0];
        showToast('Expense added successfully!');
    });

    monthFilter.addEventListener('change', () => {
        renderExpenses(monthFilter.value);
    });

    expenseList.addEventListener('click', e => {
        const id = parseInt(e.target.dataset.id);
        if (e.target.classList.contains('delete-btn')) {
            expenses = expenses.filter(expense => expense.id !== id);
            saveExpenses();
            updateUI();
            showToast('Expense deleted!', false);
        } else if (e.target.classList.contains('edit-btn')) {
            openEditModal(id);
        }
    });

    editForm.addEventListener('submit', e => {
        e.preventDefault();
        const id = parseInt(editId.value);
        const index = expenses.findIndex(exp => exp.id === id);
        if (index !== -1) {
            expenses[index] = {
                id: id,
                description: editDescription.value,
                amount: editAmount.value,
                category: editCategory.value,
                date: editDate.value
            };
            saveExpenses();
            updateUI();
            closeEditModal();
            showToast('Expense updated successfully!');
        }
    });

    cancelEditBtn.addEventListener('click', closeEditModal);
    
    exportCsvBtn.addEventListener('click', () => {
        if (expenses.length === 0) {
            showToast('No expenses to export.', false);
            return;
        }
        const headers = ['ID', 'Description', 'Amount', 'Category', 'Date'];
        const rows = expenses.map(exp => [exp.id, `"${exp.description}"`, exp.amount, exp.category, exp.date]);
        const csvContent = "data:text/csv;charset=utf-8," + [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
        
        const encodedUri = encodeURI(csvContent);
        const link = document.createElement("a");
        link.setAttribute("href", encodedUri);
        link.setAttribute("download", "expenses.csv");
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        showToast('CSV exported successfully!');
    });

    importJsonInput.addEventListener('change', e => {
        const file = e.target.files[0];
        if (!file) return;
        
        const reader = new FileReader();
        reader.onload = function(event) {
            try {
                const importedExpenses = JSON.parse(event.target.result);
                // Basic validation
                if (Array.isArray(importedExpenses) && importedExpenses.every(exp => 'id' in exp && 'description' in exp)) {
                    expenses = importedExpenses;
                    saveExpenses();
                    updateUI();
                    showToast('Data imported successfully!');
                } else {
                    showToast('Invalid JSON file format.', false);
                }
            } catch (error) {
                showToast('Error reading JSON file.', false);
            }
        };
        reader.readAsText(file);
        importJsonInput.value = ''; // Reset input
    });
    
    // --- Initial Load ---
    dateInput.value = new Date().toISOString().split('T')[0];
    updateUI();
    const currentMonth = new Date().toISOString().substring(0, 7);
    if ([...monthFilter.options].some(o => o.value === currentMonth)) {
        monthFilter.value = currentMonth;
    }
    renderExpenses(monthFilter.value);
});
// Register the service worker for offline support
if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('service-worker.js')
      .then(() => console.log('Service Worker registered'))
      .catch(console.error);
  }
  