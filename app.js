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

// All money in this deployment is South African Rand. The values are stored as
// plain numbers (in app_settings and on recipe rows) -- formatting happens here
// at display time so the stored data stays numeric.
const formatRands = (value) => {
  const n = Number(value);
  if (!Number.isFinite(n)) return '—';
  return `R${n.toFixed(2)}`;
};

// Short "time ago" label for the audit log (falls back to a date beyond a week).
const timeAgo = (iso) => {
  if (!iso) return '—';
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '—';
  const mins = Math.max(0, Math.round((Date.now() - then) / 60000));
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 7) return `${days}d ago`;
  return formatDate(iso);
};

// Shared <-> hidden is the same flag on the wire; different deployments of
// the recipes table have called it `is_shared`, `shared`, `visible` or
// `published`, so read whichever one is present (defaulting to visible).
// `??` only skips null/undefined, so an explicit `false`/`0`/`"false"` still
// means Hidden -- and unknown shapes fall back to Visible rather than
// silently rendering an "Unhide" button on an already-hidden row.
const SHARED_FLAG_FIELDS = ['is_shared', 'shared', 'visible', 'published'];
const toBool = (v) => {
  if (typeof v === 'boolean') return v;
  if (typeof v === 'number') return v !== 0;
  if (typeof v === 'string') return !['false', '0', 'no', ''].includes(v.trim().toLowerCase());
  return Boolean(v);
};
const recipeShared = (recipe) => {
  for (const key of SHARED_FLAG_FIELDS) {
    if (recipe?.[key] !== undefined && recipe?.[key] !== null) return toBool(recipe[key]);
  }
  return true; // no visibility column at all -> treat as visible
};

// Shared <-> hidden is the same flag on the wire (is_shared); we just present
// it to the admin as "Visible" / "Hidden".
const visibilityBadge = (recipe) => recipeShared(recipe)
  ? '<span class="badge shared-yes">Visible</span>'
  : '<span class="badge shared-no">Hidden</span>';

// Which column actually carries visibility for this deployment. Defaults to
// `is_shared`; if a PATCH comes back saying that column doesn't exist on the
// recipes table, we probe the alternatives (`shared`, `visible`, `published`)
// and remember whichever one the table really has -- so "Hide" keeps working
// even when the schema names the flag differently.
let sharedColumn = 'is_shared';
const SHARED_COLUMN_FALLBACKS = ['shared', 'visible', 'published'];
const isMissingColumnError = (err) => /does not exist|column .*not (?:be )?found|undefined column|schema cache|PGRST204/i.test(err?.message || '');

// The fields the popup edit form exposes. `text`/`number` inputs are one-liners,
// `textarea` gets a full-width row. Values come straight off the API row.
// Cuisine and Price are intentionally not editable here -- they stay untouched
// on the recipe row. `file: true` on Image renders a plain "Add image" control
// with a file input directly underneath it (no URL text box).
const RECIPE_EDIT_FIELDS = [
  { key: 'name', label: 'Name', type: 'text' },
  { key: 'category', label: 'Category', type: 'text' },
  { key: 'difficulty', label: 'Difficulty', type: 'text' },
  { key: 'prep_time', label: 'Prep time (min)', type: 'number' },
  { key: 'servings', label: 'Servings', type: 'number' },
  { key: 'image_url', label: 'Image', type: 'file', full: true },
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
  editingRecipeId: null,   // id of the recipe whose inline edit form is open
  editingUserId: null,     // id of the user shown in the Users "Edit" popup
  savingUserId: null,      // id whose save request is currently in flight
  // Lookups so the audit log can show names instead of raw UUIDs.
  userById: {}, recipeById: {}
};

async function authFetch(path, options = {}) {
  const token = state.session?.access_token;
  const response = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(options.headers || {}) }
  });
  const text = await response.text();
  let body = {};
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    // Non-JSON error page (e.g. an HTML "An error occurred..." body): surface
    // the status instead of dying with "JSON Parse error: Unexpected identifier".
    throw new Error(`Server error ${response.status} on ${path}`);
  }
  if (!response.ok) {
    const err = new Error(body.error || `Request failed (${response.status})`);
    err.status = response.status;
    throw err;
  }
  return body;
}

// PATCH a recipe, working around deployments where the visibility flag lives
// under a different column name. If the server reports that `is_shared` isn't
// a real column, resend the same change using the next candidate name and
// remember which one worked for the rest of the session.
async function patchRecipe(id, payload) {
  try {
    return await authFetch(`/api/admin/recipes/${id}`, { method: 'PATCH', body: JSON.stringify(payload) });
  } catch (err) {
    if ('is_shared' in payload && err.status === 500 && isMissingColumnError(err)) {
      for (const col of SHARED_COLUMN_FALLBACKS) {
        if (col === sharedColumn) continue;
        const alt = { ...payload, [col]: payload.is_shared };
        delete alt.is_shared;
        try {
          const res = await authFetch(`/api/admin/recipes/${id}`, { method: 'PATCH', body: JSON.stringify(alt) });
          sharedColumn = col;
          return res;
        } catch (inner) {
          if (!isMissingColumnError(inner)) throw inner;
        }
      }
    }
    throw err;
  }
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
  const [usersRes, recipesRes, stats, analytics, moderation, audit, settingsRes] = await Promise.all([
    safeFetch('/api/admin/users'),
    safeFetch('/api/admin/recipes'),
    safeFetch('/api/admin/stats'),
    safeFetch('/api/admin/analytics'),
    safeFetch('/api/admin/moderation'),
    safeFetch('/api/admin/audit'),
    safeFetch('/api/admin/setting')
  ]);
  if (usersRes)   state.users = usersRes.users || [];
  if (recipesRes) state.recipes = recipesRes.recipes || [];
  if (stats)      state.stats = stats;
  if (analytics)  state.analytics = analytics;
  if (moderation) state.moderation = Array.isArray(moderation) ? moderation : (moderation.reports || []);
  if (audit)        state.audit = Array.isArray(audit) ? audit : (audit.logs || []);
  if (settingsRes)  state.settings = settingsRes;
  state.auditLoaded = true;
  // Index users/recipes by id so the audit log can resolve "userId: <uuid>"
  // into a human name.
  state.userById = Object.fromEntries(state.users.map(u => [u.id, u]));
  state.recipeById = Object.fromEntries(state.recipes.map(r => [r.id, r]));
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
  // The Edit button opens a popup (see userEditModal), rendered after the
  // table so it floats above everything.
  const editingUser = state.editingUserId
    ? state.users.find(u => u.id === state.editingUserId)
    : null;
  
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
              <button class="icon-button" data-edit-user="${u.id}">Edit</button>
            </div></td>
          </tr>`).join('') : '<tr class="empty-row"><td colspan="5">No users match that search.</td></tr>'}
      </tbody>
    </table></div>
    ${editingUser ? userEditModal(editingUser) : ''}`);
}

// Users tab: "Flag"/"Unflag" grants or revokes admin access for an account.
// It now lives in the Edit popup's submenu instead of on every table row --
// your own account has no button; the server rejects self-changes anyway
// (see toggleAdminFlag below).

// The Users tab "Edit" popup: full account details (name, email, plan, status,
// admin flag) in one form. Same modal markup/styling as the recipe editor.
function userEditModal(u) {
  const saving = state.savingUserId === u.id;
  const fields = USER_EDIT_FIELDS.map(f => {
    const raw = u[f.key] ?? '';
    let input;
    if (f.type === 'select') {
      const options = userFieldOptions(f.key).map(([value, label]) =>
        `<option value="${escapeHtml(String(value))}" ${String(raw) === String(value) ? 'selected' : ''}>${escapeHtml(label)}</option>`).join('');
      input = `<select data-user-field="${f.key}"${f.key === 'is_admin' && u.id === state.adminProfile?.id ? ' disabled title="You cannot change your own admin flag"' : ''}>${options}</select>`;
    } else {
      input = `<input type="${f.type}" data-user-field="${f.key}" value="${escapeHtml(raw)}">`;
    }
    return `<label class="edit-field ${f.type === 'text' ? '' : 'full'}"><span>${escapeHtml(f.label)}</span>${input}</label>`;
  }).join('');

  // Sub menu shown under Save/Cancel: Flag / Unflag admin access.
  const flagButton = u.id === state.adminProfile?.id
    ? ''
    : `<button type="button" class="icon-button${u.is_admin ? ' danger' : ''}" data-flag-admin="${u.id}" data-flagged="${Boolean(u.is_admin)}">${u.is_admin ? 'Unflag' : 'Flag user'}</button>`;

  return `
    <div class="modal-backdrop" id="user-edit-modal" data-modal-for="${u.id}">
      <div class="modal" role="dialog" aria-modal="true" aria-label="Edit user">
        <div class="modal-head">
          <h2>Edit user</h2>
          <button class="modal-close" data-cancel-user-edit aria-label="Close">&times;</button>
        </div>
        <form class="edit-form" id="user-edit-form" data-user-edit-for="${u.id}">
          <div class="edit-grid">${fields}</div>
          <p class="main-subtitle">Joined ${formatDate(u.created_at)}</p>
          <div class="edit-actions">
            <button type="submit" class="icon-button save" ${saving ? 'disabled' : ''}>${saving ? 'Saving…' : 'Save changes'}</button>
            <button type="button" class="icon-button" data-cancel-user-edit>Cancel</button>
          </div>
          ${flagButton ? `<div class="submenu-row"><span class="submenu-label">More actions</span><div class="row-actions">${flagButton}</div></div>` : ''}
        </form>
      </div>
    </div>`;
}

// The fields the Users "Edit" popup exposes. Display name / email are free
// text; plan, status and the admin flag render as selects (see
// userFieldOptions below for the choices).
const USER_EDIT_FIELDS = [
  { key: 'display_name', label: 'Display name', type: 'text' },
  { key: 'email', label: 'Email', type: 'text' },
  { key: 'subscription_plan', label: 'Plan', type: 'select' },
  { key: 'subscription_status', label: 'Status', type: 'select' },
  { key: 'is_admin', label: 'Admin access', type: 'select' }
];

const USER_PLAN_OPTIONS = [['free', 'Free'], ['plus', 'Plus'], ['pro', 'Pro']];
const USER_STATUS_OPTIONS = [['active', 'Active'], ['trialing', 'Trialing'], ['past_due', 'Past due'], ['canceled', 'Canceled']];
const USER_ADMIN_OPTIONS = [[false, 'Regular user'], [true, 'Administrator']];

const userFieldOptions = (key) =>
  key === 'subscription_plan' ? USER_PLAN_OPTIONS
  : key === 'subscription_status' ? USER_STATUS_OPTIONS
  : key === 'is_admin' ? USER_ADMIN_OPTIONS
  : [];

// Only show a Price column when at least one recipe actually carries a price --
// most recipes are user-generated with no price at all.
const anyRecipeHasPrice = () => state.recipes.some(r => r.price !== undefined && r.price !== null && r.price !== '');

// Mirror the visibility flag across every name the schema might use, so the
// cached row shows the right badge no matter which column this deployment has.
const withSharedFlags = (recipe, shared) => Object.fromEntries(
  SHARED_FLAG_FIELDS.map(key => [key, shared])
);

// One row per recipe. Editing happens in a popup (see recipeEditModal), so the
// table rows stay compact and never get squashed by an inline form. Only the
// Edit button is visible on the row -- Hide/Unhide and Delete live in the
// popup's submenu.
function recipeRow(r) {
  const priceCell = anyRecipeHasPrice()
    ? `<td>${r.price !== undefined && r.price !== null && r.price !== '' ? formatRands(r.price) : '—'}</td>`
    : '';

  return `
    <tr data-recipe-row="${r.id}">
      <td class="name-cell"><strong>${escapeHtml(r.name)}</strong><small>${escapeHtml(r.category || 'Uncategorised')}</small></td>
      <td class="name-cell"><strong>${escapeHtml(r.author?.display_name || 'Unknown')}</strong></td>
      ${priceCell}
      <td>${visibilityBadge(r)}</td>
      <td>${formatDate(r.created_at)}</td>
      <td><div class="row-actions">
        <button class="icon-button" data-edit-recipe="${r.id}">Edit</button>
      </div></td>
    </tr>`;
}

// The Edit button opens this popup instead of an inline form squashed into a
// table cell. It's rendered after the table so it floats above everything.
// The submenu under Save/Cancel carries the visible Hide/Unhide button and the
// red Delete button.
function recipeEditModal(r) {
  const fields = RECIPE_EDIT_FIELDS.map(f => {
    const value = r[f.key] ?? '';
    let input;
    if (f.type === 'textarea') {
      input = `<textarea data-edit-field="${f.key}" rows="3">${escapeHtml(value)}</textarea>`;
    } else if (f.type === 'file') {
      // "Add image": a plain button with the file input directly underneath it,
      // plus a thumbnail of whatever image the recipe currently has.
      const isPreviewable = typeof value === 'string' && /^(https?:|data:image\/)/i.test(value);
      input = `
        <span class="image-picker">
          <button type="button" class="ghost-button small" data-pick-image="${f.key}">Add image</button>
          <input type="file" accept="image/*" data-image-file="${f.key}">
          <img class="image-preview ${isPreviewable ? '' : 'hidden'}" data-image-preview="${f.key}" src="${isPreviewable ? escapeHtml(value) : ''}" alt="">
        </span>`;
    } else if (f.money) {
      input = `<span class="input-affix"><span class="affix">R</span><input type="number" data-edit-field="${f.key}" min="${f.min ?? 0}" step="${f.step ?? 1}" value="${escapeHtml(value)}"></span>`;
    } else {
      input = `<input type="${f.type}" data-edit-field="${f.key}"${f.min !== undefined ? ` min="${f.min}"` : ''}${f.step !== undefined ? ` step="${f.step}"` : ''} value="${escapeHtml(value)}">`;
    }
    return `<label class="edit-field ${f.full ? 'full' : ''}"><span>${escapeHtml(f.label)}</span>${input}</label>`;
  }).join('');

  const shared = recipeShared(r);
  return `
    <div class="modal-backdrop" id="recipe-edit-modal" data-modal-for="${r.id}">
      <div class="modal" role="dialog" aria-modal="true" aria-label="Edit recipe">
        <div class="modal-head">
          <h2>Edit recipe</h2>
          <button class="modal-close" data-cancel-edit aria-label="Close">&times;</button>
        </div>
        <form class="edit-form" id="recipe-edit-form" data-save-recipe="${r.id}">
          <div class="edit-grid">${fields}</div>
          <label class="edit-field check"><input type="checkbox" data-edit-field="is_shared" ${shared ? 'checked' : ''}><span>Visible in Explore</span></label>
          <div class="edit-actions">
            <button type="submit" class="icon-button save" data-save-recipe="${r.id}">Save changes</button>
            <button type="button" class="icon-button" data-cancel-edit>Cancel</button>
          </div>
          <div class="submenu-row">
            <span class="submenu-label">More actions</span>
            <div class="row-actions">
              <button type="button" class="icon-button" data-toggle-shared="${r.id}" data-currently-shared="${shared}">${shared ? 'Hide' : 'Unhide'}</button>
              <button type="button" class="icon-button danger" data-delete-recipe="${r.id}">Delete</button>
            </div>
          </div>
        </form>
      </div>
    </div>`;
}

function renderRecipes() {
  const search = state.recipeSearch.trim().toLowerCase();
  const rows = state.recipes.filter(r => !search
    || r.name?.toLowerCase().includes(search)
    || r.author?.display_name?.toLowerCase().includes(search));

  const hasPrice = anyRecipeHasPrice();
  const colCount = hasPrice ? 6 : 5;
  const editing = state.editingRecipeId
    ? state.recipes.find(r => r.id === state.editingRecipeId)
    : null;

  renderShell(`
    <h1>Recipes</h1>
    <p class="main-subtitle">Every recipe across the app — edit details, hide it from Explore, or delete it.</p>
    ${statStrip()}
    <div class="toolbar">
      <input type="search" id="recipe-search" placeholder="Search by name or author" value="${escapeHtml(state.recipeSearch)}">
      <button id="export-recipes-csv" class="ghost-button">Download CSV</button>
    </div>
    <div class="table-card"><table>
      <thead><tr><th>Recipe</th><th>Author</th>${hasPrice ? '<th>Price</th>' : ''}<th>Visibility</th><th>Created</th><th>Actions</th></tr></thead>
      <tbody>
        ${rows.length ? rows.map(recipeRow).join('') : `<tr class="empty-row"><td colspan="${colCount}">No recipes match that search.</td></tr>`}
      </tbody>
    </table></div>
    ${editing ? recipeEditModal(editing) : ''}`);
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

// Turn an audit row into one plain-language sentence + a short "what changed"
// note. logAudit() writes {admin_email, action, details}; details carries the
// ids/field names we resolve back to readable labels here. Anything unknown
// degrades gracefully to the raw action name rather than a JSON blob.
const HIDDEN_DETAIL_KEYS = ['userid', 'recipeid', 'reportid', 'email'];

const fieldLabel = (key) => key.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());

const planLabel = (v) => ({ free: 'Free', plus: 'Plus', pro: 'Pro' }[v] ?? v);
const statusLabel = (v) => ({ active: 'Active', trialing: 'Trialing', past_due: 'Past due', canceled: 'Canceled' }[v] ?? v);

const VALUE_LABELS = {
  subscription_plan: planLabel,
  subscription_status: statusLabel,
  is_shared: (v) => (v ? 'Visible in Explore' : 'Hidden from Explore')
};

const describeValue = (key, value) => {
  const label = VALUE_LABELS[key];
  if (value === null || value === undefined || value === '') return 'cleared';
  return label ? label(value) : String(value);
};

// "Plan: Free → Plus, Status: Active → Past due" style list of what changed.
const changeSummary = (changes = {}, previous = {}) => Object.entries(changes)
  .filter(([key]) => !HIDDEN_DETAIL_KEYS.includes(key.toLowerCase()))
  .map(([key, value]) => {
    const before = previous?.[key];
    const from = before !== undefined && before !== null ? describeValue(key, before) : null;
    const to = describeValue(key, value);
    return `${fieldLabel(key)}: ${from && from !== to ? `${from} → ${to}` : to}`;
  })
  .join(', ');

const truncate = (text, max = 80) => {
  const s = String(text ?? '');
  return s.length > max ? `${s.slice(0, max).trimEnd()}…` : s;
};

// Shared CSV download helper (Users tab + Settings audit export).
function downloadCsv(rows, filename) {
  const csvString = rows.map(row => row.join(',')).join('\n');
  const blob = new Blob([csvString], { type: 'text/csv' });
  const url = window.URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.setAttribute('hidden', '');
  a.setAttribute('href', url);
  a.setAttribute('download', filename);
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}

// Deleted recipes are no longer in the local list, so logAudit() also stores
// the name alongside the id -- prefer that, then the cache, then a short id.
const recipeNameFor = (id, storedName) => {
  if (storedName) return storedName;
  const cached = state.recipeById[id]?.name;
  if (cached) return cached;
  return id ? `Recipe ${String(id).slice(0, 8)}…` : 'a recipe';
};
const userLabelFor = (details) => {
  const user = state.userById[details.userId];
  if (user) return user.display_name || user.email || 'this account';
  return details.email || (details.userId ? `User ${String(details.userId).slice(0, 8)}…` : 'an account');
};

// Returns { headline, detail } -- headline is the one-line summary, detail is
// the optional smaller line beneath it (what actually changed / who did it).
function summarizeAudit(log) {
  const action = String(log.action || log.event || 'unknown');
  let d = log.details ?? log.metadata ?? null;
  if (typeof d === 'string') { try { d = JSON.parse(d); } catch { d = { note: d }; } }
  d = d && typeof d === 'object' ? d : {};

  const changes = d.changes || {};
  switch (action) {
    case 'user_updated':
      return { headline: `Updated account “${userLabelFor(d)}”`, detail: changeSummary(changes, d.previous) || 'Subscription changes saved' };
    case 'recipe_updated': {
      const sharedOnly = Object.keys(changes).length === 1 && changes.is_shared !== undefined;
      const name = recipeNameFor(d.recipeId, d.recipeName);
      if (sharedOnly) {
        return { headline: `${changes.is_shared ? 'Unhid' : 'Hid'} recipe “${name}”`, detail: changes.is_shared ? 'Now visible in Explore' : 'No longer visible in Explore' };
      }
      return { headline: `Edited recipe “${name}”`, detail: changeSummary(changes) || 'Recipe details updated' };
    }
    case 'recipe_deleted':
      return { headline: `Deleted recipe “${recipeNameFor(d.recipeId, d.recipeName)}”`, detail: 'Ratings and reports removed too' };
    case 'recipe_deleted_via_report':
      return { headline: `Deleted recipe “${recipeNameFor(d.recipeId, d.recipeName)}” from a report`, detail: 'Report resolved too' };
    case 'report_dismissed':
      return { headline: `Dismissed a report${d.recipeName ? ` on “${d.recipeName}”` : ''}`, detail: 'Marked resolved' };
    case 'report_status_changed':
      return { headline: `Report marked ${d.status || 'updated'}`, detail: d.reportId ? `Report ${String(d.reportId).slice(0, 8)}…` : '' };
    case 'setting_updated': {
      const raw = d.value;
      const shown = typeof raw === 'string' ? truncate(raw, 40) : JSON.stringify(raw);
      return { headline: `Changed setting “${fieldLabel(String(d.key || 'setting'))}”`, detail: shown ?? '' };
    }
    case 'audit_purged':
      return { headline: `Purged old audit logs`, detail: `${d.removed ?? 0} entries older than ${d.olderThanDays ?? '?'} days removed` };
    default: {
      const fallbackDetail = changeSummary(
        Object.fromEntries(Object.entries(d).filter(([k]) => !HIDDEN_DETAIL_KEYS.includes(k.toLowerCase())))
      );
      return {
        headline: fieldLabel(action),
        detail: fallbackDetail || (typeof d.note === 'string' ? truncate(d.note) : '')
      };
    }
  }
}

function renderAudit() {
  // state.audit starts as [] and only stays empty if the request failed or
  // there genuinely are no logs -- never leave the tab stuck on "Loading".
  const loading = state.loading && !state.auditLoaded;
  const rows = state.audit || [];

  renderShell(`
    <h1>Audit Log</h1>
    <p class="main-subtitle">Who changed what, most recent first.</p>
    ${loading ? '<p class="main-subtitle">Loading audit logs…</p>' : `
    <div class="table-card"><div class="audit-list">
      ${rows.length ? rows.map(log => {
        const { headline, detail } = summarizeAudit(log);
        const who = log.admin_email || 'system';
        return `
          <div class="audit-item">
            <span class="audit-when" title="${escapeHtml(log.created_at || '')}">${escapeHtml(timeAgo(log.created_at))}</span>
            <span class="audit-what">
              <strong>${escapeHtml(headline)}</strong>
              <small class="audit-target">${detail ? `${escapeHtml(detail)} · ` : ''}${escapeHtml(who)}</small>
            </span>
          </div>`;
      }).join('') : '<div class="audit-empty">No audit logs yet. They appear here as soon as you edit, hide or delete a recipe.</div>'}
    </div></div>`}
  `);
}

// ---------------------------------------------------------------------------
// Settings tab
// ---------------------------------------------------------------------------

// Every setting we know about, grouped into cards. `key` maps to a row in the
// app_settings table; `type` drives the control that gets rendered. Values are
// stored as JSON in Postgres, so booleans/numbers arrive already parsed.
const SETTINGS_SCHEMA = [
  {
    title: 'Feature Flags & App Config',
    items: [
      { key: 'explore_enabled', label: 'Explore page enabled', hint: 'Turn off to hide the community Explore feed everywhere.', type: 'toggle', default: true },
      { key: 'registration_open', label: 'New sign-ups allowed', hint: 'Disable to stop anyone creating a HotShots account.', type: 'toggle', default: true },
      { key: 'maintenance_mode', label: 'Maintenance mode', hint: 'Shows a maintenance banner in the main app. Use sparingly!', type: 'toggle', danger: true, default: false },
      { key: 'free_recipe_limit', label: 'Free-tier recipe limit', hint: 'Max recipes a free user can save.', type: 'number', min: 0, default: 50 },
      { key: 'max_upload_mb', label: 'Max image upload (MB)', hint: 'Upload size cap for recipe photos.', type: 'number', min: 1, default: 10 }
    ]
  },
  {
    title: 'Moderation Policies',
    items: [
      { key: 'autohide_report_threshold', label: 'Auto-hide after N reports', hint: 'Recipes with this many open reports get hidden automatically.', type: 'number', min: 1, default: 5 },
      { key: 'require_email_verification', label: 'Require verified email to post', hint: 'Users must confirm their email before sharing recipes.', type: 'toggle', default: false },
      { key: 'blocked_words', label: 'Blocked words', hint: 'Comma-separated list filtered from recipe names and descriptions.', type: 'list', default: [] },
      { key: 'blocked_tags', label: 'Blocked tags', hint: 'Comma-separated tags nobody may attach to a recipe.', type: 'list', default: [] }
    ]
  },
  {
    title: 'Plans & Billing Defaults',
    items: [
      // All prices are in South African Rand (ZAR) -- stored as plain numbers,
      // rendered with an "R" prefix by settingControl().
      { key: 'plus_plan_price', label: 'Plus plan price (R/mo)', type: 'number', money: true, min: 0, step: 0.01, default: 89.99 },
      { key: 'pro_plan_price', label: 'Pro plan price (R/mo)', type: 'number', money: true, min: 0, step: 0.01, default: 149.99 },
      { key: 'trial_length_days', label: 'Default trial length (days)', type: 'number', min: 0, default: 14 },
      { key: 'comp_everyone', label: 'Emergency: comp all accounts', hint: 'Treats every user as paid. Only flip this during an outage or migration.', type: 'toggle', danger: true, confirm: true, default: false }
    ]
  }
];

const FLAT_SETTINGS = SETTINGS_SCHEMA.flatMap(group => group.items);

// Read one setting value out of the fetched rows, falling back to the schema default.
function getSetting(key) {
  const row = (state.settings || []).find(s => s.key === key);
  if (!row) {
    const item = FLAT_SETTINGS.find(i => i.key === key);
    return item ? item.default : undefined;
  }
  // The column is jsonb, so the driver may hand us a parsed value or a string.
  if (typeof row.value === 'string') { try { return JSON.parse(row.value); } catch { return row.value; } }
  return row.value;
}

function settingControl(item) {
  const value = getSetting(item.key);
  switch (item.type) {
    case 'toggle':
      return `
        <div class="setting-row">
          <div class="setting-copy">
            <strong>${escapeHtml(item.label)}</strong>
            ${item.hint ? `<small>${escapeHtml(item.hint)}</small>` : ''}
          </div>
          <label class="switch" title="${escapeHtml(item.key)}">
            <input type="checkbox" data-setting="${item.key}" data-type="toggle" ${value ? 'checked' : ''} ${item.confirm ? 'data-confirm="true"' : ''}>
            <span class="slider"></span>
          </label>
        </div>`;
    case 'number':
      return `
        <div class="setting-row">
          <div class="setting-copy">
            <strong>${escapeHtml(item.label)}</strong>
            ${item.hint ? `<small>${escapeHtml(item.hint)}</small>` : ''}
          </div>
          <input class="setting-input narrow" type="number" data-setting="${item.key}" data-type="number"
                 min="${item.min ?? 0}" step="${item.step ?? 1}" value="${escapeHtml(value ?? '')}">
        </div>`;
    case 'list': {
      const asText = Array.isArray(value) ? value.join(', ') : (value ?? '');
      return `
        <div class="setting-row setting-row-stack">
          <div class="setting-copy">
            <strong>${escapeHtml(item.label)}</strong>
            ${item.hint ? `<small>${escapeHtml(item.hint)}</small>` : ''}
          </div>
          <input class="setting-input wide" type="text" data-setting="${item.key}" data-type="list"
                 placeholder="word one, word two, tag" value="${escapeHtml(asText)}">
        </div>`;
    }
    case 'secret':
      return `
        <div class="setting-row setting-row-stack">
          <div class="setting-copy">
            <strong>${escapeHtml(item.label)}</strong>
            ${item.hint ? `<small>${escapeHtml(item.hint)}</small>` : ''}
          </div>
          <div class="secret-row">
            <input class="setting-input wide" type="password" data-setting="${item.key}" data-type="text"
                   placeholder="${escapeHtml(item.placeholder || 'Not set')}" value="${escapeHtml(value ?? '')}">
            <button type="button" class="icon-button" data-reveal-secret="${item.key}">Show</button>
          </div>
        </div>`;
    default:
      return `
        <div class="setting-row setting-row-stack">
          <div class="setting-copy"><strong>${escapeHtml(item.label)}</strong></div>
          <input class="setting-input wide" type="text" data-setting="${item.key}" data-type="text" value="${escapeHtml(value ?? '')}">
        </div>`;
  }
}

function maskedUrl(url) {
  if (!url) return 'not set';
  try {
    const u = new URL(url);
    const last = u.pathname.split('/').filter(Boolean).pop() || '';
    return `${u.host}/…${last.slice(-4)}`;
  } catch {
    return `${String(url).slice(0, 12)}…`;
  }
}

function renderSettings() {
  const groups = SETTINGS_SCHEMA.map(group => `
    <section class="settings-card">
      <h2>${escapeHtml(group.title)}</h2>
      ${group.items.map(settingControl).join('')}
    </section>`).join('');

  const admins = state.users.filter(u => u.is_admin);
  const adminRows = admins.length ? admins.map(a => `
      <div class="admin-row">
        <div class="name-cell"><strong>${escapeHtml(a.display_name || 'Admin')}</strong><small>${escapeHtml(a.email || '')}</small></div>
        ${a.id === state.session?.user?.id
          ? '<span class="badge shared-yes">You</span>'
          : `<button class="icon-button danger" data-revoke-admin="${a.id}" data-admin-name="${escapeHtml(a.display_name || a.email || '')}">Remove admin</button>`}
      </div>`).join('')
    : '<p class="main-subtitle">No other admins found.</p>';

  const retentionDays = Number(getSetting('audit_retention_days') ?? 90);
  const oldest = state.audit.length ? state.audit[state.audit.length - 1]?.created_at : null;

  const envRows = [
    ['Signed in as', `${state.adminProfile?.display_name || 'Admin'} (${state.adminProfile?.email || ''})`],
    ['Accounts project', maskedUrl(SUPABASE_ACCOUNTS_URL)],
    ['API base', API_BASE || '(same origin)'],
    ['Audit entries loaded', String(state.audit.length)]
  ];

  renderShell(`
    <h1>Settings</h1>
    <p class="main-subtitle">App-wide configuration, stored in <code>app_settings</code>. Changes save instantly and land in the audit log.</p>
    ${groups}

    <section class="settings-card">
      <h2>Audit Log Management</h2>
      <div class="setting-row">
        <div class="setting-copy">
          <strong>Log retention (days)</strong>
          <small>Entries older than this can be purged. Currently loaded: ${state.audit.length}${oldest ? `, oldest: ${formatDate(oldest)}` : ''}.</small>
        </div>
        <input class="setting-input narrow" type="number" min="1" data-setting="audit_retention_days" data-type="number" value="${escapeHtml(retentionDays)}">
      </div>
      <div class="setting-actions">
        <button class="icon-button" id="export-audit-csv">Export logs CSV</button>
        <button class="icon-button" id="refresh-audit-only">Refresh cache</button>
        <button class="icon-button danger" id="purge-audit-old">Purge old logs</button>
      </div>
      <small class="setting-note">Purging deletes audit entries older than the retention window above. This cannot be undone.</small>
    </section>

    <section class="settings-card">
      <h2>Admin Access</h2>
      <small class="setting-note">Everyone currently flagged as an administrator. Removing access takes effect at their next request.</small>
      ${adminRows}
    </section>

    <section class="settings-card">
      <h2>Environment Info</h2>
      <div class="env-grid">
        ${envRows.map(([k, v]) => `<div class="env-item"><span>${escapeHtml(k)}</span><strong>${escapeHtml(v)}</strong></div>`).join('')}
      </div>
    </section>
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
  if (state.tab === 'settings') return renderSettings();
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
    state.editingUserId = null;
    return render(); 
  }
  
  if (event.target.closest('#admin-sign-out')) {
    supabase.auth.signOut();
    return;
  }

  // USERS: flag/unflag an account from the Edit popup's submenu (kept in
  // sync with Settings).
  const flagBtn = event.target.closest('[data-flag-admin]');
  if (flagBtn) {
    toggleAdminFlag(flagBtn);
    return;
  }

  // OPEN a user's edit popup (Users tab).
  const editUserBtn = event.target.closest('[data-edit-user]');
  if (editUserBtn && !editUserBtn.closest('.modal')) {
    state.editingUserId = editUserBtn.dataset.editUser;
    rerenderTab();
    const firstInput = app.querySelector('#user-edit-modal [data-user-field]');
    if (firstInput) firstInput.focus();
    return;
  }

  // Close the user edit popup: Cancel, the × button, or a backdrop click.
  if (event.target.closest('[data-cancel-user-edit]') || event.target.id === 'user-edit-modal') {
    state.editingUserId = null;
    rerenderTab();
    return;
  }

    // REFRESH DATA BUTTON
  if (event.target.id === 'refresh-data') {
    showToast('Refreshing data...');
    return loadAll();
  }
  
  // Hide / unhide from the Edit popup's submenu.
  const toggle = event.target.closest('[data-toggle-shared]');
  if (toggle) {
    const id = toggle.dataset.toggleShared;
    const recipe = state.recipes.find(r => r.id === id);
    // Flip based on what the cached row actually says, not the stale data-*
    // attribute (which can be out of sync after a failed/optimistic update).
    const wasShared = recipe ? recipeShared(recipe) : toggle.dataset.currentlyShared === 'true';
    const nextShared = !wasShared;
    toggle.disabled = true;
    patchRecipe(id, { is_shared: nextShared })
    .then(({ recipe: updated }) => {
      // Trust the server's copy when it sent one, but make sure *every* alias
      // of the flag matches -- otherwise recipeShared() could still read the
      // old `shared`/`visible` value and the row would look unchanged.
      state.recipes = state.recipes.map(r => {
        if (r.id !== id) return r;
        const merged = { ...r, ...(updated || {}) };
        // Server copy wins if it carries a visibility flag; otherwise assume
        // the PATCH succeeded and mirror `nextShared` across every alias --
        // recipeShared() reads whichever column this deployment actually has.
        const finalShared = updated && SHARED_FLAG_FIELDS.some(k => updated[k] != null)
          ? recipeShared(updated)
          : nextShared;
        return { ...merged, ...withSharedFlags(merged, finalShared) };
      });
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

  // IMAGE: "Add image" just opens the file input underneath it.
  const pickImage = event.target.closest('[data-pick-image]');
  if (pickImage) {
    const fileInput = app.querySelector(`[data-image-file="${pickImage.dataset.pickImage}"]`);
    if (fileInput) fileInput.click();
    return;
  }

  // OPEN a recipe's edit popup. Clicking the backdrop also closes it.
  const editBtn = event.target.closest('[data-edit-recipe]');
  if (editBtn && !editBtn.closest('.modal')) {
    state.editingRecipeId = editBtn.dataset.editRecipe;
    rerenderTab();
    const firstInput = app.querySelector('#recipe-edit-modal [data-edit-field]');
    if (firstInput) firstInput.focus();
    return;
  }

  if (event.target.closest('[data-cancel-edit]') || event.target.id === 'recipe-edit-modal') {
    state.editingRecipeId = null;
    rerenderTab();
    return;
  }

  // SAVE recipe edits -- only the fields that actually changed get sent.
  const saveRecipe = event.target.closest('[data-save-recipe]');
  if (saveRecipe && !saveRecipe.closest('form')) {
    event.preventDefault();
    submitRecipeForm(saveRecipe.dataset.saveRecipe, saveRecipe.closest('.edit-form'), saveRecipe);
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

  // SETTINGS / USERS: remove an admin's access (never your own -- server enforces too).
  const revokeBtn = event.target.closest('[data-revoke-admin]');
  if (revokeBtn) {
    const id = revokeBtn.dataset.revokeAdmin;
    const name = revokeBtn.dataset.adminName || 'this account';
    if (!window.confirm(`Remove admin access from ${name}? They will be locked out of this dashboard.`)) return;
    revokeBtn.disabled = true;
    authFetch(`/api/admin/users/${id}`, { method: 'PATCH', body: JSON.stringify({ is_admin: false }) })
      .then(() => {
        state.users = state.users.map(u => u.id === id ? { ...u, is_admin: false } : u);
        rerenderTab();
        showToast(`Admin access removed from ${name}`);
        refreshAuditLog();
      })
      .catch(err => {
        revokeBtn.disabled = false;
        showToast(err.message);
      });
    return;
  }

  // SETTINGS: reveal / hide a secret input (webhook URLs etc.)
  const revealBtn = event.target.closest('[data-reveal-secret]');
  if (revealBtn) {
    const input = app.querySelector(`[data-setting="${revealBtn.dataset.revealSecret}"]`);
    if (input) {
      const showing = input.type === 'text';
      input.type = showing ? 'password' : 'text';
      revealBtn.textContent = showing ? 'Show' : 'Hide';
    }
    return;
  }

  // SETTINGS: export the loaded audit log as CSV
  if (event.target.id === 'export-audit-csv') {
    if (!state.audit.length) { showToast('No audit logs to export'); return; }
    const headers = ['Timestamp', 'Admin', 'Action', 'Details'];
    const csvRows = state.audit.map(log => [
      log.created_at || '',
      `"${(log.admin_email || '').replace(/"/g, '""')}"`,
      log.action || '',
      `"${JSON.stringify(log.details ?? {}).replace(/"/g, '""')}"`
    ]);
    downloadCsv([headers, ...csvRows], 'hotshots_audit_log.csv');
    showToast('Audit log exported');
    return;
  }

  // SETTINGS: re-fetch just the audit list ("refresh cache")
  if (event.target.id === 'refresh-audit-only') {
    showToast('Refreshing audit log…');
    refreshAuditLog().then(() => { if (state.tab === 'settings') render(); });
    return;
  }

  // SETTINGS: purge audit entries older than the retention window
  if (event.target.id === 'purge-audit-old') {
    const days = Number(getSetting('audit_retention_days') ?? 90);
    if (!Number.isFinite(days) || days < 1) { showToast('Set a valid retention window first'); return; }
    if (!window.confirm(`Delete all audit logs older than ${days} days? This cannot be undone.`)) return;
    event.target.disabled = true;
    authFetch(`/api/admin/audit?olderThanDays=${encodeURIComponent(days)}`, { method: 'DELETE' })
      .then(({ removed }) => {
        showToast(`Purged ${removed ?? 0} old audit entries`);
        refreshAuditLog().then(() => { if (state.tab === 'settings') render(); });
      })
      .catch(err => {
        event.target.disabled = false;
        showToast(err.message);
      });
    return;
  }
});

// Collect the popup form's inputs and PATCH only the fields that changed.
// `button` is optional (used to disable the control while the request runs).
function submitRecipeForm(id, container, button) {
  const original = state.recipes.find(r => r.id === id);
  if (!original || !container) return;

  const payload = {};
  RECIPE_EDIT_FIELDS.forEach(f => {
    const input = container.querySelector(`[data-edit-field="${f.key}"]`);
    if (!input) return;
    const value = f.type === 'number'
      ? (input.value === '' ? null : Number(input.value))
      : input.value.trim();
    // Compare against what the row actually holds right now.
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

  if (button) button.disabled = true;
  patchRecipe(id, payload)
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
      if (button) button.disabled = false;
      showToast(err.message);
    });
}

// USERS row "Flag"/"Unflag" button: grant or revoke admin access. The server
// refuses to change your own flag, so that case is blocked here too (with a
// friendlier message than the raw 400).
function toggleAdminFlag(button) {
  const id = button.dataset.flagAdmin;
  const user = state.users.find(u => u.id === id);
  const name = user?.display_name || user?.email || 'this account';
  if (id === state.adminProfile?.id) {
    showToast("You can't change your own admin flag");
    return;
  }
  const next = !(user?.is_admin ?? button.dataset.flagged === 'true');
  if (!next && !window.confirm(`Remove admin access from ${name}? They will be locked out of this dashboard.`)) return;
  button.disabled = true;
  authFetch(`/api/admin/users/${id}`, { method: 'PATCH', body: JSON.stringify({ is_admin: next }) })
    .then(({ user: updated }) => {
      state.users = state.users.map(u => u.id === id ? { ...u, ...(updated || {}), is_admin: updated?.is_admin ?? next } : u);
      rerenderTab();
      showToast(next ? `${name} is now an admin` : `Admin access removed from ${name}`);
      refreshAuditLog();
    })
    .catch(err => {
      button.disabled = false;
      showToast(err.message);
    });
}

// Users edit popup: PATCH only the fields that actually changed.
function submitUserForm(id, container, button) {
  const original = state.users.find(u => u.id === id);
  if (!original || !container) return;

  const payload = {};
  USER_EDIT_FIELDS.forEach(f => {
    const input = container.querySelector(`[data-user-field="${f.key}"]`);
    if (!input || input.disabled) return; // e.g. own admin select is locked
    let value = input.value;
    if (f.key === 'is_admin') value = value === 'true';
    else if (typeof value === 'string') value = value.trim();
    if (value !== undefined && value !== original[f.key]) payload[f.key] = value;
  });

  if (!Object.keys(payload).length) {
    showToast('Nothing to save');
    return;
  }

  state.savingUserId = id;
  if (button) button.disabled = true;
  rerenderTab();
  authFetch(`/api/admin/users/${id}`, { method: 'PATCH', body: JSON.stringify(payload) })
    .then(({ user }) => {
      state.users = state.users.map(u => u.id === id ? { ...u, ...(user || payload) } : u);
      state.editingUserId = null;
      state.savingUserId = null;
      rerenderTab();
      showToast('User updated');
      refreshAuditLog();
    })
    .catch(err => {
      state.savingUserId = null;
      rerenderTab();
      showToast(err.message);
    });
}

document.addEventListener('submit', event => {
  // Recipe edit popup: submit via fetch instead of navigating.
  if (event.target.closest('#recipe-edit-form')) {
    event.preventDefault();
    const form = event.target.closest('#recipe-edit-form');
    submitRecipeForm(form.dataset.saveRecipe, form, form.querySelector('[type="submit"]'));
    return;
  }
  // User edit popup (Users tab).
  if (event.target.closest('#user-edit-form')) {
    event.preventDefault();
    const form = event.target.closest('#user-edit-form');
    submitUserForm(form.dataset.userEditFor, form, form.querySelector('[type="submit"]'));
    return;
  }
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

// SETTINGS: every control saves as soon as it changes -- toggles instantly,
// text/number/list inputs when the field loses focus or Enter is pressed.
document.addEventListener('change', event => {
  // Recipe edit popup: a local image picked from the PC gets read and dropped
  // into the Image URL field (as a data URL) plus shown in the thumbnail.
  const fileInput = event.target.closest('[data-image-file]');
  if (fileInput) {
    handleRecipeImagePick(fileInput);
    return;
  }
  const input = event.target.closest('[data-setting]');
  if (!input) return; // checkboxes fire change after flipping; text inputs on blur/Enter
  saveSetting(input);
});

const MAX_IMAGE_BYTES = 2 * 1024 * 1024; // keep data URLs small enough to store

// Read a locally-selected image file and feed it into the matching text field.
function handleRecipeImagePick(fileInput) {
  const key = fileInput.dataset.imageFile;
  const field = app.querySelector(`[data-edit-field="${key}"]`);
  const preview = app.querySelector(`[data-image-preview="${key}"]`);
  const file = fileInput.files && fileInput.files[0];
  if (!field || !file) return;

  if (!file.type.startsWith('image/')) {
    showToast('Please choose an image file');
    fileInput.value = '';
    return;
  }
  if (file.size > MAX_IMAGE_BYTES) {
    showToast('Image too large — pick one under 2 MB');
    fileInput.value = '';
    return;
  }

  const reader = new FileReader();
  reader.onload = () => {
    const dataUrl = String(reader.result || '');
    field.value = dataUrl;
    if (preview) {
      preview.src = dataUrl;
      preview.classList.remove('hidden');
    }
    showToast('Image loaded — click Save changes to store it');
  };
  reader.onerror = () => showToast("Couldn't read that file");
  reader.readAsDataURL(file);
}

function saveSetting(input) {
  const key = input.dataset.setting;
  const type = input.dataset.type;
  let value;
  if (type === 'toggle') {
    value = input.checked;
    if (input.dataset.confirm === 'true' && value) {
      if (!window.confirm(`"${input.closest('.setting-row')?.querySelector('strong')?.textContent || key}" is an emergency switch. Turn it ON?`)) {
        input.checked = false;
        return;
      }
    }
  } else if (type === 'number') {
    value = input.value === '' ? null : Number(input.value);
    if (value !== null && Number.isNaN(value)) { showToast('Enter a number'); return; }
  } else if (type === 'list') {
    value = input.value.split(',').map(s => s.trim()).filter(Boolean);
  } else {
    value = input.value.trim();
  }

  input.disabled = true;
  authFetch('/api/admin/setting', { method: 'PATCH', body: JSON.stringify({ key, value }) })
    .then((row) => {
      // Update the local cache so a re-render shows the saved value.
      const rows = state.settings || [];
      const idx = rows.findIndex(s => s.key === key);
      if (idx >= 0) rows[idx] = row; else rows.push(row);
      state.settings = rows;
      showToast(`${fieldLabel(key)} saved`);
      refreshAuditLog();
    })
    .catch(err => {
      showToast(err.message);
      if (type === 'toggle') input.checked = !input.checked; // revert the switch
      else render(); // restore the stored value in the input
    })
    .finally(() => { input.disabled = false; });
}

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
