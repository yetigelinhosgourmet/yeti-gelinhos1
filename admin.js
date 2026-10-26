(() => {
  const config = window.YETI_CONFIG || {};
  const loginPanel = document.querySelector('#login-panel');
  const menuPanel = document.querySelector('#menu-panel');
  const loginForm = document.querySelector('#login-form');
  const loginStatus = document.querySelector('#login-status');
  const menuStatus = document.querySelector('#menu-status');
  const loginButton = document.querySelector('#login-button');
  const saveButton = document.querySelector('#save-button');
  const rowsEl = document.querySelector('#product-rows');
  let client = null;
  let products = [];

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
    const { data, error } = await client
      .from('admin_users')
      .select('user_id')
      .eq('user_id', user.id)
      .maybeSingle();
    if (error || !data) {
      await client.auth.signOut();
      showLogin('Este usuário não tem acesso administrativo.', 'error');
      return false;
    }
    return true;
  }

  function renderProducts() {
    rowsEl.replaceChildren();
    for (const product of products) {
      const row = document.createElement('div');
      row.className = 'row';
      const nameLabel = document.createElement('label');
      nameLabel.textContent = 'Sabor';
      const name = document.createElement('input');
      name.type = 'text';
      name.maxLength = 80;
      name.required = true;
      name.value = product.name;
      name.dataset.name = String(product.id);
      nameLabel.append(name);
      const priceLabel = document.createElement('label');
      priceLabel.textContent = 'Preço (R$)';
      const price = document.createElement('input');
      price.type = 'number';
      price.min = '0.01';
      price.step = '0.01';
      price.value = Number(product.price).toFixed(2);
      price.dataset.price = String(product.id);
      priceLabel.append(price);
      const stockLabel = document.createElement('label');
      stockLabel.textContent = 'Estoque';
      const stock = document.createElement('input');
      stock.type = 'number';
      stock.min = '0';
      stock.step = '1';
      stock.placeholder = 'Sem controle';
      stock.value = product.stock == null ? '' : String(product.stock);
      stock.dataset.stock = String(product.id);
      stockLabel.append(stock);
      row.append(name, priceLabel, stockLabel);
      rowsEl.append(row);
    }
  }

  async function openAdmin(user) {
    if (!(await verifyAdmin(user))) return;
    showMenu();
    setStatus(menuStatus, 'Carregando cardápio…');
    const { data, error } = await client
      .from('products')
      .select('id,name,price,stock,sort_order')
      .order('sort_order');
    if (error) {
      setStatus(menuStatus, 'Não foi possível carregar o cardápio. Confira a configuração do banco.', 'error');
      return;
    }
    products = data || [];
    renderProducts();
    setStatus(menuStatus, products.length + ' sabores carregados.');
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
      const name = rowsEl.querySelector('[data-name="' + product.id + '"]').value.trim();
      const price = Number(rowsEl.querySelector('[data-price="' + product.id + '"]').value);
      const stockText = rowsEl.querySelector('[data-stock="' + product.id + '"]').value.trim();
      const stock = stockText === '' ? null : Number(stockText);
      return { id: product.id, name, price, stock };
    });
    const uniqueNames = new Set(updates.map(item => item.name.toLocaleLowerCase('pt-BR')));
    if (updates.some(item => !item.name || !Number.isFinite(item.price) || item.price <= 0 ||
      (item.stock !== null && (!Number.isInteger(item.stock) || item.stock < 0))) || uniqueNames.size !== updates.length) {
      setStatus(menuStatus, 'Confira os nomes, preços e quantidades. Os sabores precisam ter nomes diferentes.', 'error');
      return;
    }
    saveButton.disabled = true;
    setStatus(menuStatus, 'Salvando…');
    for (const item of updates) {
      const { error } = await client.from('products')
        .update({ name: item.name, price: item.price, stock: item.stock })
        .eq('id', item.id);
      if (error) {
        saveButton.disabled = false;
        setStatus(menuStatus, 'Não foi possível salvar. Sua sessão pode ter expirado; entre novamente e tente de novo.', 'error');
        return;
      }
    }
    products = products.map((product, index) => Object.assign({}, product, updates[index]));
    saveButton.disabled = false;
    setStatus(menuStatus, 'Cardápio atualizado para todos os clientes.', 'success');
  });

  document.querySelector('#logout-button').addEventListener('click', async () => {
    await client.auth.signOut();
    products = [];
    showLogin('Você saiu da área administrativa.');
  });

  client.auth.getSession().then(({ data, error }) => {
    if (error) showLogin('Não foi possível verificar a sessão. Recarregue a página.', 'error');
    else if (data.session) void openAdmin(data.session.user);
  });
})();
