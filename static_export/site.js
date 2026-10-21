/* E-comXpress - static export runtime.
   Emulates the Flask session behaviour (cart, wishlist, auth) in the browser so
   the GitHub Pages build is fully interactive. */
(function () {
  'use strict';

  var KEY_CART = 'ecx_cart';
  var KEY_WISHLIST = 'ecx_wishlist';
  var KEY_USER = 'ecx_user';
  var KEY_USERS = 'ecx_users';

  var PRODUCTS = window.ECX_PRODUCTS || [];
  var SEED_USERS = window.ECX_USERS || {};

  var cart = readJSON(KEY_CART, {}) || {};
  var wishlist = readJSON(KEY_WISHLIST, []) || [];
  var currentUser = readJSON(KEY_USER, null);
  var registered = readJSON(KEY_USERS, {}) || {};

  function readJSON(key, fallback) {
    try {
      var raw = localStorage.getItem(key);
      return raw === null ? fallback : JSON.parse(raw);
    } catch (err) {
      return fallback;
    }
  }

  function writeJSON(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch (err) { /* storage unavailable */ }
  }

  function productById(id) {
    for (var i = 0; i < PRODUCTS.length; i++) {
      if (String(PRODUCTS[i].id) === String(id)) return PRODUCTS[i];
    }
    return null;
  }

  function formatINR(value) {
    return '₹' + Number(value).toLocaleString('en-US');
  }

  function escapeHtml(text) {
    return String(text === undefined || text === null ? '' : text)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function qs(selector, root) {
    return (root || document).querySelector(selector);
  }

  function qsa(selector, root) {
    return Array.prototype.slice.call((root || document).querySelectorAll(selector));
  }

  /* ---------------------------------------------------------------- toasts */
  function toast(message, type) {
    var area = qs('[data-ecx="flash-area"]');
    if (!area) return;
    var wrap = document.createElement('div');
    wrap.className = 'alert alert-' + (type || 'success') + ' alert-dismissible fade show';
    wrap.setAttribute('role', 'alert');
    wrap.innerHTML = escapeHtml(message) +
      '<button type="button" class="btn-close" data-bs-dismiss="alert"></button>';
    area.appendChild(wrap);
    window.setTimeout(function () {
      wrap.classList.remove('show');
      window.setTimeout(function () { wrap.remove(); }, 200);
    }, 2600);
  }

  /* ------------------------------------------------------------ nav chrome */
  function cartCount() {
    var total = 0;
    Object.keys(cart).forEach(function (key) { total += Number(cart[key]) || 0; });
    return total;
  }

  function buildNavItem(className, icon, label, href, extra) {
    var li = document.createElement('li');
    li.className = 'nav-item';
    var a = document.createElement('a');
    a.className = className;
    a.href = href;
    a.setAttribute('data-ecx', extra);
    a.innerHTML = '<i class="bi ' + icon + '"></i> ' + label;
    li.appendChild(a);
    return li;
  }

  function navList() {
    return qs('ul.navbar-nav.ms-auto') || qs('ul.navbar-nav');
  }

  function updateChrome() {
    var badge = qs('[data-ecx="cart-badge"]');
    var cartLink = qs('[data-ecx="cart-link"]');
    if (!badge && cartLink) {
      badge = document.createElement('span');
      badge.className = 'position-absolute top-0 start-100 translate-middle badge rounded-pill bg-danger';
      badge.setAttribute('data-ecx', 'cart-badge');
      cartLink.appendChild(badge);
    }
    var count = cartCount();
    if (badge) {
      badge.textContent = count;
      badge.style.display = count > 0 ? '' : 'none';
    }

    var list = navList();
    var loginLink = qs('[data-ecx="login-link"]');
    var profileLink = qs('[data-ecx="profile-link"]');
    var logoutLink = qs('[data-ecx="logout-link"]');

    if (currentUser) {
      if (loginLink) loginLink.parentElement.style.display = 'none';
      if (!profileLink && list) {
        list.appendChild(buildNavItem('btn btn-outline-light btn-sm', 'person-fill', 'Profile', profileHref(), 'profile-link'));
        profileLink = qs('[data-ecx="profile-link"]');
      } else if (profileLink) {
        profileLink.parentElement.style.display = '';
        profileLink.title = currentUser.email;
      }
      if (!logoutLink && list) {
        list.appendChild(buildNavItem('btn btn-danger btn-sm fw-bold', 'box-arrow-right', 'Logout', '#', 'logout-link'));
        logoutLink = qs('[data-ecx="logout-link"]');
      } else if (logoutLink) {
        logoutLink.parentElement.style.display = '';
      }
    } else {
      if (loginLink) {
        loginLink.parentElement.style.display = '';
      } else if (list) {
        list.appendChild(buildNavItem('btn btn-light btn-sm text-primary fw-bold', 'box-arrow-in-right', 'Login', loginHref(), 'login-link'));
      }
      if (profileLink) profileLink.parentElement.style.display = 'none';
      if (logoutLink) logoutLink.parentElement.style.display = 'none';
    }

    qsa('[data-ecx="wishlist-btn"]').forEach(function (btn) {
      var pid = String(btn.getAttribute('data-pid'));
      var active = wishlist.indexOf(pid) !== -1;
      var icon = btn.querySelector('i');
      if (icon) icon.classList.toggle('bi-heart-fill', active);
      if (btn.classList.contains('btn-outline-danger')) {
        btn.classList.toggle('btn-danger', active);
        btn.classList.toggle('btn-outline-danger', !active);
      }
    });
  }

  function profileHref() {
    var link = qs('[data-ecx="profile-link"]');
    return link ? link.getAttribute('href') : 'profile/';
  }

  function loginHref() {
    var link = qs('a[href*="login"]');
    return link ? link.getAttribute('href') : 'login/';
  }

  /* ------------------------------------------------------------------ cart */
  function addToCart(pid) {
    var key = String(pid);
    cart[key] = (Number(cart[key]) || 0) + 1;
    writeJSON(KEY_CART, cart);
    var product = productById(pid);
    toast("Added '" + (product ? product.title.slice(0, 40) : 'Item') + "' to cart", 'success');
    updateChrome();
    renderCart();
  }

  function updateCartItem(pid, action) {
    var key = String(pid);
    if (!(key in cart)) return;
    if (action === 'increase') {
      cart[key] = (Number(cart[key]) || 0) + 1;
    } else if (action === 'decrease') {
      cart[key] = (Number(cart[key]) || 0) - 1;
      if (cart[key] <= 0) delete cart[key];
    }
    writeJSON(KEY_CART, cart);
    updateChrome();
    renderCart();
  }

  function removeFromCart(pid) {
    delete cart[String(pid)];
    writeJSON(KEY_CART, cart);
    toast('Item removed', 'info');
    updateChrome();
    renderCart();
  }

  function emptyCartMarkup() {
    return '<div class="col-12"><div class="card shadow-sm border-0 text-center py-5" data-ecx="cart-empty">' +
      '<div class="card-body"><i class="bi bi-cart-x display-1 text-muted mb-4"></i>' +
      '<h4 class="fw-bold">Your cart is empty</h4>' +
      '<p class="text-muted mb-4">Looks like you haven\'t added anything to your cart yet.</p>' +
      '<a href="' + productsHref() + '" class="btn btn-primary btn-lg px-5">Shop Now</a></div></div></div>';
  }

  function productsHref() {
    var link = qs('a[href*="products"]');
    return link ? link.getAttribute('href') : '#';
  }

  function renderCart() {
    var container = qs('[data-ecx="cart-items"]');
    if (!container) return;

    var templates = {};
    qsa('[data-ecx="cart-row"]', container).forEach(function (row) {
      templates[row.getAttribute('data-pid')] = row;
    });

    var summary = qs('[data-ecx="cart-summary"]');
    var emptyHost = container.closest('main') || container.parentElement;

    if (!templates || !Object.keys(templates).length) return;

    var ids = Object.keys(cart);
    if (!ids.length) {
      container.innerHTML = '';
      container.style.display = 'none';
      if (summary) summary.style.display = 'none';
      var existing = qs('[data-ecx="cart-empty"]');
      if (!existing) {
        var holder = document.createElement('div');
        holder.innerHTML = emptyCartMarkup();
        var node = holder.firstChild;
        emptyHost.insertBefore(node, emptyHost.firstChild);
      }
      return;
    }

    var existingEmpty = qs('[data-ecx="cart-empty"]');
    if (existingEmpty) existingEmpty.remove();

    container.innerHTML = '';
    container.style.display = '';

    var total = 0;
    var original = 0;
    ids.forEach(function (pid) {
      var template = templates[pid];
      if (!template) return;
      var product = productById(pid);
      if (!product) return;
      var qty = Number(cart[pid]) || 0;
      var row = template.cloneNode(true);
      row.style.display = '';
      var qtyEl = qs('[data-ecx="cart-qty"]', row);
      if (qtyEl) qtyEl.textContent = qty;
      var priceEl = qs('[data-ecx="cart-line-price"]', row);
      if (priceEl) priceEl.textContent = formatINR(product.price * qty);
      qsa('button', row).forEach(function (btn) { btn.removeAttribute('disabled'); });
      container.appendChild(row);
      total += product.price * qty;
      original += product.original_price * qty;
    });

    var savings = original - total;
    if (summary) {
      summary.style.display = '';
      var countEl = qs('[data-ecx="cart-count"]', summary);
      if (countEl) countEl.textContent = 'Price (' + ids.length + ' items)';
      var originalEl = qs('[data-ecx="cart-original"]', summary);
      if (originalEl) originalEl.textContent = formatINR(original);
      var savingsEl = qs('[data-ecx="cart-savings"]', summary);
      if (savingsEl) savingsEl.textContent = '- ' + formatINR(savings);
      var totalEl = qs('[data-ecx="cart-total"]', summary);
      if (totalEl) totalEl.textContent = formatINR(total);
      var noteEl = qs('[data-ecx="cart-savings-note"]', summary);
      if (noteEl) noteEl.textContent = 'You will save ' + formatINR(savings) + ' on this order';
    }
  }

  /* -------------------------------------------------------------- products */
  function applyProductFilters() {
    var grid = qs('[data-ecx="product-grid"]');
    if (!grid) return;

    var params = new URLSearchParams(window.location.search);
    var category = params.get('category') || '';
    var query = (params.get('q') || '').toLowerCase();
    var maxPrice = parseInt(params.get('price_max') || '300000', 10);
    var sort = params.get('sort') || 'default';

    var cards = qsa('[data-ecx="product-card"]', grid);
    var visible = [];

    cards.forEach(function (card) {
      var ok = true;
      if (category && category !== 'All' && card.getAttribute('data-category') !== category) ok = false;
      if (ok && query) {
        var haystack = (card.getAttribute('data-title') + ' ' + card.getAttribute('data-brand')).toLowerCase();
        if (haystack.indexOf(query) === -1) ok = false;
      }
      if (ok && Number(card.getAttribute('data-price')) > maxPrice) ok = false;
      card.style.display = ok ? '' : 'none';
      if (ok) visible.push(card);
    });

    if (sort === 'price_low') {
      visible.sort(function (a, b) { return Number(a.getAttribute('data-price')) - Number(b.getAttribute('data-price')); });
    } else if (sort === 'price_high') {
      visible.sort(function (a, b) { return Number(b.getAttribute('data-price')) - Number(a.getAttribute('data-price')); });
    } else if (sort === 'rating') {
      visible.sort(function (a, b) { return Number(b.getAttribute('data-rating')) - Number(a.getAttribute('data-rating')); });
    } else if (sort === 'discount') {
      visible.sort(function (a, b) { return Number(b.getAttribute('data-discount')) - Number(a.getAttribute('data-discount')); });
    }
    visible.forEach(function (card) { grid.appendChild(card); });

    var countEl = qs('[data-ecx="product-count"]');
    if (countEl) countEl.textContent = visible.length + ' products found';

    var headingEl = qs('[data-ecx="products-heading"]');
    if (headingEl) {
      if (category) {
        headingEl.textContent = category;
      } else if (query) {
        headingEl.textContent = 'Search results for "' + (params.get('q') || '') + '"';
      } else {
        headingEl.textContent = 'All Products';
      }
    }

    var noResults = qs('[data-ecx="no-results"]');
    if (noResults) noResults.style.display = visible.length ? 'none' : '';

    var priceInput = qs('#priceRange');
    if (priceInput) {
      priceInput.value = maxPrice;
      var output = qs('#priceOutput');
      if (output) output.textContent = maxPrice;
    }
    var categoryInput = qs('[data-ecx="filter-form"] input[name="category"][value="' + category + '"]');
    if (categoryInput) categoryInput.checked = true;
    var sortSelect = qs('[data-ecx="filter-form"] select[name="sort"]');
    if (sortSelect) sortSelect.value = sort;
  }

  /* --------------------------------------------------------------- profile */
  function renderProfile() {
    var nameEl = qs('[data-ecx="profile-name"]');
    if (!nameEl) return;
    var user = currentUser;
    if (!user) {
      toast('Please log in to view your profile', 'info');
      return;
    }

    function setText(selector, value) {
      var el = qs(selector);
      if (el) el.textContent = value;
    }
    setText('[data-ecx="profile-name"]', user.name);
    setText('[data-ecx="profile-email"]', user.email);
    setText('[data-ecx="profile-since"]', 'Member since ' + user.member_since);
    setText('[data-ecx="profile-name-full"]', user.name);
    setText('[data-ecx="profile-email-full"]', user.email);
    setText('[data-ecx="profile-phone"]', user.phone);

    var list = qs('[data-ecx="address-list"]');
    if (list) {
      if (!user.addresses || !user.addresses.length) {
        list.innerHTML = '<p class="text-muted mb-0">No saved addresses found.</p>';
      } else {
        list.innerHTML = user.addresses.map(function (addr) {
          return '<div class="list-group-item px-0 py-3">' +
            '<div class="d-flex justify-content-between align-items-start"><div>' +
            '<span class="badge bg-secondary mb-2">' + escapeHtml(addr.type || 'Home') + '</span>' +
            '<p class="mb-1 fw-bold">' + escapeHtml(addr.street) + '</p>' +
            '<p class="text-muted mb-0">' + escapeHtml(addr.city) + ', ' + escapeHtml(addr.state) + ' - ' + escapeHtml(addr.pincode) +
            '</p></div></div></div>';
        }).join('');
      }
    }
  }

  /* -------------------------------------------------------------- auth/otp */
  function renderOtpStep(step, identifier) {
    var host = qs('[data-ecx="otp-host"]');
    if (!host) return;
    var progress = qs('[data-ecx="otp-progress"]');
    if (progress) {
      var badges = qsa('.badge', progress);
      var labels = qsa('.fw-semibold', progress);
      badges.forEach(function (badge, index) {
        var active = index + 1 <= step;
        badge.classList.toggle('bg-primary', active);
        badge.classList.toggle('bg-secondary-subtle', !active);
        badge.classList.toggle('text-secondary', !active);
        if (labels[index]) {
          labels[index].classList.toggle('text-primary', active);
          labels[index].classList.toggle('text-muted', !active);
        }
      });
    }

    var forms = qsa('form', host);
    forms.forEach(function (form) { form.remove(); });

    var form = document.createElement('form');
    form.setAttribute('data-ecx', 'otp-form');
    if (step === 1) {
      form.innerHTML =
        '<div class="mb-4"><label for="identifier" class="form-label fw-semibold small text-uppercase text-body-secondary">Registered Email or Phone</label>' +
        '<div class="input-group"><span class="input-group-text bg-body text-body-secondary border-end-0"><i class="bi bi-person-badge"></i></span>' +
        '<input type="text" class="form-control border-start-0 ps-0" id="identifier" name="identifier" required placeholder="Enter email or mobile number"></div></div>' +
        '<button type="submit" class="btn btn-primary bg-gradient w-100 py-2.5 fw-bold shadow-sm mb-3"><i class="bi bi-send me-2"></i>Send Verification Code</button>';
    } else if (step === 2) {
      form.innerHTML =
        '<input type="hidden" name="identifier" value="' + escapeHtml(identifier || '') + '">' +
        '<div class="alert alert-info border-0 shadow-sm small mb-4"><i class="bi bi-info-circle-fill me-2"></i>A 6-digit OTP code has been sent to <strong>' + escapeHtml(identifier || '') + '</strong>.</div>' +
        '<div class="mb-4"><label for="otp" class="form-label fw-semibold small text-uppercase text-body-secondary">Enter Verification OTP</label>' +
        '<div class="input-group"><span class="input-group-text bg-body text-body-secondary border-end-0"><i class="bi bi-key"></i></span>' +
        '<input type="text" class="form-control border-start-0 ps-0 text-center fw-bold fs-5 tracking-wider" id="otp" name="otp" required placeholder="123456" maxlength="6"></div></div>' +
        '<button type="submit" class="btn btn-primary bg-gradient w-100 py-2.5 fw-bold shadow-sm mb-3"><i class="bi bi-shield-check me-2"></i>Verify OTP Code</button>';
    } else {
      form.innerHTML =
        '<input type="hidden" name="identifier" value="' + escapeHtml(identifier || '') + '">' +
        '<div class="mb-4"><label for="new_password" class="form-label fw-semibold small text-uppercase text-body-secondary">New Password</label>' +
        '<div class="input-group"><span class="input-group-text bg-body text-body-secondary border-end-0"><i class="bi bi-lock"></i></span>' +
        '<input type="password" class="form-control border-start-0 ps-0" id="new_password" name="new_password" required placeholder="Create a new strong password"></div></div>' +
        '<button type="submit" class="btn btn-success bg-gradient w-100 py-2.5 fw-bold shadow-sm mb-3"><i class="bi bi-check-circle me-2"></i>Update Password</button>';
    }
    host.insertBefore(form, host.firstChild);
  }

  function findUser(email) {
    var key = String(email || '').trim().toLowerCase();
    if (SEED_USERS[key]) return SEED_USERS[key];
    if (registered[key]) return registered[key];
    return null;
  }

  /* ------------------------------------------------------------- listeners */
  document.addEventListener('submit', function (event) {
    var form = event.target;
    var action = form.getAttribute('data-ecx-action') || form.getAttribute('action') || '';
    var method = (form.getAttribute('method') || 'GET').toUpperCase();

    if (method === 'GET') return;

    event.preventDefault();

    var data = new FormData(form);

    if (action.indexOf('/cart/add/') !== -1) {
      addToCart(action.split('/cart/add/')[1].split('?')[0]);
      return;
    }
    if (action.indexOf('/cart/update/') !== -1) {
      updateCartItem(action.split('/cart/update/')[1].split('?')[0], data.get('action'));
      return;
    }
    if (action.indexOf('/cart/remove/') !== -1) {
      removeFromCart(action.split('/cart/remove/')[1].split('?')[0]);
      return;
    }
    if (action.indexOf('/wishlist/toggle/') !== -1) {
      var wpid = action.split('/wishlist/toggle/')[1].split('?')[0];
      var index = wishlist.indexOf(wpid);
      if (index === -1) {
        wishlist.push(wpid);
        toast('Added to wishlist', 'success');
      } else {
        wishlist.splice(index, 1);
        toast('Removed from wishlist', 'info');
      }
      writeJSON(KEY_WISHLIST, wishlist);
      updateChrome();
      return;
    }
    if (action.indexOf('/login') !== -1) {
      var email = String(data.get('email') || '').trim();
      var password = String(data.get('password') || '');
      var user = findUser(email);
      if (user && user.password === password) {
        currentUser = user;
        writeJSON(KEY_USER, currentUser);
        updateChrome();
        toast("Welcome back, " + user.name + '!', 'success');
        window.setTimeout(function () { window.location.href = profileHref(); }, 500);
      } else {
        toast('Invalid email or password', 'danger');
      }
      return;
    }
    if (action.indexOf('/register') !== -1) {
      var newEmail = String(data.get('email') || '').trim().toLowerCase();
      if (findUser(newEmail)) {
        toast('Email already registered', 'danger');
        return;
      }
      var created = {
        name: String(data.get('name') || ''),
        email: newEmail,
        phone: String(data.get('phone') || ''),
        password: String(data.get('password') || ''),
        member_since: 'October 2026',
        addresses: [],
        orders: []
      };
      registered[newEmail] = created;
      writeJSON(KEY_USERS, registered);
      currentUser = created;
      writeJSON(KEY_USER, currentUser);
      updateChrome();
      toast('Account created successfully', 'success');
      window.setTimeout(function () { window.location.href = profileHref(); }, 500);
      return;
    }
    if (action.indexOf('/forgot-password') !== -1) {
      var step = String(data.get('step') || '1');
      var identifier = String(data.get('identifier') || '');
      if (step === '1') {
        renderOtpStep(2, identifier);
        toast('OTP sent to ' + identifier, 'info');
      } else if (step === '2') {
        var otp = String(data.get('otp') || '');
        if (otp.length === 6) {
          renderOtpStep(3, identifier);
          toast('OTP verified', 'success');
        } else {
          toast('Invalid OTP', 'danger');
        }
      } else {
        var target = findUser(identifier);
        if (target) {
          target.password = String(data.get('new_password') || '');
          if (SEED_USERS[String(identifier).toLowerCase()]) {
            SEED_USERS[String(identifier).toLowerCase()].password = target.password;
          }
          registered[String(identifier).toLowerCase()] = target;
          writeJSON(KEY_USERS, registered);
        }
        toast('Password updated', 'success');
        window.setTimeout(function () {
          var loginLink = qs('[data-ecx="login-link"]');
          window.location.href = loginLink ? loginLink.getAttribute('href') : '#';
        }, 700);
      }
      return;
    }
    if (action.indexOf('/profile') !== -1) {
      var street = String(data.get('street') || '').trim();
      var city = String(data.get('city') || '').trim();
      var pincode = String(data.get('pincode') || '').trim();
      if (street && city && pincode && currentUser) {
        if (!currentUser.addresses) currentUser.addresses = [];
        currentUser.addresses.push({
          id: currentUser.addresses.length + 1,
          type: String(data.get('type') || 'Home'),
          name: currentUser.name,
          street: street,
          city: city,
          state: String(data.get('state') || ''),
          pincode: pincode
        });
        writeJSON(KEY_USER, currentUser);
        registered[String(currentUser.email).toLowerCase()] = currentUser;
        writeJSON(KEY_USERS, registered);
        toast('Address added', 'success');
        renderProfile();
        form.reset();
      }
      return;
    }
    if (action.indexOf('/settings') !== -1) {
      var theme = data.get('theme');
      if (theme) {
        document.documentElement.setAttribute('data-bs-theme', theme);
        localStorage.setItem('ecx-theme', theme);
      }
      toast('Settings saved', 'success');
      return;
    }
    if (action.indexOf('/rate-us') !== -1) {
      toast('Thanks for the feedback!', 'success');
      form.reset();
    }
  });

  document.addEventListener('click', function (event) {
    var link = event.target.closest ? event.target.closest('a[href]') : null;
    if (!link) return;
    var href = link.getAttribute('href') || '';
    if (href.indexOf('/wishlist/toggle/') !== -1) {
      event.preventDefault();
      var pid = href.split('/wishlist/toggle/')[1].split('?')[0];
      var idx = wishlist.indexOf(pid);
      if (idx === -1) {
        wishlist.push(pid);
        toast('Added to wishlist', 'success');
      } else {
        wishlist.splice(idx, 1);
        toast('Removed from wishlist', 'info');
      }
      writeJSON(KEY_WISHLIST, wishlist);
      updateChrome();
      return;
    }
    if (link.getAttribute('data-ecx') === 'logout-link' || href.indexOf('/logout') !== -1) {
      event.preventDefault();
      currentUser = null;
      writeJSON(KEY_USER, null);
      updateChrome();
      toast('Logged out', 'info');
      var loginLink = qs('[data-ecx="login-link"]');
      window.setTimeout(function () {
        window.location.href = loginLink ? loginLink.getAttribute('href') : '#';
      }, 600);
    }
  });

  document.addEventListener('click', function (event) {
    var btn = event.target.closest ? event.target.closest('[data-ecx="place-order"]') : null;
    if (!btn) return;
    if (!Object.keys(cart).length) {
      toast('Your cart is empty', 'info');
      return;
    }
    cart = {};
    writeJSON(KEY_CART, cart);
    updateChrome();
    renderCart();
    toast('Order placed successfully!', 'success');
  });

  /* ----------------------------------------------------------------- init */
  function init() {
    if (!currentUser) {
      var demo = SEED_USERS['demo@ecomxpress.com'];
      if (demo) currentUser = JSON.parse(JSON.stringify(demo));
    }
    updateChrome();
    renderCart();
    applyProductFilters();
    renderProfile();
    if (qs('[data-ecx="otp-host"]')) renderOtpStep(1, '');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
