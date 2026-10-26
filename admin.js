(() => {
  const config = window.YETI_CONFIG || {};
  const loginPanel = document.querySelector('#login-panel');
  const menuPanel = document.querySelector('#menu-panel');
  const loginForm = document.querySelector('#login-form');
  const loginStatus = document.querySelector('#login-status');
  const menuStatus = document.querySelector('#menu-status');
  const loginButton = document.querySelector('#login-button');
  const saveButton = document.querySelector('#save-button');
  const addButton = document.querySelector('#add-product-button');
  const rowsEl = document.querySelector('#product-rows');
  let client = null;
  let products = [];
  let orders = [];
  let currentUser = null;
  const IMAGE_BUCKET = 'product-images';
  const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
  const EMPTY_IMAGE = 'data:image/svg+xml,%3Csvg xmlns=%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22 width=%22160%22 height=%22160%22%3E%3Crect width=%22100%25%22 height=%22100%25%22 fill=%22%23f2f8ff%22%2F%3E%3Ctext x=%2250%25%22 y=%2252%25%22 text-anchor=%22middle%22 fill=%22%23637894%22 font-family=%22sans-serif%22 font-size=%2216%22%3ESem%20foto%3C%2Ftext%3E%3C%2Fsvg%3E';
  function normalizeProductName(value) {
    return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().replace(/\s+/g, ' ').toLocaleLowerCase('pt-BR');
  }

  function setStatus(el, text, kind = '') {
    el.textContent = text;
    el.className = 'status ' + kind;
  }
  function showLogin(text = '', kind = '') {
    loginPanel.classList.remove('hidden');
    menuPanel.classList.add('hidden');
    if (text) setStatus(loginStatus, text, kind);
  }
  function showMenu() {
    loginPanel.classList.add('hidden');
    menuPanel.classList.remove('hidden');
  }
  function imageSrc(path) {
    if (!path) return '';
    return /^https?:\/\//i.test(path) || path.startsWith('/') ? path : './' + path;
  }
  function imageError(error) {
    if (error?.message?.includes('product-images') || error?.message?.toLowerCase().includes('bucket')) {
      return 'O envio de fotos ainda não está configurado. Execute a configuração de armazenamento no Supabase e tente novamente.';
    }
    return error?.message || 'Confira as permissões do banco e tente novamente.';
  }
  function validateImage(file) {
    if (!file) return '';
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) return 'Use uma foto JPG, PNG ou WebP.';
    if (file.size > MAX_IMAGE_BYTES) return 'A foto deve ter no máximo 5 MB.';
    return '';
  }
  async function uploadImage(file, productId) {
    if (!file) return null;
    const issue = validateImage(file);
    if (issue) throw new Error(issue);
    const extension = file.type === 'image/png' ? 'png' : file.type === 'image/webp' ? 'webp' : 'jpg';
    const path = currentUser.id + '/' + productId + '-' + Date.now() + '.' + extension;
    const { error } = await client.storage.from(IMAGE_BUCKET).upload(path, file, {
      cacheControl: '3600',
      contentType: file.type,
      upsert: false
    });
    if (error) throw error;
    return client.storage.from(IMAGE_BUCKET).getPublicUrl(path).data.publicUrl;
  }
  function makeLabel(text, control) {
    const label = document.createElement('label');
    label.textContent = text;
    label.append(control);
    return label;
  }
  function renderProducts() {
    rowsEl.replaceChildren();
    for (const product of products) {
      const row = document.createElement('article');
      row.className = 'row' + (product.active === false ? ' inactive-row' : '');
      row.dataset.id = String(product.id);

      const photoWrap = document.createElement('div');
      photoWrap.className = 'photo-wrap';
      const preview = document.createElement('img');
      preview.className = 'photo-preview';
      preview.alt = 'Foto do sabor ' + product.name;
      preview.src = imageSrc(product.image) || EMPTY_IMAGE;
      const file = document.createElement('input');
      file.type = 'file';
      file.accept = 'image/jpeg,image/png,image/webp';
      file.dataset.photo = '';
      file.setAttribute('aria-label', 'Escolher nova foto para ' + product.name);
      const removePhoto = document.createElement('input');
      removePhoto.type = 'checkbox';
      removePhoto.dataset.removePhoto = '';
      removePhoto.disabled = !product.image;
      removePhoto.setAttribute('aria-label', 'Remover foto de ' + product.name);
      const removePhotoLabel = document.createElement('label');
      removePhotoLabel.className = 'remove-photo-label';
      removePhotoLabel.append(removePhoto, document.createTextNode('Remover foto'));
      photoWrap.append(preview, file, removePhotoLabel);
      removePhoto.addEventListener('change', () => {
        preview.src = removePhoto.checked ? EMPTY_IMAGE : (imageSrc(product.image) || EMPTY_IMAGE);
      });
      file.addEventListener('change', () => {
        const issue = validateImage(file.files[0]);
        if (issue) { file.value = ''; setStatus(menuStatus, issue, 'error'); return; }
        if (file.files[0]) {
          removePhoto.checked = false;
          preview.src = URL.createObjectURL(file.files[0]);
        }
      });

      const name = document.createElement('input');
      name.type = 'text'; name.maxLength = 80; name.required = true; name.value = product.name; name.dataset.name = '';
      const price = document.createElement('input');
      price.type = 'number'; price.min = '0'; price.step = '0.01'; price.value = Number(product.price).toFixed(2); price.dataset.price = '';
      const active = document.createElement('input');
      active.type = 'checkbox'; active.checked = product.active !== false; active.dataset.active = '';
      const activeLabel = document.createElement('label');
      activeLabel.className = 'active-label'; activeLabel.append(active, document.createTextNode('Mostrar no cardápio'));
      const productActions = document.createElement('div');
      productActions.className = 'product-actions';
      const deleteButton = document.createElement('button');
      deleteButton.className = 'button delete-product';
      deleteButton.type = 'button';
      deleteButton.textContent = 'Excluir item';
      deleteButton.addEventListener('click', () => deleteProduct(product));
      productActions.append(activeLabel, deleteButton);
      row.append(photoWrap, makeLabel('Sabor', name), makeLabel('Preço (R$)', price), productActions);
      rowsEl.append(row);
    }
  }

  async function deleteProduct(product) {
    const confirmed = window.confirm('Excluir o sabor "' + product.name + '"? Esta ação não pode ser desfeita.');
    if (!confirmed) return;
    setStatus(menuStatus, 'Excluindo sabor…');
    try {
      const { data: deletedRows, error } = await client.from('products')
        .delete()
        .eq('id', product.id)
        .select('id');
      if (error) {
        if (error.code === '23503' || /foreign key|constraint/i.test(error.message || '')) {
          throw new Error('Este sabor está associado a pedidos. Desative-o para preservar o histórico.');
        }
        throw error;
      }
      if (!deletedRows?.length) {
        throw new Error('O banco não confirmou a exclusão. Aplique a migração supabase/migration_product_delete_rls.sql no Supabase e tente novamente.');
      }
      products = products.filter(item => item.id !== product.id);
      renderProducts();
      setStatus(menuStatus, 'Sabor excluído do cardápio.', 'success');
    } catch (error) {
      setStatus(menuStatus, 'Não foi possível excluir. ' + imageError(error), 'error');
    }
  }

  const supabaseUrl = config.supabaseUrl;
  const supabasePublishableKey = config.supabasePublishableKey;
  if (!window.supabase || !window.supabase.createClient) {
    setStatus(loginStatus, 'Não foi possível carregar o serviço de acesso. Verifique a conexão e recarregue a página.', 'error');
    loginButton.disabled = true;
    return;
  }
  if (!supabaseUrl || !supabasePublishableKey) {
    setStatus(loginStatus, 'A configuração do Supabase ainda precisa ser preenchida em config.js.', 'error');
    loginButton.disabled = true;
    return;
  }
  client = window.supabase.createClient(supabaseUrl, supabasePublishableKey);

  async function verifyAdmin(user) {
    const { data, error } = await client.from('admin_users').select('user_id').eq('user_id', user.id).maybeSingle();
    if (error || !data) {
      await client.auth.signOut();
      showLogin('Este usuário não tem acesso administrativo.', 'error');
      return false;
    }
    return true;
  }

  async function loadProducts() {
    const { data, error } = await client.from('products')
      .select('id,name,price,sort_order,image,active').order('sort_order');
    if (error) throw error;
    products = data || [];
    renderProducts();
  }

  function renderOrders() {
    const list = document.querySelector('#order-list');
    list.replaceChildren();
    if (!orders.length) {
      const empty = document.createElement('p');
      empty.className = 'muted';
      empty.textContent = 'Nenhum pedido recebido ainda.';
      list.append(empty);
      return;
    }
    for (const order of orders) {
      const card = document.createElement('article');
      card.className = 'order-card';
      const title = document.createElement('h3');
      title.textContent = 'Pedido #' + order.id.slice(0, 8).toUpperCase() + ' · ' + ({pending:'Aguardando confirmação',confirmed:'Confirmado',cancelled:'Cancelado'}[order.status] || order.status);
      card.append(title);
      const details = document.createElement('p');
      details.textContent = [order.customer_name || 'Cliente', order.customer_phone, order.fulfillment_method, order.delivery_address, new Date(order.created_at).toLocaleString('pt-BR'), 'Total ' + Number(order.total).toLocaleString('pt-BR',{style:'currency',currency:'BRL'})].filter(Boolean).join(' · ');
      card.append(details);
      const itemList = document.createElement('ul');
      itemList.className = 'order-items';
      for (const item of order.items || []) {
        const li = document.createElement('li');
        li.textContent = item.quantity + 'x ' + item.product_name + ' · ' + Number(item.unit_price * item.quantity).toLocaleString('pt-BR',{style:'currency',currency:'BRL'});
        itemList.append(li);
      }
      card.append(itemList);
      if (order.status !== 'cancelled') {
        const actions = document.createElement('div');
        actions.className = 'order-actions';
        if (order.status === 'pending') {
          const openStock = document.createElement('a');
          openStock.className = 'button primary';
          openStock.href = 'https://yeti-gelinhos.vercel.app/pedidos';
          openStock.target = '_blank';
          openStock.rel = 'noopener noreferrer';
          openStock.textContent = 'Importar e confirmar no sistema de estoque';
          actions.append(openStock);
        }
        card.append(actions);
      }
      list.append(card);
    }
  }

  async function loadOrders() {
    const { data, error } = await client.from('orders')
      .select('id,status,fulfillment_method,total,created_at,customer_name,customer_phone,delivery_address').eq('source','site').order('created_at', {ascending:false}).limit(40);
    if (error) throw error;
    const orderIds = (data || []).map(order => order.id);
    let itemRows = [];
    if (orderIds.length) {
      const result = await client.from('order_items').select('order_id,product_name,unit_price,quantity').in('order_id', orderIds);
      if (result.error) throw result.error;
      itemRows = result.data || [];
    }
    orders = (data || []).map(order => ({...order, items:itemRows.filter(item => item.order_id === order.id)}));
    renderOrders();
  }

  async function openAdmin(user) {
    if (!(await verifyAdmin(user))) return;
    currentUser = user;
    showMenu();
    setStatus(menuStatus, 'Carregando cardápio…');
    try {
      await loadProducts();
      await loadOrders();
      setStatus(menuStatus, products.length + ' sabores carregados.');
    } catch (error) {
      setStatus(menuStatus, 'Não foi possível carregar os sabores. ' + imageError(error), 'error');
    }
  }

  loginForm.addEventListener('submit', async event => {
    event.preventDefault();
    loginButton.disabled = true;
    setStatus(loginStatus, 'Entrando…');
    const { error } = await client.auth.signInWithPassword({
      email: document.querySelector('#email').value.trim(),
      password: document.querySelector('#password').value
    });
    loginButton.disabled = false;
    if (error) setStatus(loginStatus, 'E-mail ou senha inválidos.', 'error');
    else {
      const { data } = await client.auth.getSession();
      if (data.session) await openAdmin(data.session.user);
    }
  });

  saveButton.addEventListener('click', async () => {
    const updates = products.map(product => {
      const row = rowsEl.querySelector('[data-id="' + product.id + '"]');
      const name = row.querySelector('[data-name]').value.trim();
      const price = Number(row.querySelector('[data-price]').value);
      const active = row.querySelector('[data-active]').checked;
      const file = row.querySelector('[data-photo]').files[0] || null;
      const removePhoto = row.querySelector('[data-remove-photo]').checked;
      return { id: product.id, name, price, active, file, removePhoto };
    });
    if (updates.some(item => !item.name)) {
      setStatus(menuStatus, 'Informe um nome para cada sabor.', 'error');
      return;
    }
    const allNames = [...updates.map(item => item.name), ...products.filter(p => !updates.some(u => u.id === p.id)).map(p => p.name)];
    const uniqueNames = new Set(allNames.map(normalizeProductName));
    if (uniqueNames.size !== allNames.length) {
      setStatus(menuStatus, 'Cada sabor precisa ter um nome diferente.', 'error');
      return;
    }
    if (updates.some(item => !Number.isFinite(item.price) || item.price < 0 || (item.active && item.price === 0))) {
      setStatus(menuStatus, 'Sabores ativos precisam ter preço maior que R$ 0. Sabores inativos podem ficar com preço R$ 0.', 'error');
      return;
    }
    if (updates.some(item => validateImage(item.file))) {
      setStatus(menuStatus, 'Use fotos JPG, PNG ou WebP com até 5 MB.', 'error');
      return;
    }
    saveButton.disabled = true;
    addButton.disabled = true;
    setStatus(menuStatus, 'Salvando alterações…');
    try {
      for (const item of updates) {
        const oldProduct = products.find(p => p.id === item.id);
        const photoUrl = item.file ? await uploadImage(item.file, item.id) : item.removePhoto ? null : oldProduct.image;
        const { error } = await client.from('products').update({
          name: item.name, price: item.price, active: item.active, image: photoUrl
        }).eq('id', item.id);
        if (error) throw error;
      }
      await loadProducts();
      setStatus(menuStatus, 'Alterações salvas e publicadas no cardápio.', 'success');
    } catch (error) {
      setStatus(menuStatus, 'Não foi possível salvar. ' + imageError(error), 'error');
    } finally {
      saveButton.disabled = false;
      addButton.disabled = false;
    }
  });

  addButton.addEventListener('click', async () => {
    const name = document.querySelector('#new-name').value.trim();
    const price = Number(document.querySelector('#new-price').value);
    const file = document.querySelector('#new-image').files[0] || null;
    if (!name || !Number.isFinite(price) || price <= 0) {
      setStatus(menuStatus, 'Informe o nome e um preço válido.', 'error');
      return;
    }
    if (products.some(product => product.name.toLocaleLowerCase('pt-BR') === name.toLocaleLowerCase('pt-BR'))) {
      setStatus(menuStatus, 'Já existe um sabor com esse nome.', 'error');
      return;
    }
    const issue = validateImage(file);
    if (issue) { setStatus(menuStatus, issue, 'error'); return; }
    addButton.disabled = true;
    saveButton.disabled = true;
    setStatus(menuStatus, 'Adicionando sabor…');
    try {
      // Products use UUID identifiers. Generate one in the secure GitHub Pages context
      // instead of deriving a numeric id from existing rows.
      const id = crypto.randomUUID();
      const sortOrder = products.reduce((max, product) => Math.max(max, Number(product.sort_order) || 0), 0) + 1;
      const image = file ? await uploadImage(file, id) : null;
      const { error } = await client.from('products').insert({
        id, name, price, image, active: true, sort_order: sortOrder
      });
      if (error) throw error;
      document.querySelector('#new-name').value = '';
      document.querySelector('#new-price').value = '';
      document.querySelector('#new-image').value = '';
      await loadProducts();
      setStatus(menuStatus, 'Sabor adicionado. Ele já aparece no cardápio da loja.', 'success');
    } catch (error) {
      setStatus(menuStatus, 'Não foi possível adicionar. ' + imageError(error), 'error');
    } finally {
      addButton.disabled = false;
      saveButton.disabled = false;
    }
  });

  document.querySelector('#logout-button').addEventListener('click', async () => {
    await client.auth.signOut();
    products = [];
    currentUser = null;
    showLogin('Você saiu da área administrativa.');
  });

  client.auth.getSession().then(({ data, error }) => {
    if (error) showLogin('Não foi possível verificar a sessão. Recarregue a página.', 'error');
    else if (data.session) void openAdmin(data.session.user);
  });
})();


