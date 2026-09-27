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

// Shared <-> hidden is the same flag on the wire (is_shared); we just present
// it to the admin as "Visible" / "Hidden".
const visibilityBadge = (recipe) => recipeShared(recipe)
  ? '<span class="badge shared-yes">Visible</span>'
  : '<span class="badge shared-no">Hidden</span>';

// Shared <-> hidden is the same flag on the wire; different deployments of
// the recipes table have called it `is_shared` or `shared`, so read whichever
// one is present (falling back to "visible").
const recipeShared = (recipe) => Boolean(recipe.is_shared ?? recipe.shared ?? true);

// The fields the inline edit form exposes. `text`/`number` inputs are one-liners,
// `textarea` gets a full-width row. Values come straight off the API row.
const RECIPE_EDIT_FIELDS = [
  { key: 'name', label: 'Name', type: 'text' },
  { key: 'category', label: 'Category', type: 'text' },
  { key: 'cuisine', label: 'Cuisine', type: 'text' },
  { key: 'difficulty', label: 'Difficulty', type: 'text' },
  { key: 'prep_time', label: 'Prep time (min)', type: 'number' },
  { key: 'cook_time', label: 'Cook time (min)', type: 'number' },
  { key: 'servings', label: 'Servings', type: 'number' },
  { key: 'image_url', label: 'Image URL', type: 'text', full: true },
  { key: 'description', label: 'Description', type: 'textarea', full: true }
];

const state = {
  session: null, adminProfile: null, authChecked: false, authError: '',
  tab: 'users', 
  users: [], recipes: [], stats: null, analytics: null,
  moderation: [], audit: [], settings: null,
  // true once /api/admin/audit has answered (successfully or not) -- lets the
  // Audit tab tell "still loading" apart from "loaded, but empty".
  auditLoaded: false,
  userSearch: '', recipeSearch: '', loading: false,
  editingRecipeId: null   // id of the recipe whose inline edit form is open
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
// One request per dataset, each resolving to null on failure instead of
// rejecting -- so one missing table (e.g. audit_logs not created yet) no
// longer blanks out the entire dashboard or leaves a tab stuck on
// "Loading...".
const safeFetch = (path) => authFetch(path).catch(err => {
  console.warn(`[admin] ${path} failed:`, err.message);
  return null;
});

async function loadAll() {
  state.loading = true; render();
  const [usersRes, recipesRes, stats, analytics, moderation, audit] = await Promise.all([
    safeFetch('/api/admin/users'),
    safeFetch('/api/admin/recipes'),
    safeFetch('/api/admin/stats'),
    safeFetch('/api/admin/analytics'),
    safeFetch('/api/admin/moderation'),
    safeFetch('/api/admin/audit')
  ]);
  if (usersRes)   state.users = usersRes.users || [];
  if (recipesRes) state.recipes = recipesRes.recipes || [];
  if (stats)      state.stats = stats;
  if (analytics)  state.analytics = analytics;
  if (moderation) state.moderation = Array.isArray(moderation) ? moderation : (moderation.reports || []);
  if (audit)      state.audit = Array.isArray(audit) ? audit : (audit.logs || []);
  state.auditLoaded = true;
  state.loading = false;
  render();
}

// The audit trail is best-effort: a failed log write must never surface as an
// error toast on top of an action that actually succeeded.
const refreshAuditLog = () => safeFetch('/api/admin/audit')
  .then(res => {
    if (res) state.audit = Array.isArray(res) ? res : (res.logs || []);
    state.auditLoaded = true;
    if (state.tab === 'audit') render();
  })
  .catch(() => {});

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
      <button data-tab="moderation" class="${state.tab === 'moderation' ? 'active' : ''}">Moderation</button>
      <button data-tab="audit" class="${state.tab === 'audit' ? 'active' : ''}">Audit Log</button>
      <button data-tab="settings" class="${state.tab === 'settings' ? 'active' : ''}">Settings</button>
    </nav>
    <div class="sidebar-foot">
      <button id="refresh-data" style="width: 100%; margin-bottom: 12px; padding: 8px; background: var(--panel-2); border: 1px solid var(--border); border-radius: 6px; color: var(--text); cursor: pointer; font-size: 12px;">
        🔄 Refresh Data
      </button>
      <div class="admin-chip"><strong>${escapeHtml(state.adminProfile?.display_name || 'Admin')}</strong>${escapeHtml(state.adminProfile?.email || '')}</div>
      <button class="sign-out-link" id="admin-sign-out">Sign out</button>
    </div>
  </aside>
  <main class="main">${content}</main>`;
}

// Re-render the current tab without throwing away where the user had scrolled
// in the right-hand pane (innerHTML replacement resets it to the top).
function rerenderTab() {
  const main = app.querySelector('.main');
  const scrollTop = main ? main.scrollTop : 0;
  render();
  const newMain = app.querySelector('.main');
  if (newMain) newMain.scrollTop = scrollTop;
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

// One row per recipe; when a row is being edited its edit form is rendered in
// an extra <tr> directly underneath it.
function recipeRow(r) {
  const editing = state.editingRecipeId === r.id;

  const fields = RECIPE_EDIT_FIELDS.map(f => {
    const value = r[f.key] ?? '';
    const input = f.type === 'textarea'
      ? `<textarea data-edit-field="${f.key}" rows="3">${escapeHtml(value)}</textarea>`
      : `<input type="${f.type}" data-edit-field="${f.key}" value="${escapeHtml(value)}">`;
    return `<label class="edit-field ${f.full ? 'full' : ''}"><span>${f.label}</span>${input}</label>`;
  }).join('');

  const shared = recipeShared(r);

  const editRow = editing ? `
    <tr class="edit-row" data-edit-row="${r.id}">
      <td colspan="5">
        <div class="edit-form">
          <div class="edit-grid">${fields}</div>
          <label class="edit-field check"><input type="checkbox" data-edit-field="is_shared" ${shared ? 'checked' : ''}><span>Visible in Explore</span></label>
          <div class="edit-actions">
            <button class="icon-button save" data-save-recipe="${r.id}">Save changes</button>
            <button class="icon-button" data-cancel-edit>Cancel</button>
          </div>
        </div>
      </td>
    </tr>` : '';

  return `
    <tr data-recipe-row="${r.id}" class="${editing ? 'is-editing' : ''}">
      <td class="name-cell"><strong>${escapeHtml(r.name)}</strong><small>${escapeHtml(r.category || 'Uncategorised')}</small></td>
      <td class="name-cell"><strong>${escapeHtml(r.author?.display_name || 'Unknown')}</strong></td>
      <td>${visibilityBadge(r)}</td>
      <td>${formatDate(r.created_at)}</td>
      <td><div class="row-actions">
        <button class="icon-button" data-edit-recipe="${r.id}">${editing ? 'Close' : 'Edit'}</button>
        <button class="icon-button" data-toggle-shared="${r.id}" data-currently-shared="${shared}">${shared ? 'Hide' : 'Unhide'}</button>
        <button class="icon-button danger" data-delete-recipe="${r.id}">Delete</button>
      </div></td>
    </tr>${editRow}`;
}

function renderRecipes() {
  const search = state.recipeSearch.trim().toLowerCase();
  const rows = state.recipes.filter(r => !search
    || r.name?.toLowerCase().includes(search)
    || r.author?.display_name?.toLowerCase().includes(search));

  renderShell(`
    <h1>Recipes</h1>
    <p class="main-subtitle">Every recipe across the app — edit details, hide it from Explore, or delete it.</p>
    ${statStrip()}
    <div class="toolbar">
      <input type="search" id="recipe-search" placeholder="Search by name or author" value="${escapeHtml(state.recipeSearch)}">
      <button id="export-recipes-csv" class="ghost-button">Download CSV</button>
    </div>
    <div class="table-card"><table>
      <thead><tr><th>Recipe</th><th>Author</th><th>Visibility</th><th>Created</th><th>Actions</th></tr></thead>
      <tbody>
        ${rows.length ? rows.map(recipeRow).join('') : '<tr class="empty-row"><td colspan="5">No recipes match that search.</td></tr>'}
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

// Human-readable summary of an audit row. logAudit() writes {admin_email,
// action, details}; older rows may use other shapes, so fall back gracefully.
const auditDetails = (log) => {
  const raw = log.details ?? log.metadata ?? null;
  if (raw && typeof raw === 'object') return JSON.stringify(raw);
  if (typeof raw === 'string' && raw.trim()) return raw;
  const rest = Object.fromEntries(Object.entries(log).filter(([k]) =>
    !['id', 'created_at', 'updated_at', 'action', 'event', 'details', 'metadata'].includes(k)));
  return Object.keys(rest).length ? JSON.stringify(rest) : '\u2014';
};

function renderAudit() {
  // state.audit starts as [] and only stays empty if the request failed or
  // there genuinely are no logs -- never leave the tab stuck on "Loading".
  const loading = state.loading && !state.auditLoaded;
  const rows = state.audit || [];

  renderShell(`
    <h1>Audit Log</h1>
    <p class="main-subtitle">Recent administrative actions and system events.</p>
    ${loading ? '<p class="main-subtitle">Loading audit logs\u2026</p>' : `
    <div class="table-card"><table>
      <thead><tr><th>Timestamp</th><th>Admin</th><th>Action</th><th>Details</th></tr></thead>
      <tbody>
        ${rows.length ? rows.map(log => `
          <tr>
            <td>
              ${formatDate(log.created_at)}
              <br><small style="color: var(--muted);">${log.created_at ? new Date(log.created_at).toLocaleTimeString() : ''}</small>
            </td>
            <td>${escapeHtml(log.admin_email || log.admin || '\u2014')}</td>
            <td>
              <span class="badge" style="background: var(--panel-2); text-transform: capitalize;">
                ${escapeHtml((log.action || log.event || 'unknown').replace(/_/g, ' '))}
              </span>
            </td>
            <td><small>${escapeHtml(auditDetails(log))}</small></td>
          </tr>
        `).join('') : '<tr class="empty-row"><td colspan="4">No audit logs found yet. They appear here as soon as you edit, hide or delete a recipe.</td></tr>'}
      </tbody>
    </table></div>`}
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
    state.editingRecipeId = null;   // switching tabs closes any open edit form
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

    // REFRESH DATA BUTTON
  if (event.target.id === 'refresh-data') {
    showToast('Refreshing data...');
    return loadAll();
  }
  
  // Hide / unhide straight from the row -- no need to open the edit form.
  const toggle = event.target.closest('[data-toggle-shared]');
  if (toggle) {
    const id = toggle.dataset.toggleShared;
    const nextShared = toggle.dataset.currentlyShared !== 'true';
    toggle.disabled = true;
    authFetch(`/api/admin/recipes/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ is_shared: nextShared })
    })
    .then(({ recipe }) => {
      state.recipes = state.recipes.map(r => r.id === id
        ? { ...r, ...(recipe || {}), is_shared: recipe?.is_shared ?? nextShared }
        : r);
      if (state.editingRecipeId === id) state.editingRecipeId = null;
      rerenderTab();
      showToast(nextShared ? 'Recipe unhidden \u2014 visible in Explore' : 'Recipe hidden from Explore');
      refreshAuditLog();
    })
    .catch(err => {
      toggle.disabled = false;
      showToast(err.message);
    });
    return;
  }

  // OPEN / CLOSE a recipe's inline edit form
  const editBtn = event.target.closest('[data-edit-recipe]');
  if (editBtn) {
    const id = editBtn.dataset.editRecipe;
    state.editingRecipeId = state.editingRecipeId === id ? null : id;
    rerenderTab();
    const openedRow = state.editingRecipeId && app.querySelector(`[data-edit-row="${state.editingRecipeId}"]`);
    if (openedRow) openedRow.scrollIntoView({ block: 'nearest' });
    return;
  }

  if (event.target.closest('[data-cancel-edit]')) {
    state.editingRecipeId = null;
    rerenderTab();
    return;
  }

  // SAVE recipe edits -- only the fields that actually changed get sent
  const saveRecipe = event.target.closest('[data-save-recipe]');
  if (saveRecipe) {
    const id = saveRecipe.dataset.saveRecipe;
    const original = state.recipes.find(r => r.id === id);
    if (!original) return;
    const container = saveRecipe.closest('.edit-form');

    const payload = {};
    RECIPE_EDIT_FIELDS.forEach(f => {
      const input = container.querySelector(`[data-edit-field="${f.key}"]`);
      if (!input) return;
      const value = f.type === 'number'
        ? (input.value === '' ? null : Number(input.value))
        : input.value.trim();
      // Compare against what the row actually holds right now, whichever of
      // `is_shared` / `shared` this deployment uses.
      if (value !== (original[f.key] ?? '')) payload[f.key] = value;
    });

    const sharedInput = container.querySelector('[data-edit-field="is_shared"]');
    if (sharedInput && Boolean(sharedInput.checked) !== recipeShared(original)) {
      payload.is_shared = sharedInput.checked;
    }

    if (!Object.keys(payload).length) {
      showToast('Nothing to save');
      return;
    }

    saveRecipe.disabled = true;
    authFetch(`/api/admin/recipes/${id}`, { method: 'PATCH', body: JSON.stringify(payload) })
      .then(({ recipe }) => {
        // Merge whatever the server confirmed over the cached row, so the table
        // shows saved values without waiting for a full reload.
        state.recipes = state.recipes.map(r => r.id === id ? { ...r, ...(recipe || payload) } : r);
        state.editingRecipeId = null;
        rerenderTab();
        showToast('Recipe updated');
        refreshAuditLog();
      })
      .catch(err => {
        saveRecipe.disabled = false;
        showToast(err.message);
      });
    return;
  }

  const del = event.target.closest('[data-delete-recipe]');
  if (del) {
    const id = del.dataset.deleteRecipe;
    const recipe = state.recipes.find(r => r.id === id);
    const label = recipe ? `"${recipe.name}"` : 'this recipe';
    if (!window.confirm(`Delete ${label}? This can't be undone.`)) return;
    del.disabled = true;
    authFetch(`/api/admin/recipes/${id}`, { method: 'DELETE' })
    .then(() => {
      state.recipes = state.recipes.filter(r => r.id !== id);
      if (state.editingRecipeId === id) state.editingRecipeId = null;
      rerenderTab();
      showToast('Recipe deleted');
      refreshAuditLog();
    })
    .catch(err => {
      del.disabled = false;
      showToast(err.message);
    });
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

// Typing in a search box re-renders the table, so keep the scroll position of
// the right-hand pane instead of jumping back to the top on every keystroke.
document.addEventListener('input', event => {
  if (event.target.id === 'user-search') { 
    state.userSearch = event.target.value; 
    return rerenderTab(); 
  }
  if (event.target.id === 'recipe-search') { 
    state.recipeSearch = event.target.value; 
    return rerenderTab(); 
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
