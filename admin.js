const loginForm = document.getElementById('loginForm');
const loginStatus = document.getElementById('loginStatus');
const sessionStatus = document.getElementById('sessionStatus');
const sessionPanel = document.getElementById('sessionPanel');
const innovationSyncPanel = document.getElementById('innovationSyncPanel');
const innovationSyncMeta = document.getElementById('innovationSyncMeta');
const innovationSyncRuns = document.getElementById('innovationSyncRuns');
const runInnovationSyncButton = document.getElementById('runInnovationSync');
const signOutButton = document.getElementById('signOutButton');
const adminEditorPanel = document.getElementById('adminEditorPanel');
const adminSearchInput = document.getElementById('adminSearchInput');
const adminSearchMeta = document.getElementById('adminSearchMeta');
const adminSearchResults = document.getElementById('adminSearchResults');
const adminEditForm = document.getElementById('adminEditForm');
const adminEditorEmpty = document.getElementById('adminEditorEmpty');
const adminEditorFields = document.getElementById('adminEditorFields');
const adminEditStatus = document.getElementById('adminEditStatus');
const saveInnovatorButton = document.getElementById('saveInnovatorButton');

const ADMIN_SESSION_KEY = 'gian-innovation-admin-session';
const adminState = {
  vendors: [],
  products: [],
  filteredVendors: [],
  selectedVendorId: '',
};

const editEls = {
  vendorId: document.getElementById('editVendorId'),
  vendorName: document.getElementById('editVendorName'),
  portalContactName: document.getElementById('editPortalContactName'),
  locationText: document.getElementById('editLocationText'),
  finalContactEmail: document.getElementById('editFinalContactEmail'),
  finalContactPhone: document.getElementById('editFinalContactPhone'),
  finalContactAddress: document.getElementById('editFinalContactAddress'),
  websiteDetails: document.getElementById('editWebsiteDetails'),
  contactSourceUrl: document.getElementById('editContactSourceUrl'),
  websiteStatus: document.getElementById('editWebsiteStatus'),
  aboutVendor: document.getElementById('editAboutVendor'),
  contactNotes: document.getElementById('editContactNotes'),
};

function setStatus(element, message, isError = false) {
  element.textContent = message;
  element.classList.toggle('error', Boolean(isError));
}

function escapeHtml(value) {
  return String(value || '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;');
}

function formatDate(value) {
  if (!value) return 'Unknown date';
  return new Date(value).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' });
}

function getStoredToken() {
  return window.sessionStorage.getItem(ADMIN_SESSION_KEY) || '';
}

function storeToken(token) {
  if (token) window.sessionStorage.setItem(ADMIN_SESSION_KEY, token);
  else window.sessionStorage.removeItem(ADMIN_SESSION_KEY);
}

function updateSessionUi(isSignedIn) {
  loginForm.style.display = isSignedIn ? 'none' : 'grid';
  sessionPanel.classList.toggle('active', Boolean(isSignedIn));
  innovationSyncPanel.classList.toggle('active', Boolean(isSignedIn));
  adminEditorPanel.classList.toggle('active', Boolean(isSignedIn));
}

function renderInnovationSyncRuns(items) {
  innovationSyncRuns.innerHTML = '';
  if (!items.length) {
    innovationSyncRuns.innerHTML = '<article class="admin-card"><p>No GIAN sync runs yet.</p></article>';
    return;
  }
  items.forEach((item) => {
    const card = document.createElement('article');
    card.className = 'admin-card';
    const summary = item.status === 'success'
      ? `${item.vendor_count || 0} innovators and ${item.product_count || 0} innovations inserted`
      : item.error_message || 'No details recorded.';
    card.innerHTML = `<div class="admin-card-header"><h4>${escapeHtml(item.status || 'unknown')}</h4><span class="admin-badge ${item.status === 'success' ? 'approved' : ''}">${escapeHtml(item.status || 'unknown')}</span></div><p><strong>Requested By:</strong> ${escapeHtml(item.requested_by || 'Unknown')}</p><p><strong>Started:</strong> ${escapeHtml(formatDate(item.started_at || item.created_at))}</p><p><strong>Finished:</strong> ${escapeHtml(formatDate(item.finished_at))}</p><p><strong>Summary:</strong> ${escapeHtml(summary)}</p><p><strong>Error:</strong> ${escapeHtml(item.error_message || 'None')}</p></article>`;
    innovationSyncRuns.appendChild(card);
  });
}

function buildVendorSearchText(vendor) {
  const productNames = adminState.products
    .filter((product) => product.portal_vendor_id === vendor.portal_vendor_id)
    .map((product) => product.product_name)
    .join(' ');
  return [
    vendor.vendor_name,
    vendor.portal_contact_name,
    vendor.location_text,
    vendor.final_contact_email,
    vendor.final_contact_phone,
    vendor.final_contact_address,
    vendor.website_details,
    vendor.contact_notes,
    vendor.about_vendor,
    productNames,
    (vendor.tags || []).join(' '),
  ].join(' ').toLowerCase();
}

function filterAdminVendors() {
  const query = String(adminSearchInput.value || '').trim().toLowerCase();
  const vendors = [...adminState.vendors].sort((left, right) => String(left.vendor_name || '').localeCompare(String(right.vendor_name || '')));
  adminState.filteredVendors = !query
    ? vendors
    : vendors.filter((vendor) => buildVendorSearchText(vendor).includes(query));
}

function renderAdminResults() {
  adminSearchResults.innerHTML = '';
  if (!adminState.filteredVendors.length) {
    adminSearchResults.innerHTML = '<article class="admin-card"><p>No innovator records matched this search.</p></article>';
    adminSearchMeta.textContent = 'No matching innovator records found.';
    return;
  }

  adminSearchMeta.textContent = `${adminState.filteredVendors.length} innovator record${adminState.filteredVendors.length === 1 ? '' : 's'} found`;
  adminState.filteredVendors.forEach((vendor) => {
    const products = adminState.products.filter((product) => product.portal_vendor_id === vendor.portal_vendor_id).slice(0, 3);
    const card = document.createElement('article');
    card.className = `admin-card admin-search-card${vendor.portal_vendor_id === adminState.selectedVendorId ? ' active' : ''}`;
    card.innerHTML = `<div class="admin-card-header"><h4>${escapeHtml(vendor.vendor_name || 'Unknown Innovator')}</h4><span class="admin-badge approved">${escapeHtml(String(products.length || vendor.products_count || 0))} innovations</span></div><p><strong>Location:</strong> ${escapeHtml(vendor.location_text || vendor.final_contact_address || 'Not listed')}</p><p><strong>Contact:</strong> ${escapeHtml(vendor.final_contact_email || 'No email')} | ${escapeHtml(vendor.final_contact_phone || 'No phone')}</p><small>${escapeHtml(products.map((product) => product.product_name).join(' | ') || 'No linked innovations listed')}</small>`;
    card.addEventListener('click', () => selectVendor(vendor.portal_vendor_id));
    adminSearchResults.appendChild(card);
  });
}

function setEditorVisible(isVisible) {
  adminEditorEmpty.style.display = isVisible ? 'none' : 'block';
  adminEditorFields.classList.toggle('active', Boolean(isVisible));
}

function fillEditor(vendor) {
  editEls.vendorId.value = vendor.portal_vendor_id || '';
  editEls.vendorName.value = vendor.vendor_name || '';
  editEls.portalContactName.value = vendor.portal_contact_name || '';
  editEls.locationText.value = vendor.location_text || '';
  editEls.finalContactEmail.value = vendor.final_contact_email || '';
  editEls.finalContactPhone.value = vendor.final_contact_phone || '';
  editEls.finalContactAddress.value = vendor.final_contact_address || '';
  editEls.websiteDetails.value = vendor.website_details || '';
  editEls.contactSourceUrl.value = vendor.contact_source_url || '';
  editEls.websiteStatus.value = vendor.website_status || '';
  editEls.aboutVendor.value = vendor.about_vendor || '';
  editEls.contactNotes.value = vendor.contact_notes || '';
  setEditorVisible(true);
}

function selectVendor(vendorId) {
  adminState.selectedVendorId = vendorId;
  const vendor = adminState.vendors.find((item) => item.portal_vendor_id === vendorId);
  if (!vendor) {
    setEditorVisible(false);
    return;
  }
  fillEditor(vendor);
  renderAdminResults();
  setStatus(adminEditStatus, '');
}

async function loadAdminDirectory() {
  if (!getStoredToken()) return;
  adminSearchMeta.textContent = 'Loading innovator records...';
  try {
    const { vendors, products } = await InnovationStore.loadAdminRecords();
    adminState.vendors = Array.isArray(vendors) ? vendors : [];
    adminState.products = Array.isArray(products) ? products : [];
    filterAdminVendors();
    renderAdminResults();
    if (adminState.selectedVendorId && adminState.vendors.some((item) => item.portal_vendor_id === adminState.selectedVendorId)) {
      selectVendor(adminState.selectedVendorId);
    } else {
      adminState.selectedVendorId = '';
      setEditorVisible(false);
    }
  } catch (error) {
    adminSearchMeta.textContent = error.message || 'Innovator records could not be loaded.';
    adminSearchResults.innerHTML = '';
  }
}

async function verifySession() {
  const token = getStoredToken();
  if (!token) {
    updateSessionUi(false);
    return false;
  }
  try {
    const data = await InnovationStore.adminRequest('verify', { token });
    if (!data?.valid) throw new Error('Session invalid');
    updateSessionUi(true);
    return true;
  } catch {
    storeToken('');
    updateSessionUi(false);
    innovationSyncMeta.textContent = 'Your admin session has expired. Please sign in again.';
    adminSearchMeta.textContent = 'Your admin session has expired. Please sign in again.';
    return false;
  }
}

async function loadInnovationSyncRuns() {
  const token = getStoredToken();
  if (!token) {
    innovationSyncMeta.textContent = 'Sign in as admin to view and run sync operations.';
    innovationSyncRuns.innerHTML = '';
    return;
  }
  innovationSyncMeta.textContent = 'Loading GIAN sync history...';
  try {
    const data = await InnovationStore.adminRequest('listGianSyncRuns', { token });
    const items = Array.isArray(data?.items) ? data.items : [];
    innovationSyncMeta.textContent = `${items.length} GIAN sync run${items.length === 1 ? '' : 's'} recorded`;
    renderInnovationSyncRuns(items);
  } catch (error) {
    innovationSyncMeta.textContent = error.message || 'GIAN sync history could not be loaded.';
  }
}

async function runInnovationSync() {
  runInnovationSyncButton.disabled = true;
  setStatus(sessionStatus, 'Running manual new-records sync...');
  try {
    const data = await InnovationStore.adminRequest('syncGianDirectory', { token: getStoredToken() });
    setStatus(sessionStatus, `Manual sync completed: ${data.vendorCount || 0} innovators and ${data.productCount || 0} innovations inserted. Existing records were left unchanged.`);
    await Promise.all([loadInnovationSyncRuns(), loadAdminDirectory()]);
  } catch (error) {
    setStatus(sessionStatus, error.message || 'GIAN sync failed.', true);
  } finally {
    runInnovationSyncButton.disabled = false;
  }
}

async function saveInnovatorEdits(event) {
  event.preventDefault();
  const token = getStoredToken();
  const portalVendorId = String(editEls.vendorId.value || '').trim();
  if (!token || !portalVendorId) {
    setStatus(adminEditStatus, 'Select an innovator record first.', true);
    return;
  }

  saveInnovatorButton.disabled = true;
  setStatus(adminEditStatus, 'Saving changes...');
  try {
    const payload = {
      token,
      portalVendorId,
      updates: {
        vendor_name: editEls.vendorName.value,
        portal_contact_name: editEls.portalContactName.value,
        location_text: editEls.locationText.value,
        final_contact_email: editEls.finalContactEmail.value,
        final_contact_phone: editEls.finalContactPhone.value,
        final_contact_address: editEls.finalContactAddress.value,
        website_details: editEls.websiteDetails.value,
        contact_source_url: editEls.contactSourceUrl.value,
        website_status: editEls.websiteStatus.value,
        about_vendor: editEls.aboutVendor.value,
        contact_notes: editEls.contactNotes.value,
      },
    };
    await InnovationStore.adminRequest('updateGianInnovator', payload);
    setStatus(adminEditStatus, 'Innovator record updated.');
    await loadAdminDirectory();
    selectVendor(portalVendorId);
  } catch (error) {
    setStatus(adminEditStatus, error.message || 'Innovator update failed.', true);
  } finally {
    saveInnovatorButton.disabled = false;
  }
}

loginForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const password = String(document.getElementById('adminPassword').value || '').trim();
  if (!password) {
    setStatus(loginStatus, 'Enter the admin password.', true);
    return;
  }
  setStatus(loginStatus, 'Signing in...');
  try {
    const data = await InnovationStore.adminRequest('login', { password });
    if (!data?.token) throw new Error('Admin login failed.');
    storeToken(data.token);
    document.getElementById('adminPassword').value = '';
    updateSessionUi(true);
    setStatus(loginStatus, 'Signed in successfully.');
    await Promise.all([loadInnovationSyncRuns(), loadAdminDirectory()]);
  } catch (error) {
    setStatus(loginStatus, error.message || 'Admin login failed.', true);
  }
});

signOutButton.addEventListener('click', async () => {
  const token = getStoredToken();
  try {
    if (token) await InnovationStore.adminRequest('logout', { token });
  } catch {}
  storeToken('');
  adminState.vendors = [];
  adminState.products = [];
  adminState.filteredVendors = [];
  adminState.selectedVendorId = '';
  updateSessionUi(false);
  innovationSyncMeta.textContent = 'Sign in as admin to view and run sync operations.';
  adminSearchMeta.textContent = 'Sign in as admin to search and edit innovator records.';
  innovationSyncRuns.innerHTML = '';
  adminSearchResults.innerHTML = '';
  setEditorVisible(false);
  setStatus(sessionStatus, '');
  setStatus(loginStatus, '');
  setStatus(adminEditStatus, '');
});

runInnovationSyncButton.addEventListener('click', async () => { await runInnovationSync(); });
adminSearchInput.addEventListener('input', () => {
  filterAdminVendors();
  renderAdminResults();
});
adminEditForm.addEventListener('submit', saveInnovatorEdits);

(async () => {
  const valid = await verifySession();
  if (valid) await Promise.all([loadInnovationSyncRuns(), loadAdminDirectory()]);
})();
