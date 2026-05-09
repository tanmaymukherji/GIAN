const loginForm = document.getElementById('loginForm');
const loginStatus = document.getElementById('loginStatus');
const sessionStatus = document.getElementById('sessionStatus');
const sessionPanel = document.getElementById('sessionPanel');
const innovationSyncPanel = document.getElementById('innovationSyncPanel');
const innovationSyncMeta = document.getElementById('innovationSyncMeta');
const innovationSyncRuns = document.getElementById('innovationSyncRuns');
const runInnovationSyncButton = document.getElementById('runInnovationSync');
const signOutButton = document.getElementById('signOutButton');
const innovationSyncRunningIndicator = document.getElementById('innovationSyncRunningIndicator');
const innovationSyncRunningText = document.getElementById('innovationSyncRunningText');
const adminEditorPanel = document.getElementById('adminEditorPanel');
const adminSearchInput = document.getElementById('adminSearchInput');
const adminSearchMeta = document.getElementById('adminSearchMeta');
const adminSearchResults = document.getElementById('adminSearchResults');
const adminPracticeList = document.getElementById('adminPracticeList');
const adminEditForm = document.getElementById('adminEditForm');
const adminPracticeForm = document.getElementById('adminPracticeForm');
const adminEditorEmpty = document.getElementById('adminEditorEmpty');
const adminEditorFields = document.getElementById('adminEditorFields');
const adminEditStatus = document.getElementById('adminEditStatus');
const adminPracticeEmpty = document.getElementById('adminPracticeEmpty');
const adminPracticeFields = document.getElementById('adminPracticeFields');
const adminPracticeStatus = document.getElementById('adminPracticeStatus');
const saveInnovatorButton = document.getElementById('saveInnovatorButton');
const savePracticeButton = document.getElementById('savePracticeButton');

const ADMIN_SESSION_KEY = 'gian-innovation-admin-session';
const SYNC_STALE_MINUTES = 10;
const SIX_M_OPTIONS = ['Manpower', 'Method', 'Material', 'Machine', 'Money', 'Market'];
const adminState = {
  vendors: [],
  products: [],
  filteredVendors: [],
  selectedVendorId: '',
  selectedProductId: '',
  syncPollTimer: null,
  syncPendingRefresh: false,
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

const editPracticeEls = {
  productId: document.getElementById('editProductId'),
  productName: document.getElementById('editProductName'),
  sourceTags: document.getElementById('editProductSourceTags'),
  reviewedTags: document.getElementById('editProductReviewedTags'),
  sixm: document.getElementById('editProductSixM'),
  adminNotes: document.getElementById('editProductAdminNotes'),
  productLink: document.getElementById('editProductLink'),
};

function setStatus(element, message, isError = false) {
  element.textContent = message || '';
  element.classList.toggle('error', Boolean(isError));
}

function escapeHtml(value) {
  return String(value || '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;');
}

function formatDate(value) {
  if (!value) return 'Unknown date';
  return new Date(value).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' });
}

function parseCommaList(value) {
  return [...new Set(String(value || '').split(',').map((item) => item.trim()).filter(Boolean))];
}

function normalizeSixMValues(value) {
  const allowed = new Map(SIX_M_OPTIONS.map((item) => [item.toLowerCase(), item]));
  return parseCommaList(value)
    .map((item) => allowed.get(String(item || '').trim().toLowerCase()) || '')
    .filter(Boolean);
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

function clearSyncPollTimer() {
  if (adminState.syncPollTimer) {
    window.clearTimeout(adminState.syncPollTimer);
    adminState.syncPollTimer = null;
  }
}

function setRunningIndicator(isRunning, message = '') {
  if (!innovationSyncRunningIndicator || !innovationSyncRunningText) return;
  innovationSyncRunningIndicator.hidden = !isRunning;
  innovationSyncRunningText.textContent = message || 'GIAN sync is running. This screen will refresh automatically when it completes.';
}

function scheduleSyncStatusPoll(delay = 15000) {
  clearSyncPollTimer();
  if (!getStoredToken()) return;
  adminState.syncPollTimer = window.setTimeout(() => {
    refreshSyncMonitor().catch(() => {});
  }, delay);
}

function getEffectiveSyncRun(item) {
  const status = String(item?.status || '').trim().toLowerCase();
  if (status !== 'running') return { ...item, effective_status: status || 'unknown' };
  const basis = item?.started_at || item?.created_at;
  const startedMs = basis ? new Date(basis).getTime() : 0;
  const staleBeforeMs = Date.now() - SYNC_STALE_MINUTES * 60 * 1000;
  if (!Number.isFinite(startedMs) || startedMs <= 0 || startedMs >= staleBeforeMs) {
    return { ...item, effective_status: 'running' };
  }
  return {
    ...item,
    effective_status: 'failed',
    finished_at: item?.finished_at || new Date().toISOString(),
    error_message: item?.error_message || `Marked failed in admin view after exceeding ${SYNC_STALE_MINUTES} minutes in running state.`,
  };
}

function renderInnovationSyncRuns(items) {
  innovationSyncRuns.innerHTML = '';
  if (!items.length) {
    innovationSyncRuns.innerHTML = '<article class="admin-card"><p>No GIAN sync runs yet.</p></article>';
    return { hasRunning: false };
  }
  let hasRunning = false;
  items.forEach((rawItem) => {
    const item = getEffectiveSyncRun(rawItem);
    if (item.effective_status === 'running' || item.effective_status === 'queued') hasRunning = true;
    const card = document.createElement('article');
    card.className = 'admin-card';
    const summary = item.effective_status === 'success'
      ? `${item.vendor_count || 0} innovators and ${item.product_count || 0} innovations inserted`
      : item.error_message || 'No details recorded.';
    card.innerHTML = `<div class="admin-card-header"><h4>${escapeHtml(item.effective_status || item.status || 'unknown')}</h4><span class="admin-badge ${item.effective_status === 'success' ? 'approved' : ''}">${escapeHtml(item.effective_status || item.status || 'unknown')}</span></div><p><strong>Requested By:</strong> ${escapeHtml(item.requested_by || 'Unknown')}</p><p><strong>Started:</strong> ${escapeHtml(formatDate(item.started_at || item.created_at))}</p><p><strong>Finished:</strong> ${escapeHtml(formatDate(item.finished_at))}</p><p><strong>Summary:</strong> ${escapeHtml(summary)}</p><p><strong>Error:</strong> ${escapeHtml(item.error_message || 'None')}</p><div class="btn-group"><button class="btn btn-danger btn-small" type="button" data-delete-sync-run="${escapeHtml(item.id || '')}">Delete Log</button></div>`;
    card.querySelector('[data-delete-sync-run]')?.addEventListener('click', () => deleteInnovationSyncRun(item.id));
    innovationSyncRuns.appendChild(card);
  });
  return { hasRunning };
}

async function deleteInnovationSyncRun(runId) {
  if (!runId) return;
  setStatus(sessionStatus, 'Deleting sync log...');
  try {
    await InnovationStore.adminRequest('deleteGianSyncRun', { token: getStoredToken(), runId });
    setStatus(sessionStatus, 'Sync log deleted.');
    await loadInnovationSyncRuns();
  } catch (error) {
    setStatus(sessionStatus, error.message || 'Sync log could not be deleted.', true);
  }
}

function getEffectiveProductTags(product) {
  const reviewed = Array.isArray(product?.reviewed_tags) ? product.reviewed_tags.filter(Boolean) : [];
  return reviewed.length ? reviewed : (Array.isArray(product?.tags) ? product.tags.filter(Boolean) : []);
}

function deriveSixMFromProduct(product) {
  const text = [
    product?.product_name,
    product?.product_description,
    product?.product_location_text,
    ...(Array.isArray(product?.tags) ? product.tags : []),
    ...(Array.isArray(product?.reviewed_tags) ? product.reviewed_tags : []),
  ].join(' ').toLowerCase();
  const categories = [];
  if (/(training|capacity|skill|employment|livelihood|women|children|artisan|farmer producer)/i.test(text)) categories.push('Manpower');
  if (/(method|process|technique|practice|variety|grafting|cultivation|design|model|system|manual|protocol)/i.test(text)) categories.push('Method');
  if (/(clay|bamboo|wood|cow dung|fabric|fiber|material|weft)/i.test(text)) categories.push('Material');
  if (/(machine|device|tool|equipment|holder|carrier|cooler|sprayer|tractor|climber|chakki|polyhouse|automated)/i.test(text)) categories.push('Machine');
  if (/(finance|financial|credit|loan|fund|investment|cost saving|income support)/i.test(text)) categories.push('Money');
  if (/(market|marketing|buyer|sales|sold|export|retail|portal|business|commerciali[sz]ation)/i.test(text)) categories.push('Market');
  return [...new Set(categories)];
}

function getEffectiveProductSixM(product) {
  const reviewed = Array.isArray(product?.six_m_categories) ? product.six_m_categories.filter(Boolean) : [];
  return reviewed.length ? reviewed : deriveSixMFromProduct(product);
}

function getPracticeRecordsForVendor(vendorId) {
  return adminState.products
    .filter((product) => product.portal_vendor_id === vendorId)
    .sort((left, right) => String(left.product_name || '').localeCompare(String(right.product_name || '')));
}

function getSelectedPractice() {
  return adminState.products.find((item) => item.portal_product_id === adminState.selectedProductId) || null;
}

function buildVendorSearchText(vendor) {
  const linkedProducts = getPracticeRecordsForVendor(vendor.portal_vendor_id);
  const innovationNames = linkedProducts.map((product) => product.product_name).join(' ');
  const innovationTags = linkedProducts.flatMap((product) => getEffectiveProductTags(product)).join(' ');
  const innovationSixM = linkedProducts.flatMap((product) => getEffectiveProductSixM(product)).join(' ');
  return [
    vendor.vendor_name,
    vendor.portal_contact_name,
    vendor.location_text,
    vendor.final_contact_email,
    vendor.final_contact_phone,
    vendor.final_contact_address,
    vendor.about_vendor,
    vendor.contact_notes,
    innovationNames,
    innovationTags,
    innovationSixM,
    (vendor.tags || []).join(' '),
  ].join(' ').toLowerCase();
}

function filterAdminVendors() {
  const query = String(adminSearchInput.value || '').trim().toLowerCase();
  const vendors = [...adminState.vendors].sort((left, right) => String(left.vendor_name || '').localeCompare(String(right.vendor_name || '')));
  adminState.filteredVendors = vendors.filter((vendor) => !query || buildVendorSearchText(vendor).includes(query));
}

function renderPracticeList(vendorId) {
  adminPracticeList.innerHTML = '';
  if (!vendorId) {
    adminPracticeList.innerHTML = '<article class="admin-card"><p>Select an innovator to review its innovations.</p></article>';
    return;
  }
  const products = getPracticeRecordsForVendor(vendorId);
  if (!products.length) {
    adminPracticeList.innerHTML = '<article class="admin-card"><p>No innovations were synced for this innovator.</p></article>';
    return;
  }
  products.forEach((product) => {
    const card = document.createElement('article');
    card.className = `admin-card admin-search-card${product.portal_product_id === adminState.selectedProductId ? ' active' : ''}`;
    card.innerHTML = `<div class="admin-card-header"><h4>${escapeHtml(product.product_name || 'Untitled innovation')}</h4><span class="admin-badge approved">${escapeHtml(getEffectiveProductSixM(product).join(', ') || 'No 6M')}</span></div><p><strong>Tags:</strong> ${escapeHtml(getEffectiveProductTags(product).join(', ') || 'Not tagged')}</p><p><strong>Location:</strong> ${escapeHtml(product.product_location_text || 'Not listed')}</p>`;
    card.addEventListener('click', () => selectPractice(product.portal_product_id));
    adminPracticeList.appendChild(card);
  });
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
    const products = getPracticeRecordsForVendor(vendor.portal_vendor_id).slice(0, 3);
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

function setPracticeEditorVisible(isVisible) {
  adminPracticeEmpty.style.display = isVisible ? 'none' : 'block';
  adminPracticeFields.classList.toggle('active', Boolean(isVisible));
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

function fillPracticeEditor(product) {
  editPracticeEls.productId.value = product.portal_product_id || '';
  editPracticeEls.productName.value = product.product_name || '';
  editPracticeEls.sourceTags.value = (Array.isArray(product.tags) ? product.tags.join(', ') : '') || '';
  editPracticeEls.reviewedTags.value = getEffectiveProductTags(product).join(', ');
  editPracticeEls.sixm.value = getEffectiveProductSixM(product).join(', ');
  editPracticeEls.adminNotes.value = product.admin_notes || '';
  editPracticeEls.productLink.value = product.product_link || '';
  setPracticeEditorVisible(true);
}

function selectPractice(productId) {
  adminState.selectedProductId = productId;
  const product = getSelectedPractice();
  if (!product) {
    setPracticeEditorVisible(false);
    return;
  }
  fillPracticeEditor(product);
  renderPracticeList(adminState.selectedVendorId);
  setStatus(adminPracticeStatus, '');
}

function selectVendor(vendorId) {
  adminState.selectedVendorId = vendorId;
  const vendor = adminState.vendors.find((item) => item.portal_vendor_id === vendorId);
  if (!vendor) {
    setEditorVisible(false);
    renderPracticeList('');
    setPracticeEditorVisible(false);
    return;
  }
  fillEditor(vendor);
  renderAdminResults();
  renderPracticeList(vendorId);
  const firstProduct = getPracticeRecordsForVendor(vendorId)[0];
  if (firstProduct) selectPractice(firstProduct.portal_product_id);
  else {
    adminState.selectedProductId = '';
    setPracticeEditorVisible(false);
  }
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
      adminState.selectedProductId = '';
      setEditorVisible(false);
      setPracticeEditorVisible(false);
      renderPracticeList('');
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
    clearSyncPollTimer();
    setRunningIndicator(false);
    updateSessionUi(false);
    innovationSyncMeta.textContent = 'Your admin session has expired. Please sign in again.';
    adminSearchMeta.textContent = 'Your admin session has expired. Please sign in again.';
    return false;
  }
}

async function loadInnovationSyncRuns() {
  const token = getStoredToken();
  if (!token) {
    clearSyncPollTimer();
    setRunningIndicator(false);
    innovationSyncMeta.textContent = 'Sign in as admin to view and run sync operations.';
    innovationSyncRuns.innerHTML = '';
    return { hasRunning: false };
  }
  innovationSyncMeta.textContent = 'Loading GIAN sync history...';
  try {
    const data = await InnovationStore.adminRequest('listGianSyncRuns', { token });
    const items = Array.isArray(data?.items) ? data.items : [];
    innovationSyncMeta.textContent = `${items.length} GIAN sync run${items.length === 1 ? '' : 's'} recorded`;
    return renderInnovationSyncRuns(items);
  } catch (error) {
    setRunningIndicator(false);
    innovationSyncMeta.textContent = error.message || 'GIAN sync history could not be loaded.';
    return { hasRunning: false };
  }
}

async function refreshSyncMonitor() {
  const state = await loadInnovationSyncRuns();
  if (state.hasRunning) {
    setRunningIndicator(true, 'GIAN sync is running. This screen will refresh automatically when it completes.');
    scheduleSyncStatusPoll(15000);
    return;
  }
  clearSyncPollTimer();
  setRunningIndicator(false);
  if (adminState.syncPendingRefresh) {
    adminState.syncPendingRefresh = false;
    setStatus(sessionStatus, 'GIAN sync completed. Refreshing saved data...');
    await Promise.all([loadAdminDirectory(), loadInnovationSyncRuns()]);
    setStatus(sessionStatus, 'GIAN sync completed. The screen refreshed automatically.');
  }
}

async function runInnovationSync() {
  runInnovationSyncButton.disabled = true;
  setStatus(sessionStatus, 'Running lightweight new-records sync...');
  try {
    const data = await InnovationStore.adminRequest('syncGianDirectory', { token: getStoredToken() });
    adminState.syncPendingRefresh = true;
    setRunningIndicator(true, 'GIAN sync finished this request. Refreshing the admin view...');
    setStatus(sessionStatus, data.message || `Manual sync completed: ${data.vendorCount || 0} innovators and ${data.productCount || 0} innovations inserted.`);
    await refreshSyncMonitor();
  } catch (error) {
    adminState.syncPendingRefresh = false;
    setRunningIndicator(false);
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
  setStatus(adminEditStatus, 'Saving innovator changes...');
  try {
    await InnovationStore.adminRequest('updateGianInnovator', {
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
    });
    setStatus(adminEditStatus, 'Innovator record updated.');
    await loadAdminDirectory();
    selectVendor(portalVendorId);
  } catch (error) {
    setStatus(adminEditStatus, error.message || 'Innovator update failed.', true);
  } finally {
    saveInnovatorButton.disabled = false;
  }
}

async function savePracticeEdits(event) {
  event.preventDefault();
  const token = getStoredToken();
  const portalProductId = String(editPracticeEls.productId.value || '').trim();
  if (!token || !portalProductId) {
    setStatus(adminPracticeStatus, 'Select an innovation record first.', true);
    return;
  }
  savePracticeButton.disabled = true;
  setStatus(adminPracticeStatus, 'Saving innovation classification...');
  try {
    await InnovationStore.adminRequest('updateGianInnovation', {
      token,
      portalProductId,
      updates: {
        reviewed_tags: parseCommaList(editPracticeEls.reviewedTags.value),
        six_m_categories: normalizeSixMValues(editPracticeEls.sixm.value),
        admin_notes: editPracticeEls.adminNotes.value,
      },
    });
    setStatus(adminPracticeStatus, 'Innovation classification updated.');
    await loadAdminDirectory();
    selectVendor(adminState.selectedVendorId);
    selectPractice(portalProductId);
  } catch (error) {
    setStatus(adminPracticeStatus, error.message || 'Innovation classification update failed.', true);
  } finally {
    savePracticeButton.disabled = false;
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
    await Promise.all([refreshSyncMonitor(), loadAdminDirectory()]);
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
  adminState.syncPendingRefresh = false;
  clearSyncPollTimer();
  setRunningIndicator(false);
  adminState.vendors = [];
  adminState.products = [];
  adminState.filteredVendors = [];
  adminState.selectedVendorId = '';
  adminState.selectedProductId = '';
  updateSessionUi(false);
  innovationSyncMeta.textContent = 'Sign in as admin to view and run sync operations.';
  adminSearchMeta.textContent = 'Sign in as admin to search and edit innovator records.';
  innovationSyncRuns.innerHTML = '';
  adminSearchResults.innerHTML = '';
  adminPracticeList.innerHTML = '';
  setEditorVisible(false);
  setPracticeEditorVisible(false);
  setStatus(sessionStatus, '');
  setStatus(loginStatus, '');
  setStatus(adminEditStatus, '');
  setStatus(adminPracticeStatus, '');
});

runInnovationSyncButton.addEventListener('click', async () => { await runInnovationSync(); });
adminSearchInput.addEventListener('input', () => {
  filterAdminVendors();
  renderAdminResults();
});
adminEditForm.addEventListener('submit', saveInnovatorEdits);
adminPracticeForm.addEventListener('submit', savePracticeEdits);

(async () => {
  const valid = await verifySession();
  if (valid) await Promise.all([refreshSyncMonitor(), loadAdminDirectory()]);
})();
