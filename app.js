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
  session: null,
  adminProfile: null,
  authChecked: false,
  authError: '',
  tab: 'users',
  users: [],
  recipes: [],
  stats: null,
  userSearch: '',
  recipeSearch: '',
  loading: false
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
  state.loading = true;
  render();
  try {
    const [{ users }, { recipes }, stats] = await Promise.all([
      authFetch('/api/admin/users'),
      authFetch('/api/admin/recipes'),
      authFetch('/api/admin/stats')
    ]);
    state.users = users;
    state.recipes = recipes;
    state.stats = stats;
  } catch (err) {
    showToast(err.message);
  }
  state.loading = false;
  render();
}

function renderAuth() {
  app.innerHTML = `<div class="auth-shell"><div class="auth-card"><h1>HotShots Admin</h1><p>Sign in with an account flagged as an administrator.</p><form id="admin-login"><div class="field"><label for="admin-email">Email</label><input id="admin-email" name="email" type="email" required></div><div class="field"><label for="admin-password">Password</label><input id="admin-password" name="password" type="password" required></div>${state.authError ? `<p class="auth-error">${escapeHtml(state.authError)}</p>` : ''}<button class="primary-button" type="submit">Sign in</button></form></div></div>`;
}

function renderLocked() {
  app.innerHTML = `<div class="auth-shell"><div class="auth-card"><h1>Not an admin account</h1><p>${escapeHtml(state.adminProfile?.email || 'This account')} isn't flagged as an administrator.</p><button class="primary-button" id="admin-sign-out" type="button">Sign out</button></div></div>`;
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
  app.innerHTML = `<aside class="sidebar"><p class="brand">HotShots<span>Admin</span></p><nav class="side-nav"><button data-tab="users" class="${state.tab === 'users' ? 'active' : ''}">Users</button><button data-tab="recipes" class="${state.tab === 'recipes' ? 'active' : ''}">Recipes</button></nav><div class="sidebar-foot"><div class="admin-chip"><strong>${escapeHtml(state.adminProfile?.display_name || 'Admin')}</strong>${escapeHtml(state.adminProfile?.email || '')}</div><button class="sign-out-link" id="admin-sign-out">Sign out</button></div></aside><main class="main">${content}</main>`;
}

function renderUsers() {
  const search = state.userSearch.trim().toLowerCase();
  const rows = state.users.filter(u => !search || u.display_name?.toLowerCase().includes(search) || u.email?.toLowerCase().includes(search));
  renderShell(`<h1>Users</h1><p class="main-subtitle">Manage users.</p>${statStrip()}<div class="toolbar"><input type="search" id="user-search" placeholder="Search..." value="${escapeHtml(state.userSearch)}"></div><div class="table-card"><table><thead><tr><th>User</th><th>Plan</th><th>Status</th><th>Joined</th><th>Actions</th></tr></thead><tbody>${rows.length ? rows.map(u => `<tr data-user-row="${u.id}"><td class="name-cell"><strong>${escapeHtml(u.display_name)}</strong><small>${escapeHtml(u.email)}</small></td><td><span class="badge plan-${u.subscription_plan}">${u.subscription_plan}</span></td><td><span class="badge status-${u.subscription_status}">${u.subscription_status}</span></td><td>${formatDate(u.created_at)}</td><td><div class="row-actions"><select data-field="subscription_plan"><option value="free" ${u.subscription_plan === 'free' ? 'selected' : ''}>Free</option><option value="plus" ${u.subscription_plan === 'plus' ? 'selected' : ''}>Plus</option><option value="pro" ${u.subscription_plan === 'pro' ? 'selected' : ''}>Pro</option></select><select data-field="subscription_status"><option value="active" ${u.subscription_status === 'active' ? 'selected' : ''}>Active</option><option value="canceled" ${u.subscription_status === 'canceled' ? 'selected' : ''}>Canceled</option></select><button class="icon-button save" data-save-user="${u.id}">Save</button></div></td></tr>`).join('') : '<tr class="empty-row"><td colspan="5">No users found.</td></tr>'}</tbody></table></div>`);
}

function renderRecipes() {
  const search = state.recipeSearch.trim().toLowerCase();
  const rows = state.recipes.filter(r => !search || r.name.toLowerCase().includes(search));
  renderShell(`<h1>Recipes</h1><p class="main-subtitle">Manage recipes.</p>${statStrip()}<div class="toolbar"><input type="search" id="recipe-search" placeholder="Search..." value="${escapeHtml(state.recipeSearch)}"></div><div class="table-card"><table><thead><tr><th>Recipe</th><th>Category</th><th>Visibility</th><th>Actions</th></tr></thead><tbody>${rows.length ? rows.map(r => `<tr><td class="name-cell"><strong>${escapeHtml(r.name)}</strong></td><td>${escapeHtml(r.category)}</td><td><span class="badge shared-${r.is_shared ? 'yes' : 'no'}">${r.is_shared ? 'Shared' : 'Private'}</span></td><td><div class="row-actions"><button class="icon-button" data-toggle-shared="${r.id}" data-currently-shared="${r.is_shared}">${r.is_shared ? 'Hide' : 'Unhide'}</button><button class="icon-button danger" data-delete-recipe="${r.id}">Delete</button></div></td></tr>`).join('') : '<tr class="empty-row"><td colspan="4">No recipes found.</td></tr>'}</tbody></table></div>`);
}

function render() {
  if (!state.session) return renderAuth();
  if (!state.authChecked) { app.innerHTML = '<div class="auth-shell"><p>Checking...</p></div>'; return; }
  if (!state.adminProfile?.is_admin) return renderLocked();
  if (state.loading && !state.stats) { app.innerHTML = '<div class="auth-shell"><p>Loading...</p></div>'; return; }
  return state.tab === 'recipes' ? renderRecipes() : renderUsers();
}

document.addEventListener('click', event => {
  const tab = event.target.closest('[data-tab]');
  if (tab) { state.tab = tab.dataset.tab; return render(); }
  if (event.target.closest('#admin-sign-out')) return supabase.auth.signOut();

  const saveUser = event.target.closest('[data-save-user]');
  if (saveUser) {
    const id = saveUser.dataset.saveUser;
    const row = saveUser.closest('[data-user-row]');
    const plan = row.querySelector('[data-field="subscription_plan"]').value;
    const status = row.querySelector('[data-field="subscription_status"]').value;
    authFetch(`/api/admin/users/${id}`, { method: 'PATCH', body: JSON.stringify({ subscription_plan: plan, subscription_status: status }) })
      .then(() => { showToast('Updated'); loadAll(); })
      .catch(err => showToast(err.message));
    return;
  }

  const toggle = event.target.closest('[data-toggle-shared]');
  if (toggle) {
    const id = toggle.dataset.toggleShared;
    const next = toggle.dataset.currentlyShared !== 'true';
    authFetch(`/api/admin/recipes/${id}`, { method: 'PATCH', body: JSON.stringify({ is_shared: next }) })
      .then(() => { showToast('Updated'); loadAll(); })
      .catch(err => showToast(err.message));
    return;
  }

  const del = event.target.closest('[data-delete-recipe]');
  if (del) {
    const id = del.dataset.deleteRecipe;
    if (!confirm('Delete?')) return;
    authFetch(`/api/admin/recipes/${id}`, { method: 'DELETE' })
      .then(() => { showToast('Deleted'); loadAll(); })
      .catch(err => showToast(err.message));
  }
});

document.addEventListener('submit', event => {
  if (event.target.id !== 'admin-login') return;
  event.preventDefault();
  const form = new FormData(event.target);
  state.authError = '';
  supabase.auth.signInWithPassword({ email: form.get('email'), password: form.get('password') })
    .then(({ error }) => { if (error) { state.authError = error.message; render(); } });
});

document.addEventListener('input', event => {
  if (event.target.id === 'user-search') { state.userSearch = event.target.value; renderUsers(); }
  if (event.target.id === 'recipe-search') { state.recipeSearch = event.target.value; renderRecipes(); }
});

supabase.auth.onAuthStateChange(async (e, session) => {
  state.session = session;
  if (session) {
    await checkAdmin();
    if (state.adminProfile?.is_admin) loadAll();
    else render();
  } else {
    state.adminProfile = null;
    state.authChecked = false;
    state.users = [];
    state.recipes = [];
    state.stats = null;
    state.tab = 'users';
    render();
  }
});

render();
