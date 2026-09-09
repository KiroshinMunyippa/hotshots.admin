import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { SUPABASE_ACCOUNTS_URL, SUPABASE_ACCOUNTS_ANON_KEY, API_BASE } from './config.js';

const supabase = createClient(SUPABASE_ACCOUNTS_URL, SUPABASE_ACCOUNTS_ANON_KEY);
const app = document.getElementById('app');

const escapeHtml = (value) => String(value ?? '').replace(/[&<>'"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#039;', '"': '&quot;' })[char]);

const showToast = (message) => { 
  const toast = document.getElementById('toast'); 
  toast.textContent = message; 
  toast.classList.add('show'); 
  clearTimeout(showToast.timer); 
  showToast.timer = setTimeout(() => toast.classList.remove('show'), 2600); 
};

const formatDate = (iso) => iso ? new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }) : '—';

const state = {
  session: null, adminProfile: null, authChecked: false, authError: '',
  tab: 'users', 
  users: [], recipes: [], stats: null, analytics: null,
  // NEW: Add state for the new tabs
  moderation: [], audit: [], settings: null, 
  userSearch: '', recipeSearch: '', loading: false
};

async function authFetch(path, options = {}) {
  const token = state.session?.access_token;
  const response = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(options.headers || {}) }
  });
  const text = await response.text();
  const body = text ? JSON.parse(text) : {};
  if (!response.ok) throw new Error(body.error || 'Something went wrong');
  return body;
}

async function checkAdmin() {
  const { data } = await supabase.from('profiles').select('display_name, email, is_admin').eq('id', state.session.user.id).single();
  state.adminProfile = data || null;
  state.authChecked = true;
}
async function loadAll() {
  state.loading = true; render();
  try {
    const [{ users }, { recipes }, stats, analytics] = await Promise.all([ // removed moderation, audit
      authFetch('/api/admin/users'), 
      authFetch('/api/admin/recipes'), 
      authFetch('/api/admin/stats'),
      authFetch('/api/admin/analytics')
      // authFetch('/api/admin/moderation'), // <-- Temporarily disabled
      // authFetch('/api/admin/audit')       // <-- Temporarily disabled
    ]);
    state.users = users; 
    state.recipes = recipes; 
    state.stats = stats;
    state.analytics = analytics;
    // state.moderation = moderation; // <-- Temporarily disabled
    // state.audit = audit;           // <-- Temporarily disabled
  } catch (err) { 
    showToast(err.message); 
  }
  state.loading = false; 
  render();
}

function renderAuth() {
  app.innerHTML = `<div class="auth-shell"><div class="auth-card"><h1>HotShots Admin</h1><p>Sign in with an account flagged as an administrator.</p><form id="admin-login"><div class="field"><label for="admin-email">Email</label><input id="admin-email" name="email" type="email" required autocomplete="email"></div><div class="field"><label for="admin-password">Password</label><input id="admin-password" name="password" type="password" required autocomplete="current-password"></div>${state.authError ? `<p class="auth-error">${escapeHtml(state.authError)}</p>` : ''}<button class="primary-button" type="submit">Sign in</button></form></div></div>`;
}

function renderLocked() {
  app.innerHTML = `<div class="auth-shell"><div class="auth-card"><h1>Not an admin account</h1><p>${escapeHtml(state.adminProfile?.email || state.session?.user?.email || 'This account')} isn't flagged as an administrator.</p><button class="primary-button" id="admin-sign-out" type="button">Sign out</button></div></div>`;
}

function statStrip() {
  if (!state.stats) return '';
  const items = [
    { label: 'Users', value: state.stats.users }, 
    { label: 'Recipes', value: state.stats.recipes },
    { label: 'Shared', value: state.stats.shared }, 
    { label: 'Paid plans', value: state.stats.paid }
  ];
  return `<div class="stat-strip">${items.map(i => `<div class="stat-box"><strong>${i.value}</strong><span>${i.label}</span></div>`).join('')}</div>`;
}

function renderShell(content) {
  app.innerHTML = `<aside class="sidebar">
    <p class="brand">HotShots<span>Admin</span></p>
    <nav class="side-nav">
      <button data-tab="users" class="${state.tab === 'users' ? 'active' : ''}">Users</button>
      <button data-tab="recipes" class="${state.tab === 'recipes' ? 'active' : ''}">Recipes</button>
      <button data-tab="analytics" class="${state.tab === 'analytics' ? 'active' : ''}">Analytics</button>
      <!-- NEW TABS ADDED HERE -->
      <button data-tab="moderation" class="${state.tab === 'moderation' ? 'active' : ''}">Moderation</button>
      <button data-tab="audit" class="${state.tab === 'audit' ? 'active' : ''}">Audit Log</button>
      <button data-tab="settings" class="${state.tab === 'settings' ? 'active' : ''}">Settings</button>
    </nav>
    <div class="sidebar-foot">
      <div class="admin-chip"><strong>${escapeHtml(state.adminProfile?.display_name || 'Admin')}</strong>${escapeHtml(state.adminProfile?.email || '')}</div>
      <button class="sign-out-link" id="admin-sign-out">Sign out</button>
    </div>
  </aside>
  <main class="main">${content}</main>`;
}

function renderUsers() {
  const search = state.userSearch.trim().toLowerCase();
  const rows = state.users.filter(u => !search || u.display_name?.toLowerCase().includes(search) || u.email?.toLowerCase().includes(search));
  
  renderShell(`
    <h1>Users</h1>
    <p class="main-subtitle">Everyone with a HotShots account.</p>
    ${statStrip()}
    <div class="toolbar">
      <input type="search" id="user-search" placeholder="Search by name or email" value="${escapeHtml(state.userSearch)}">
      <!-- NEW EXPORT BUTTON -->
      <button id="export-users-csv" style="margin-left: auto; padding: 8px 16px; background: var(--panel-2); border: 1px solid var(--border); border-radius: 6px; color: var(--text); cursor: pointer;">
        Download CSV
      </button>
    </div>
    <div class="table-card"><table>
      <thead><tr><th>User</th><th>Plan</th><th>Status</th><th>Joined</th><th>Update</th></tr></thead>
      <tbody>
        ${rows.length ? rows.map(u => `
          <tr data-user-row="${u.id}">
            <td class="name-cell"><strong>${escapeHtml(u.display_name)}</strong><small>${escapeHtml(u.email)}</small></td>
            <td><span class="badge plan-${u.subscription_plan}">${escapeHtml(u.subscription_plan)}</span></td>
            <td><span class="badge status-${u.subscription_status}">${escapeHtml(u.subscription_status)}</span></td>
            <td>${formatDate(u.created_at)}</td>
            <td><div class="row-actions">
              <select data-field="subscription_plan"><option value="free" ${u.subscription_plan === 'free' ? 'selected' : ''}>Free</option><option value="plus" ${u.subscription_plan === 'plus' ? 'selected' : ''}>Plus</option><option value="pro" ${u.subscription_plan === 'pro' ? 'selected' : ''}>Pro</option></select>
              <select data-field="subscription_status"><option value="active" ${u.subscription_status === 'active' ? 'selected' : ''}>Active</option><option value="trialing" ${u.subscription_status === 'trialing' ? 'selected' : ''}>Trialing</option><option value="past_due" ${u.subscription_status === 'past_due' ? 'selected' : ''}>Past due</option><option value="canceled" ${u.subscription_status === 'canceled' ? 'selected' : ''}>Canceled</option></select>
              <button class="icon-button save" data-save-user="${u.id}">Save</button>
            </div></td>
          </tr>`).join('') : '<tr class="empty-row"><td colspan="5">No users match that search.</td></tr>'}
      </tbody>
    </table></div>`);
}

function renderRecipes() {
  const search = state.recipeSearch.trim().toLowerCase();
  const rows = state.recipes.filter(r => !search || r.name.toLowerCase().includes(search) || r.author?.display_name?.toLowerCase().includes(search));
  
  renderShell(`
    <h1>Recipes</h1>
    <p class="main-subtitle">Every recipe across the app.</p>
    ${statStrip()}
    <div class="toolbar">
      <input type="search" id="recipe-search" placeholder="Search by name or author" value="${escapeHtml(state.recipeSearch)}">
      <!-- NEW EXPORT BUTTON -->
      <button id="export-recipes-csv" style="margin-left: auto; padding: 8px 16px; background: var(--panel-2); border: 1px solid var(--border); border-radius: 6px; color: var(--text); cursor: pointer;">
        Download CSV
      </button>
    </div>
    <div class="table-card"><table>
      <thead><tr><th>Recipe</th><th>Author</th><th>Visibility</th><th>Created</th><th>Actions</th></tr></thead>
      <tbody>
        ${rows.length ? rows.map(r => `
          <tr>
            <td class="name-cell"><strong>${escapeHtml(r.name)}</strong><small>${escapeHtml(r.category)}</small></td>
            <td class="name-cell"><strong>${escapeHtml(r.author?.display_name || 'Unknown')}</strong></td>
            <td><span class="badge shared-${r.is_shared ? 'yes' : 'no'}">${r.is_shared ? 'Shared' : 'Private'}</span></td>
            <td>${formatDate(r.created_at)}</td>
            <td><div class="row-actions">
              <button class="icon-button" data-toggle-shared="${r.id}" data-currently-shared="${r.is_shared}">${r.is_shared ? 'Hide' : 'Unhide'}</button>
              <button class="icon-button danger" data-delete-recipe="${r.id}">Delete</button>
            </div></td>
          </tr>`).join('') : '<tr class="empty-row"><td colspan="5">No recipes match that search.</td></tr>'}
      </tbody>
    </table></div>`);
}

function renderAnalytics() {
  // FIX 1: Use renderShell instead of return for the loading state
  if (!state.analytics) {
    renderShell('<p class="main-subtitle">Loading analytics...</p>');
    return;
  }
  
  const { totalUsers, recentSignups, planDist, catDist } = state.analytics;

  const renderBar = (label, count, total, colorVar) => {
    const pct = total > 0 ? (count / total) * 100 : 0;
    return `
      <div style="margin-bottom: 12px;">
        <div style="display: flex; justify-content: space-between; font-size: 12px; margin-bottom: 4px;">
          <span style="text-transform: capitalize;">${label}</span>
          <span style="color: var(--muted);">${count} (${pct.toFixed(1)}%)</span>
        </div>
        <div style="height: 8px; background: var(--panel-2); border-radius: 4px; overflow: hidden;">
          <div style="height: 100%; width: ${pct}%; background: var(${colorVar});"></div>
        </div>
      </div>
    `;
  };

  const totalRecipes = Object.values(catDist).reduce((a, b) => a + b, 0);

  // FIX 2: Use renderShell and add the CSV button at the top right
  renderShell(`
    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px;">
      <div>
        <h1 style="margin: 0;">Analytics</h1>
        <p class="main-subtitle" style="margin: 4px 0 0;">Overview of app growth and usage.</p>
      </div>
      <button id="export-analytics-csv" style="padding: 8px 16px; background: var(--panel-2); border: 1px solid var(--border); border-radius: 6px; color: var(--text); cursor: pointer;">
        Download CSV
      </button>
    </div>

    <div class="stat-strip">
      <div class="stat-box"><strong>${totalUsers}</strong><span>Total Users</span></div>
      <div class="stat-box"><strong>${recentSignups}</strong><span>Signups (30d)</span></div>
      <div class="stat-box"><strong>${Object.keys(catDist).length}</strong><span>Active Categories</span></div>
      <div class="stat-box"><strong>${state.stats?.shared || 0}</strong><span>Shared Recipes</span></div>
    </div>

    <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 24px;">
      <div class="table-card" style="padding: 20px;">
        <h3 style="margin: 0 0 16px; font-size: 14px;">Plan Distribution</h3>
        ${Object.entries(planDist).map(([plan, count]) => renderBar(plan, count, totalUsers, '--acid')).join('')}
      </div>
      <div class="table-card" style="padding: 20px;">
        <h3 style="margin: 0 0 16px; font-size: 14px;">Recipe Categories</h3>
        ${Object.entries(catDist).map(([cat, count]) => renderBar(cat, count, totalRecipes, '--warn')).join('')}
      </div>
    </div>
  `);
}

function renderModeration() {
  if (!state.moderation) {
    renderShell('<p class="main-subtitle">Loading moderation queue...</p>');
    return;
  }

  const rows = state.moderation;

  renderShell(`
    <h1>Moderation</h1>
    <p class="main-subtitle">Pending recipe reports requiring your attention.</p>
    <div class="table-card"><table>
      <thead><tr><th>Recipe</th><th>Reason</th><th>Reported On</th><th>Actions</th></tr></thead>
      <tbody>
        ${rows.length ? rows.map(r => `
          <tr data-report-id="${r.id}">
            <td class="name-cell"><strong>${escapeHtml(r.recipe?.name || 'Unknown Recipe')}</strong><small>ID: ${r.recipe?.id || 'N/A'}</small></td>
            <td>${escapeHtml(r.reason || 'No reason provided')}</td>
            <td>${formatDate(r.created_at)}</td>
            <td><div class="row-actions">
              <button class="icon-button" data-action="dismiss" data-report-id="${r.id}">Dismiss</button>
              <button class="icon-button danger" data-action="delete-recipe" data-report-id="${r.id}" data-recipe-id="${r.recipe?.id}">Delete Recipe</button>
            </div></td>
          </tr>
        `).join('') : '<tr class="empty-row"><td colspan="4">No pending reports. Great job!</td></tr>'}
      </tbody>
    </table></div>
  `);
}

function renderAudit() {
  if (!state.audit) {
    renderShell('<p class="main-subtitle">Loading audit logs...</p>');
    return;
  }

  renderShell(`
    <h1>Audit Log</h1>
    <p class="main-subtitle">Recent administrative actions and system events.</p>
    <div class="table-card"><table>
      <thead><tr><th>Timestamp</th><th>Action</th><th>Details</th></tr></thead>
      <tbody>
        ${state.audit.length ? state.audit.map(log => `
          <tr>
            <td>
              ${formatDate(log.created_at)} 
              <br><small style="color: var(--muted);">${new Date(log.created_at).toLocaleTimeString()}</small>
            </td>
            <td>
              <span class="badge" style="background: var(--panel-2); text-transform: capitalize;">
                ${escapeHtml(log.action || log.event || 'unknown')}
              </span>
            </td>
            <td><small>${escapeHtml(log.details || log.metadata || JSON.stringify(log))}</small></td>
          </tr>
        `).join('') : '<tr class="empty-row"><td colspan="3">No audit logs found yet.</td></tr>'}
      </tbody>
    </table></div>
  `);
}

function render() {
  if (!state.session) return renderAuth();
  if (!state.authChecked) { 
    app.innerHTML = '<div class="auth-shell"><p class="main-subtitle">Checking access…</p></div>'; 
    return; 
  }
  if (!state.adminProfile?.is_admin) return renderLocked();
  if (state.loading && !state.stats) { 
    app.innerHTML = '<div class="auth-shell"><p class="main-subtitle">Loading dashboard…</p></div>'; 
    return; 
  }
  
  // NEW: Add placeholders for the new tabs
  if (state.tab === 'settings') return renderShell('<h1>Settings</h1><p class="main-subtitle">App configuration coming soon.</p>');
   if (state.tab === 'audit') return renderAudit();
  if (state.tab === 'moderation') return renderModeration();
  if (state.tab === 'analytics') return renderAnalytics();
  if (state.tab === 'recipes') return renderRecipes();
  return renderUsers();
}

document.addEventListener('click', event => {
  const tab = event.target.closest('[data-tab]');
  if (tab) { 
    state.tab = tab.dataset.tab; 
    return render(); 
  }
  
  if (event.target.closest('#admin-sign-out')) {
    supabase.auth.signOut();
    return;
  }

  const saveUser = event.target.closest('[data-save-user]');
  if (saveUser) {
    const id = saveUser.dataset.saveUser;
    const row = saveUser.closest('[data-user-row]');
    const plan = row.querySelector('[data-field="subscription_plan"]').value;
    const status = row.querySelector('[data-field="subscription_status"]').value;
    authFetch(`/api/admin/users/${id}`, { 
      method: 'PATCH', 
      body: JSON.stringify({ subscription_plan: plan, subscription_status: status }) 
    })
    .then(({ user }) => { 
      state.users = state.users.map(u => u.id === id ? { ...u, ...user } : u); 
      render(); 
      showToast('Updated user'); 
    })
    .catch(err => showToast(err.message));
    return;
  }

  const toggle = event.target.closest('[data-toggle-shared]');
  if (toggle) {
    const id = toggle.dataset.toggleShared;
    const nextShared = toggle.dataset.currentlyShared !== 'true';
    authFetch(`/api/admin/recipes/${id}`, { 
      method: 'PATCH', 
      body: JSON.stringify({ is_shared: nextShared }) 
    })
    .then(() => { 
      state.recipes = state.recipes.map(r => r.id === id ? { ...r, is_shared: nextShared } : r); 
      render(); 
      showToast('Recipe updated'); 
    })
    .catch(err => showToast(err.message));
    return;
  }

  const del = event.target.closest('[data-delete-recipe]');
  if (del) {
    const id = del.dataset.deleteRecipe;
    if (!window.confirm('Delete this recipe?')) return;
    authFetch(`/api/admin/recipes/${id}`, { method: 'DELETE' })
    .then(() => { 
      state.recipes = state.recipes.filter(r => r.id !== id); 
      render(); 
      showToast('Recipe deleted'); 
    })
    .catch(err => showToast(err.message));
    return;
  }
});

document.addEventListener('submit', event => {
  if (event.target.id !== 'admin-login') return;
  event.preventDefault();
  const form = new FormData(event.target);
  state.authError = '';
  supabase.auth.signInWithPassword({ 
    email: form.get('email').trim(), 
    password: form.get('password') 
  })
  .then(({ error }) => { 
    if (error) { 
      state.authError = error.message; 
      render(); 
    } 
  });
});

document.addEventListener('input', event => {
  if (event.target.id === 'user-search') { 
    state.userSearch = event.target.value; 
    return renderUsers(); 
  }
  if (event.target.id === 'recipe-search') { 
    state.recipeSearch = event.target.value; 
    return renderRecipes(); 
  }
});

supabase.auth.onAuthStateChange(async (_event, newSession) => {
  const wasSignedIn = Boolean(state.session);
  state.session = newSession;
  if (newSession && !wasSignedIn) {
    render();
    await checkAdmin();
    if (state.adminProfile?.is_admin) {
      await loadAll(); 
    } else {
      render(); 
    }
  }
  if (!newSession) { 
    state.adminProfile = null; 
    state.authChecked = false; 
    state.users = []; 
    state.recipes = []; 
    state.stats = null; 
    state.analytics = null;
    state.tab = 'users'; 
    render(); 
  }
});

document.addEventListener('click', event => {
  // ... keep your existing event listeners ...

  // NEW: CSV Export Logic
  if (event.target.id === 'export-users-csv') {
    const search = state.userSearch.trim().toLowerCase();
    const rowsToExport = state.users.filter(u => !search || u.display_name?.toLowerCase().includes(search) || u.email?.toLowerCase().includes(search));
    
    if (rowsToExport.length === 0) {
      showToast('No users to export');
      return;
    }

    // Create CSV headers and rows
    const headers = ['ID', 'Display Name', 'Email', 'Plan', 'Status', 'Joined Date'];
    const csvRows = rowsToExport.map(u => [
      u.id, 
      `"${u.display_name || ''}"`, // Quotes prevent commas in names from breaking CSV
      `"${u.email || ''}"`, 
      u.subscription_plan, 
      u.subscription_status, 
      u.created_at
    ]);

    const csvString = [headers.join(','), ...csvRows.map(row => row.join(','))].join('\n');
    
    // Trigger download
    const blob = new Blob([csvString], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.setAttribute('hidden', '');
    a.setAttribute('href', url);
    a.setAttribute('download', 'hotshots_users.csv');
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    showToast('Users exported successfully');
  }
  // MODERATION: Dismiss Report
  const dismissBtn = event.target.closest('[data-action="dismiss"]');
  if (dismissBtn) {
    const reportId = dismissBtn.dataset.reportId;
    authFetch('/api/admin/moderation', { 
      method: 'PATCH', 
      body: JSON.stringify({ reportId, action: 'dismiss' }) 
    })
    .then(() => { 
      state.moderation = state.moderation.filter(r => r.id !== reportId); 
      render(); 
      showToast('Report dismissed'); 
    })
    .catch(err => showToast(err.message));
    return;
  }

  // MODERATION: Delete Recipe
  const deleteRecipeBtn = event.target.closest('[data-action="delete-recipe"]');
  if (deleteRecipeBtn) {
    const reportId = deleteRecipeBtn.dataset.reportId;
    const recipeId = deleteRecipeBtn.dataset.recipeId;
    if (!window.confirm('Are you sure you want to permanently delete this recipe and resolve the report?')) return;
    
    authFetch('/api/admin/moderation', { 
      method: 'PATCH', 
      body: JSON.stringify({ reportId, action: 'delete_recipe', recipeId }) 
    })
    .then(() => { 
      state.moderation = state.moderation.filter(r => r.id !== reportId); 
      state.recipes = state.recipes.filter(r => r.id !== recipeId); // Also remove from recipes tab
      render(); 
      showToast('Recipe deleted and report resolved'); 
    })
    .catch(err => showToast(err.message));
    return;
  }
});

render();
