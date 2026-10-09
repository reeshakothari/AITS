// Inline website editor. Runs only on /admin/edit/* pages.
// Text marked [data-e] is edited in place, images [data-e-img]/[data-e-bg] open an image dialog,
// links [data-e-href] get a link field, and [data-e-list] containers get add/move/duplicate/delete controls.
// Everything else is reachable from the Settings drawer. Edits autosave to the draft; Publish makes them live.
import { adminClient, setAdminCookie } from './admin-auth';

type Json = string | number | boolean | null | Json[] | { [k: string]: Json };
type Obj = { [k: string]: Json };

const boot = JSON.parse(document.getElementById('aits-editor-data')!.textContent!);
const { page, demo, supabaseUrl, anonKey, cookie } = boot as {
  page: string; demo: boolean; supabaseUrl: string; anonKey: string; cookie: string;
};
const data: Obj = boot.content;
let unpublished: boolean = boot.unpublished;
const dirty = new Set<string>();
const sb = demo ? null : adminClient(supabaseUrl, anonKey, cookie);
const BUCKET = 'aits-media';

/* ---------------- helpers ---------------- */

const h = <K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', text = ''): HTMLElementTagNameMap[K] => {
  const el = document.createElement(tag);
  if (cls) el.className = cls;
  if (text) el.textContent = text;
  return el;
};
const keysOf = (path: string) => path.split('.').map((k) => (/^\d+$/.test(k) ? Number(k) : k));

function getPath(path: string): Json | undefined {
  let o: Json | undefined = data;
  for (const k of keysOf(path)) {
    if (o === null || typeof o !== 'object') return undefined;
    o = (o as Record<string | number, Json>)[k];
  }
  return o;
}

function setPath(path: string, value: Json) {
  const ks = keysOf(path);
  let o = data as Record<string | number, Json>;
  ks.slice(0, -1).forEach((k, i) => {
    if (o[k] === null || typeof o[k] !== 'object') o[k] = typeof ks[i + 1] === 'number' ? [] : {};
    o = o[k] as Record<string | number, Json>;
  });
  o[ks[ks.length - 1]] = value;
  dirty.add(String(ks[0]));
  scheduleSave();
}

/* ---------------- status, saving, publishing ---------------- */

const statusEl = document.getElementById('aits-status')!;
const publishBtn = document.getElementById('aits-publish') as HTMLButtonElement;

function setStatus(text: string, tone: 'ok' | 'busy' | 'error' | '' = '') {
  statusEl.textContent = text;
  statusEl.dataset.tone = tone;
}
function refreshPublishState() {
  publishBtn.disabled = !unpublished;
  publishBtn.title = unpublished ? 'Make your changes live' : 'The live site already matches this draft';
}

async function demoCall(body: Record<string, unknown>) {
  const res = await fetch('/admin/api/demo/', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const out = await res.json();
  if (!res.ok || out.error) throw new Error(out.error ?? `Request failed (${res.status})`);
  return out;
}

let saveTimer: number | undefined;
function scheduleSave() {
  setStatus('Unsaved changes');
  window.clearTimeout(saveTimer);
  saveTimer = window.setTimeout(save, 700);
}

async function save(): Promise<boolean> {
  window.clearTimeout(saveTimer);
  if (!dirty.size) return true;
  const keys = [...dirty];
  dirty.clear();
  setStatus('Saving…', 'busy');
  try {
    for (const key of keys) {
      if (demo) await demoCall({ action: 'save', key, data: data[key] });
      else {
        const { error } = await sb!.from('aits_site_content').upsert({ key, status: 'draft', data: data[key], updated_at: new Date().toISOString() });
        if (error) throw error;
      }
    }
  } catch (err) {
    keys.forEach((k) => dirty.add(k));
    setStatus(`Not saved: ${(err as Error).message}. Your edits are kept; press Ctrl+S to retry.`, 'error');
    return false;
  }
  unpublished = true;
  refreshPublishState();
  setStatus('Draft saved · not live yet', 'ok');
  return true;
}

async function publish() {
  if (!(await save())) return;
  publishBtn.disabled = true;
  setStatus('Publishing…', 'busy');
  try {
    if (demo) await demoCall({ action: 'publish' });
    else {
      const { error } = await sb!.rpc('aits_publish_site');
      if (error) throw error;
    }
  } catch (err) {
    setStatus(`Not published: ${(err as Error).message}`, 'error');
    refreshPublishState();
    return;
  }
  unpublished = false;
  refreshPublishState();
  setStatus('Published. The live site now shows these changes.', 'ok');
  toast('Published to the live site');
}

async function discard() {
  if (!confirm('Discard every change that has not been published yet? The editor will go back to what the live site shows.')) return;
  window.clearTimeout(saveTimer);
  dirty.clear();
  try {
    if (demo) await demoCall({ action: 'discard' });
    else {
      const { error } = await sb!.rpc('aits_discard_draft');
      if (error) throw error;
    }
  } catch (err) {
    setStatus(`Could not discard: ${(err as Error).message}`, 'error');
    return;
  }
  reloadKeepingScroll();
}

function reloadKeepingScroll() {
  sessionStorage.setItem('aits-scroll', String(window.scrollY));
  location.reload();
}
const savedScroll = sessionStorage.getItem('aits-scroll');
if (savedScroll) {
  sessionStorage.removeItem('aits-scroll');
  requestAnimationFrame(() => window.scrollTo(0, Number(savedScroll)));
}

function toast(text: string) {
  const t = h('div', 'aits-toast aits-editor-ui', text);
  document.body.append(t);
  setTimeout(() => t.remove(), 3200);
}

/* ---------------- inline text ---------------- */

const plainOnly = (() => {
  const d = document.createElement('div');
  d.contentEditable = 'plaintext-only';
  return d.contentEditable === 'plaintext-only';
})();

function markEmpty(el: HTMLElement) {
  el.dataset.eEmpty = String(!(el.textContent ?? '').trim());
}

document.querySelectorAll<HTMLElement>('[data-e]').forEach((el) => {
  el.contentEditable = plainOnly ? 'plaintext-only' : 'true';
  el.spellcheck = true;
  markEmpty(el);
  el.addEventListener('input', () => {
    const path = el.dataset.e!;
    const value = (el.textContent ?? '').replace(/\s+/g, ' ').trim();
    setPath(path, value);
    markEmpty(el);
    document.querySelectorAll<HTMLElement>(`[data-e="${CSS.escape(path)}"]`).forEach((other) => {
      if (other !== el) other.textContent = value;
    });
  });
  el.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); el.blur(); }
  });
  el.addEventListener('paste', (e) => {
    e.preventDefault();
    const text = (e.clipboardData?.getData('text/plain') ?? '').replace(/\s+/g, ' ');
    document.execCommand('insertText', false, text);
  });
});

// Links, buttons and labels must not navigate or toggle while editing.
document.addEventListener('click', (e) => {
  const t = e.target as Element;
  if (t.closest('.aits-editor-ui')) return;
  if (t.closest('a') || t.closest('button[type="submit"]') || (t.closest('[data-e]') && t.closest('label'))) e.preventDefault();
  const img = t.closest<HTMLElement>('[data-e-img]');
  if (img) openImageDialog(img);
}, true);
document.addEventListener('submit', (e) => e.preventDefault(), true);

/* ---------------- link field ---------------- */

const linkBox = h('div', 'aits-link aits-editor-ui');
const linkInput = h('input');
linkInput.type = 'text';
linkInput.setAttribute('aria-label', 'Link address');
linkBox.append(h('span', '', 'Link'), linkInput);
document.body.append(linkBox);
let linkTarget: HTMLAnchorElement | null = null;

function showLink(a: HTMLAnchorElement) {
  linkTarget = a;
  linkInput.value = String(getPath(a.dataset.eHref!) ?? a.getAttribute('href') ?? '');
  const r = a.getBoundingClientRect();
  linkBox.style.top = `${Math.min(r.bottom + 8, window.innerHeight - 52)}px`;
  linkBox.style.left = `${Math.max(8, Math.min(r.left, window.innerWidth - 340))}px`;
  linkBox.classList.add('is-open');
}
linkInput.addEventListener('input', () => {
  if (!linkTarget) return;
  setPath(linkTarget.dataset.eHref!, linkInput.value.trim());
  linkTarget.setAttribute('href', linkInput.value.trim());
});
document.addEventListener('focusin', (e) => {
  const t = e.target as Element;
  if (linkBox.contains(t)) return;
  const a = t.closest<HTMLAnchorElement>('a[data-e-href]');
  if (a) showLink(a);
  else linkBox.classList.remove('is-open');
});
window.addEventListener('scroll', () => linkBox.classList.remove('is-open'), { passive: true });

/* ---------------- images ---------------- */

async function uploadImage(file: File): Promise<string> {
  if (!file.type.startsWith('image/')) throw new Error('That file is not an image.');
  if (file.size > 8 * 1024 * 1024) throw new Error('Images must be under 8 MB.');
  const safe = file.name.toLowerCase().replace(/[^a-z0-9.\-]+/g, '-');
  if (demo) {
    const base64 = await new Promise<string>((res, rej) => {
      const r = new FileReader();
      r.onload = () => res(String(r.result).split(',')[1]);
      r.onerror = () => rej(new Error('Could not read the file.'));
      r.readAsDataURL(file);
    });
    return (await demoCall({ action: 'upload', name: safe, base64 })).url;
  }
  const path = `${Date.now()}-${safe}`;
  const { error } = await sb!.storage.from(BUCKET).upload(path, file, { cacheControl: '31536000', contentType: file.type });
  if (error) throw error;
  return sb!.storage.from(BUCKET).getPublicUrl(path).data.publicUrl;
}

const dialog = h('dialog', 'aits-dialog aits-editor-ui');
document.body.append(dialog);

function openImageDialog(target: HTMLElement) {
  const isBg = target.hasAttribute('data-e-bg');
  const path = (isBg ? target.dataset.eBg : target.dataset.eImg)!;
  const altPath = target.dataset.eAlt;
  let url = String(getPath(path) ?? '');

  dialog.replaceChildren();
  const form = h('form');
  form.method = 'dialog';
  const preview = h('img', 'aits-dialog-preview');
  preview.src = url;
  preview.alt = '';
  const fileLabel = h('label', 'aits-upload');
  const file = h('input');
  file.type = 'file';
  file.accept = 'image/*';
  fileLabel.append(h('span', '', 'Upload a new image'), file);
  const urlField = field('Image address', url);
  const altField = altPath ? field('Description for screen readers and search (alt text)', String(getPath(altPath) ?? '')) : null;
  const msg = h('p', 'aits-dialog-msg');
  const actions = h('div', 'aits-dialog-actions');
  const cancel = h('button', 'aits-btn', 'Cancel');
  cancel.type = 'button';
  const apply = h('button', 'aits-btn aits-btn--primary', 'Use this image');
  apply.type = 'submit';
  actions.append(cancel, apply);
  form.append(h('h2', '', isBg ? 'Background image' : 'Image'), preview, fileLabel, urlField.wrap, ...(altField ? [altField.wrap] : []), msg, actions);
  dialog.append(form);

  file.addEventListener('change', async () => {
    const f = file.files?.[0];
    if (!f) return;
    msg.textContent = 'Uploading…';
    apply.disabled = true;
    try {
      url = await uploadImage(f);
      preview.src = url;
      urlField.input.value = url;
      msg.textContent = 'Uploaded. Press "Use this image" to place it.';
    } catch (err) {
      msg.textContent = `Upload failed: ${(err as Error).message}`;
    } finally {
      apply.disabled = false;
    }
  });
  urlField.input.addEventListener('input', () => { url = urlField.input.value.trim(); preview.src = url; });
  cancel.addEventListener('click', () => dialog.close());
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    setPath(path, url);
    if (isBg) target.style.backgroundImage = `url(${url})`;
    else (target as HTMLImageElement).src = url;
    if (altPath && altField) {
      setPath(altPath, altField.input.value.trim());
      (target as HTMLImageElement).alt = altField.input.value.trim();
    }
    dialog.close();
  });
  dialog.showModal();
}

function field(label: string, value: string, multiline = false) {
  const wrap = h('label', 'aits-field');
  const input = multiline ? h('textarea') : h('input');
  input.value = value;
  wrap.append(h('span', '', label), input);
  return { wrap, input };
}

// Background images sit behind content, so they get a visible button instead of a click target.
document.querySelectorAll<HTMLElement>('[data-e-bg]').forEach((bg) => {
  const btn = h('button', 'aits-bg-btn aits-editor-ui', 'Change background image');
  btn.type = 'button';
  btn.addEventListener('click', () => openImageDialog(bg));
  bg.parentElement?.append(btn);
});

/* ---------------- lists ---------------- */

const bar = h('div', 'aits-listbar aits-editor-ui');
const mk = (label: string, title: string, act: string) => {
  const b = h('button', '', label);
  b.type = 'button';
  b.title = title;
  b.setAttribute('aria-label', title);
  b.dataset.act = act;
  return b;
};
bar.append(mk('↑', 'Move earlier', 'up'), mk('↓', 'Move later', 'down'), mk('⧉', 'Duplicate', 'dup'), mk('+', 'Add item after', 'add'), mk('✕', 'Delete', 'del'));
document.body.append(bar);

let active: { list: HTMLElement; index: number | null } | null = null;
let hideTimer: number | undefined;
const itemsOf = (list: HTMLElement) => Array.from(list.children).filter((c) => !c.classList.contains('aits-editor-ui')) as HTMLElement[];

function findItem(t: Element): { list: HTMLElement; item: HTMLElement | null } | null {
  let n: Element | null = t;
  while (n && n !== document.body) {
    const p: HTMLElement | null = n.parentElement;
    if (p?.hasAttribute('data-e-list')) return { list: p, item: n as HTMLElement };
    n = p;
  }
  const list = t.closest<HTMLElement>('[data-e-list]');
  return list && itemsOf(list).length === 0 ? { list, item: null } : null;
}

document.addEventListener('mouseover', (e) => {
  const t = e.target as Element;
  if (bar.contains(t)) { window.clearTimeout(hideTimer); return; }
  const found = findItem(t);
  if (!found) { hideTimer = window.setTimeout(() => bar.classList.remove('is-open'), 250); return; }
  window.clearTimeout(hideTimer);
  const items = itemsOf(found.list);
  const index = found.item ? items.indexOf(found.item) : null;
  active = { list: found.list, index };
  const r = (found.item ?? found.list).getBoundingClientRect();
  bar.dataset.empty = String(index === null);
  (bar.querySelector('[data-act="up"]') as HTMLButtonElement).disabled = !index;
  (bar.querySelector('[data-act="down"]') as HTMLButtonElement).disabled = index === null || index >= items.length - 1;
  bar.style.top = `${Math.max(60, r.top - 34)}px`;
  bar.style.left = `${Math.max(8, Math.min(r.right - 170, window.innerWidth - 178))}px`;
  bar.classList.add('is-open');
});
window.addEventListener('scroll', () => bar.classList.remove('is-open'), { passive: true });

bar.addEventListener('click', async (e) => {
  const act = (e.target as HTMLElement).closest<HTMLElement>('[data-act]')?.dataset.act;
  if (!act || !active) return;
  const path = active.list.dataset.eList!;
  const arr = ((getPath(path) as Json[] | undefined) ?? []).slice();
  const i = active.index;
  const template = (): Json => {
    if (active!.list.dataset.eTpl) return JSON.parse(active!.list.dataset.eTpl);
    if (arr.length) return structuredClone(arr[arr.length - 1]);
    return 'New item';
  };
  if (act === 'up' && i) [arr[i - 1], arr[i]] = [arr[i], arr[i - 1]];
  else if (act === 'down' && i !== null && i < arr.length - 1) [arr[i + 1], arr[i]] = [arr[i], arr[i + 1]];
  else if (act === 'dup' && i !== null) arr.splice(i + 1, 0, structuredClone(arr[i]));
  else if (act === 'add') arr.splice(i === null ? arr.length : i + 1, 0, template());
  else if (act === 'del' && i !== null) {
    if (!confirm('Delete this item?')) return;
    arr.splice(i, 1);
  } else return;
  setPath(path, arr);
  if (await save()) reloadKeepingScroll();
});

/* ---------------- settings drawer ---------------- */

const drawer = h('aside', 'aits-drawer aits-editor-ui');
drawer.setAttribute('aria-label', 'Settings');
document.body.append(drawer);

const human = (k: string) => k.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/^./, (c) => c.toUpperCase()).replace(/\bSeo\b/, 'SEO');
const isImageKey = (k: string) => /image|logo/i.test(k) && !/alt/i.test(k);

function renderValue(path: string, key: string, value: Json, parent: HTMLElement) {
  if (Array.isArray(value)) {
    const fs = h('fieldset', 'aits-fs');
    fs.append(h('legend', '', human(key)));
    value.forEach((item, i) => {
      const row = h('div', 'aits-arr-item');
      renderValue(`${path}.${i}`, `${i + 1}`, item, row);
      const del = h('button', 'aits-mini', 'Remove');
      del.type = 'button';
      del.addEventListener('click', () => { const a = value.slice(); a.splice(i, 1); setPath(path, a); renderDrawer(); });
      row.append(del);
      fs.append(row);
    });
    const add = h('button', 'aits-mini', 'Add');
    add.type = 'button';
    add.addEventListener('click', () => {
      const a = value.slice();
      a.push(a.length ? structuredClone(a[a.length - 1]) : '');
      setPath(path, a);
      renderDrawer();
    });
    fs.append(add);
    parent.append(fs);
  } else if (value !== null && typeof value === 'object') {
    const fs = h('fieldset', 'aits-fs');
    fs.append(h('legend', '', human(key)));
    for (const [k, v] of Object.entries(value)) renderValue(`${path}.${k}`, k, v, fs);
    parent.append(fs);
  } else if (typeof value === 'boolean') {
    const wrap = h('label', 'aits-check');
    const input = h('input');
    input.type = 'checkbox';
    input.checked = value;
    input.addEventListener('change', () => { setPath(path, input.checked); drawerChanged = true; });
    wrap.append(input, h('span', '', human(key)));
    parent.append(wrap);
  } else {
    const str = value === null ? '' : String(value);
    const f = field(human(key), str, str.length > 70);
    f.input.addEventListener('input', () => { setPath(path, typeof value === 'number' ? Number(f.input.value) : f.input.value); drawerChanged = true; });
    if (isImageKey(key)) {
      const pick = h('input');
      pick.type = 'file';
      pick.accept = 'image/*';
      pick.className = 'aits-file';
      pick.addEventListener('change', async () => {
        const file = pick.files?.[0];
        if (!file) return;
        try {
          const url = await uploadImage(file);
          f.input.value = url;
          setPath(path, url);
          drawerChanged = true;
        } catch (err) { alert(`Upload failed: ${(err as Error).message}`); }
      });
      f.wrap.append(pick);
    }
    parent.append(f.wrap);
  }
}

let drawerTab: 'page' | 'site' = 'page';
let drawerChanged = false;

function renderDrawer() {
  drawer.replaceChildren();
  const head = h('div', 'aits-drawer-head');
  const title = h('h2', '', 'Settings');
  const close = h('button', 'aits-btn', 'Close');
  close.type = 'button';
  close.addEventListener('click', closeDrawer);
  head.append(title, close);

  const tabs = h('div', 'aits-tabs');
  for (const [id, label] of [['page', 'This page'], ['site', 'Whole site']] as const) {
    const b = h('button', drawerTab === id ? 'is-on' : '', label);
    b.type = 'button';
    b.addEventListener('click', () => { drawerTab = id; renderDrawer(); });
    tabs.append(b);
  }
  const help = h('p', 'aits-help', 'Everything on the page can also be edited by clicking it. Use these fields for things you cannot click: search listings, links, image descriptions, on/off switches and contact details.');
  const body = h('div', 'aits-drawer-body');
  const roots = drawerTab === 'page' ? [page === '404' ? 'global' : page] : ['settings', 'global'];
  for (const root of roots) renderValue(root, root === 'settings' ? 'Contact details & site settings' : root === 'global' ? 'Navigation, footer & labels' : 'Page content', data[root] as Json, body);

  const foot = h('div', 'aits-drawer-foot');
  const apply = h('button', 'aits-btn aits-btn--primary', 'Save and refresh the page');
  apply.type = 'button';
  apply.addEventListener('click', async () => { if (await save()) reloadKeepingScroll(); });
  foot.append(apply);
  drawer.append(head, tabs, help, body, foot);
}
function openDrawer() { drawerChanged = false; renderDrawer(); drawer.classList.add('is-open'); }
async function closeDrawer() {
  drawer.classList.remove('is-open');
  if (drawerChanged && (await save())) reloadKeepingScroll();
}

/* ---------------- toolbar ---------------- */

document.getElementById('aits-settings')!.addEventListener('click', () => (drawer.classList.contains('is-open') ? closeDrawer() : openDrawer()));
publishBtn.addEventListener('click', publish);
document.getElementById('aits-discard')!.addEventListener('click', discard);
document.getElementById('aits-logout')?.addEventListener('click', async () => {
  await save();
  await sb?.auth.signOut();
  setAdminCookie(cookie, null);
  location.href = '/admin/?loggedout';
});
document.getElementById('aits-page')!.addEventListener('change', async (e) => {
  await save();
  location.href = `/admin/edit/${(e.target as HTMLSelectElement).value}/`;
});
document.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); save(); }
});
window.addEventListener('beforeunload', (e) => {
  if (dirty.size) { save(); e.preventDefault(); }
});

refreshPublishState();
setStatus(unpublished ? 'Draft has changes that are not live yet' : 'Draft matches the live site');
