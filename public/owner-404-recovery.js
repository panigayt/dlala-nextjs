// R27-3 (24 Oct 2026): owner recovery on the proxy's static listing 404.
//
// The proxy's Firestore existence check is auth-blind (the uid lives
// only in localStorage, so the edge cannot see it): a sold listing reads
// as nonexistent server-side, so the owner cold-loading their own sold
// listing gets the static 404 before any React can run. This script is
// the only in-repo mechanism that closes that leg without weakening the
// true-404 posture for buyers:
//
// - It runs ONLY on /listing/<id> 404s (pathname gate; the proxy only
//   emits the <script> tag for listing 404s in the first place).
// - It ALWAYS shows the same generic sign-in hint (missing and sold
//   alike) — no information leak about whether the id exists.
// - Only after Firebase Auth reports a signed-in user AND an
//   authenticated REST read proves sellerId === uid does it render the
//   owner panel (title, price, sold badge, manage link). Buyers,
//   signed-out visitors, and non-owners keep the plain 404.
// - Every failure (SDK load, no session, token, non-200, non-owner)
//   degrades to hint-only: the script can never break the 404 page.
//
// Served same-origin (script-src 'self'); the Firebase SDK loads from
// gstatic (script-src allowlisted) and talks to Identity Toolkit /
// Firestore REST (connect-src allowlisted). No photo is rendered
// (minimal: title + price + status + manage link). Fetched values are
// inserted via textContent only — seller-written titles never touch
// innerHTML.
(function () {
  'use strict';
  var m = location.pathname.match(/^\/(?:(fr|en)\/)?listing\/([^\/]+)\/?$/);
  if (!m) return;
  var mount = document.getElementById('dlala-owner-recovery');
  if (!mount) return;
  var locale = m[1] || document.documentElement.lang || 'ar';
  if (locale !== 'fr' && locale !== 'en') locale = 'ar';
  var id = '';
  try {
    id = decodeURIComponent(m[2]).replace(/\.html$/i, '');
  } catch (e) {
    return;
  }
  if (!id) return;

  var T = {
    ar: {
      hint: 'إذا كان هذا إعلانك، ',
      signIn: 'سجّل الدخول لعرضه',
      sold: 'تم البيع',
      manage: 'إدارة إعلاناتي',
      ownerNote: 'هذا إعلانك',
    },
    fr: {
      hint: 'Si cette annonce est la vôtre, ',
      signIn: 'connectez-vous pour la voir',
      sold: 'Vendu',
      manage: 'Gérer mes annonces',
      ownerNote: 'Ceci est votre annonce',
    },
    en: {
      hint: 'If this is your listing, ',
      signIn: 'sign in to view it',
      sold: 'Sold',
      manage: 'Manage my listings',
      ownerNote: 'This is your listing',
    },
  }[locale];

  // Generic hint — identical for missing and sold ids (no leak).
  var hint = document.createElement('p');
  hint.className = 'dlala-owner-hint';
  hint.appendChild(document.createTextNode(T.hint));
  var login = document.createElement('a');
  login.href = '/auth?return=' + encodeURIComponent(location.pathname + location.search);
  login.textContent = T.signIn;
  hint.appendChild(login);
  mount.appendChild(hint);

  var SDK = 'https://www.gstatic.com/firebasejs/10.12.0/';
  var API_KEY = 'AIzaSyCcW4X5IvCTi5ujyaBzQl7aJVeYd-A5mcg';
  var REST = 'https://firestore.googleapis.com/v1/projects/dlala-85cea/databases/(default)/documents';

  function restVal(v) {
    if (v == null || typeof v !== 'object') return v;
    if ('stringValue' in v) return v.stringValue;
    if ('integerValue' in v) return Number(v.integerValue);
    if ('doubleValue' in v) return Number(v.doubleValue);
    if ('booleanValue' in v) return !!v.booleanValue;
    if ('mapValue' in v) {
      var out = {};
      var fs = (v.mapValue && v.mapValue.fields) || {};
      for (var k in fs) out[k] = restVal(fs[k]);
      return out;
    }
    return null;
  }

  function renderPanel(doc) {
    var title = doc.title;
    if (title && typeof title === 'object') {
      title = title.ar || title.fr || title.en || '';
    }
    title = title || id;
    var price = Number(doc.price) || 0;
    var priceLabel =
      price.toLocaleString('en-US') + ' ' + (locale === 'ar' ? 'دج' : 'DZD');

    var panel = document.createElement('div');
    panel.className = 'dlala-owner-panel';
    var note = document.createElement('p');
    note.className = 'dlala-owner-note';
    note.textContent = T.ownerNote;
    panel.appendChild(note);
    var h = document.createElement('p');
    h.className = 'dlala-owner-title';
    h.textContent = String(title);
    panel.appendChild(h);
    var pr = document.createElement('p');
    pr.className = 'dlala-owner-price';
    pr.textContent = priceLabel;
    panel.appendChild(pr);
    if (doc.status === 'sold') {
      var badge = document.createElement('span');
      badge.className = 'dlala-owner-sold';
      badge.textContent = T.sold;
      panel.appendChild(badge);
    }
    var manage = document.createElement('a');
    manage.className = 'dlala-owner-manage';
    manage.href = '/my-listings';
    manage.textContent = T.manage;
    panel.appendChild(manage);
    mount.appendChild(panel);
  }

  Promise.all([import(SDK + 'firebase-app.js'), import(SDK + 'firebase-auth.js')])
    .then(function (mods) {
      var appMod = mods[0];
      var authMod = mods[1];
      var app = appMod.initializeApp({
        apiKey: API_KEY,
        authDomain: 'dlala-85cea.firebaseapp.com',
        projectId: 'dlala-85cea',
      });
      var auth = authMod.getAuth(app);
      return authMod
        .setPersistence(auth, authMod.browserLocalPersistence)
        .catch(function () {})
        .then(function () {
          return new Promise(function (resolve) {
            var off = authMod.onAuthStateChanged(auth, function (user) {
              off();
              resolve(user || null);
            });
          });
        });
    })
    .then(function (user) {
      if (!user) return null;
      return user.getIdToken().then(function (token) {
        return { uid: user.uid, token: token };
      });
    })
    .then(function (session) {
      if (!session) return;
      return fetch(
        REST + '/listings/' + encodeURIComponent(id) + '?key=' + encodeURIComponent(API_KEY),
        { headers: { Authorization: 'Bearer ' + session.token } }
      )
        .then(function (res) {
          if (!res.ok) return null;
          return res.json();
        })
        .then(function (body) {
          if (!body || !body.fields) return;
          var fields = {};
          for (var k in body.fields) fields[k] = restVal(body.fields[k]);
          // Ownership gate: only the seller sees the panel.
          if (String(fields.sellerId || '') !== session.uid) return;
          renderPanel(fields);
        });
    })
    .catch(function () {
      /* hint-only degradation: never break the 404 page */
    });
})();
