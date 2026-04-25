window.InnovationStore = (() => {
  const VENDORS_TABLE = () => (window.APP_CONFIG && window.APP_CONFIG.GIAN_INNOVATORS_TABLE) || 'gian_innovators';
  const PRODUCTS_TABLE = () => (window.APP_CONFIG && window.APP_CONFIG.GIAN_INNOVATIONS_TABLE) || 'gian_innovations';
  const ADMIN_API_URL = () => `${String(window.APP_CONFIG?.SUPABASE_URL || '').replace(/\/$/, '')}/functions/v1/gian-innovation-admin`;
  let client = null;

  function normalizeText(value) {
    return String(value || '').trim().toLowerCase();
  }

  function uniqueValues(values) {
    return [...new Set((values || []).map((value) => String(value || '').trim()).filter(Boolean))];
  }

  function chooseLongerText(currentValue, nextValue) {
    const currentText = String(currentValue || '').trim();
    const nextText = String(nextValue || '').trim();
    return nextText.length > currentText.length ? nextValue : currentValue;
  }

  function choosePreferredNumber(currentValue, nextValue) {
    const currentNumber = Number(currentValue);
    if (Number.isFinite(currentNumber) && Math.abs(currentNumber) > 0.0001) return currentValue;
    const nextNumber = Number(nextValue);
    return Number.isFinite(nextNumber) && Math.abs(nextNumber) > 0.0001 ? nextValue : currentValue;
  }

  function buildVendorMergeKey(vendor) {
    const address = String(vendor.final_contact_address || vendor.location_text || '').split('|')[0];
    return `${normalizeText(vendor.vendor_name)}|${normalizeText(address)}`;
  }

  function mergeVendorRecords(vendors, products) {
    const productsByVendorId = new Map();
    products.forEach((product) => {
      const vendorId = product.portal_vendor_id;
      if (!productsByVendorId.has(vendorId)) productsByVendorId.set(vendorId, []);
      productsByVendorId.get(vendorId).push(product);
    });

    const groupedVendors = new Map();
    vendors.forEach((vendor) => {
      const key = buildVendorMergeKey(vendor);
      const group = groupedVendors.get(key) || [];
      group.push(vendor);
      groupedVendors.set(key, group);
    });

    const mergedVendors = [];
    const vendorIdMap = new Map();

    groupedVendors.forEach((group) => {
      const primaryVendor = [...group].sort((left, right) => {
        const leftProducts = Number(left.products_count || productsByVendorId.get(left.portal_vendor_id)?.length || 0);
        const rightProducts = Number(right.products_count || productsByVendorId.get(right.portal_vendor_id)?.length || 0);
        return rightProducts - leftProducts || String(left.portal_vendor_id || '').localeCompare(String(right.portal_vendor_id || ''));
      })[0];

      const mergedVendor = { ...primaryVendor };
      const mergedProducts = [];

      group.forEach((vendor) => {
        vendorIdMap.set(vendor.portal_vendor_id, primaryVendor.portal_vendor_id);
        mergedVendor.about_vendor = chooseLongerText(mergedVendor.about_vendor, vendor.about_vendor);
        mergedVendor.location_text = chooseLongerText(mergedVendor.location_text, vendor.location_text);
        mergedVendor.final_contact_address = chooseLongerText(mergedVendor.final_contact_address, vendor.final_contact_address);
        mergedVendor.website_details = chooseLongerText(mergedVendor.website_details, vendor.website_details);
        mergedVendor.final_contact_email = chooseLongerText(mergedVendor.final_contact_email, vendor.final_contact_email);
        mergedVendor.final_contact_phone = chooseLongerText(mergedVendor.final_contact_phone, vendor.final_contact_phone);
        mergedVendor.portal_email = chooseLongerText(mergedVendor.portal_email, vendor.portal_email);
        mergedVendor.portal_phone = chooseLongerText(mergedVendor.portal_phone, vendor.portal_phone);
        mergedVendor.website_email = chooseLongerText(mergedVendor.website_email, vendor.website_email);
        mergedVendor.website_phone = chooseLongerText(mergedVendor.website_phone, vendor.website_phone);
        mergedVendor.contact_notes = chooseLongerText(mergedVendor.contact_notes, vendor.contact_notes);
        mergedVendor.website_status = chooseLongerText(mergedVendor.website_status, vendor.website_status);
        mergedVendor.latitude = choosePreferredNumber(mergedVendor.latitude, vendor.latitude);
        mergedVendor.longitude = choosePreferredNumber(mergedVendor.longitude, vendor.longitude);
        mergedVendor.tags = uniqueValues([...(mergedVendor.tags || []), ...(vendor.tags || [])]);
        mergedVendor.service_locations = uniqueValues([...(mergedVendor.service_locations || []), ...(vendor.service_locations || [])]);
        mergedVendor.innovator_image_urls = uniqueValues([...(mergedVendor.innovator_image_urls || []), ...(vendor.innovator_image_urls || [])]);
        mergedVendor.innovator_media_urls = uniqueValues([...(mergedVendor.innovator_media_urls || []), ...(vendor.innovator_media_urls || [])]);
        mergedVendor.alias_vendor_ids = uniqueValues([...(mergedVendor.alias_vendor_ids || []), vendor.portal_vendor_id]);
        mergedProducts.push(...(productsByVendorId.get(vendor.portal_vendor_id) || []));
      });

      const productMap = new Map();
      mergedProducts.forEach((product) => {
        productMap.set(product.portal_product_id, {
          ...product,
          portal_vendor_id: primaryVendor.portal_vendor_id,
          vendor_name: mergedVendor.vendor_name,
        });
      });

      mergedVendor.products = Array.from(productMap.values()).sort((left, right) => String(left.product_name || '').localeCompare(String(right.product_name || '')));
      mergedVendor.products_count = mergedVendor.products.length;
      mergedVendors.push(mergedVendor);
    });

    const mergedProducts = products.map((product) => ({
      ...product,
      portal_vendor_id: vendorIdMap.get(product.portal_vendor_id) || product.portal_vendor_id,
    }));

    return { vendors: mergedVendors.sort((left, right) => String(left.vendor_name || '').localeCompare(String(right.vendor_name || ''))), products: mergedProducts };
  }

  function getClient() {
    if (client) return client;
    const config = window.APP_CONFIG || {};
    if (!config.SUPABASE_URL || !config.SUPABASE_ANON_KEY) throw new Error('Missing Supabase config. Check config.js.');
    if (!window.supabase || typeof window.supabase.createClient !== 'function') throw new Error('Supabase client library failed to load.');
    client = window.supabase.createClient(config.SUPABASE_URL, config.SUPABASE_ANON_KEY);
    return client;
  }

  async function loadDirectory() {
    const supabase = getClient();
    const [vendorsResult, productsResult] = await Promise.all([
      supabase.from(VENDORS_TABLE()).select('*').order('vendor_name'),
      supabase.from(PRODUCTS_TABLE()).select('*').order('product_name')
    ]);

    if (vendorsResult.error) throw new Error(`Vendor load failed: ${vendorsResult.error.message}`);
    if (productsResult.error) throw new Error(`Product load failed: ${productsResult.error.message}`);

    const merged = mergeVendorRecords(vendorsResult.data || [], productsResult.data || []);
    return merged;
  }

  async function adminRequest(action, payload = {}) {
    const config = window.APP_CONFIG || {};
    const response = await fetch(ADMIN_API_URL(), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: String(config.SUPABASE_ANON_KEY || ''),
        Authorization: `Bearer ${String(config.SUPABASE_ANON_KEY || '')}`
      },
      body: JSON.stringify({ action, ...payload })
    });
    const rawText = await response.text().catch(() => '');
    let data = null;
    try {
      data = rawText ? JSON.parse(rawText) : null;
    } catch {}
    if (!response.ok) {
      throw new Error(data?.error || rawText || `Admin request failed (${response.status}).`);
    }
    return data;
  }

  return { loadDirectory, adminRequest };
})();
