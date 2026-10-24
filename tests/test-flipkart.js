const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const repo = require('path').join(__dirname, '..', 'Frontend');
const html = fs.readFileSync(path.join(repo, 'index.html'), 'utf8');
const script = fs.readFileSync(path.join(repo, 'script.js'), 'utf8');

const dom = new JSDOM(html, {
  url: 'http://localhost/Frontend/',
  runScripts: 'outside-only',
  pretendToBeVisual: true
});
const { window } = dom;

// --- stubs -------------------------------------------------------------
window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
window.scrollTo = () => {};
window.Element.prototype.scrollIntoView = function () { this.__scrolled = true; };
window.HTMLElement.prototype.scrollIntoView = window.Element.prototype.scrollIntoView;
window.JarvisBlackHole = undefined;
const opened = [];
window.open = (url) => {
  opened.push(url);
  return { opener: window, location: { href: url } };
};
window.fetch = () => Promise.reject(new Error('offline test'));
window.console.warn = () => {};

window.eval(script);

const results = [];
function check(name, condition, extra = '') {
  results.push({ name, ok: Boolean(condition), extra });
}
function text(id) {
  const el = window.document.getElementById(id);
  return el ? el.textContent.trim() : '';
}

// initial state
check('starts unlinked', window.document.getElementById('flipkart-card').dataset.state === 'off');
check('status shows NOT LINKED', text('flipkart-status') === 'NOT LINKED', text('flipkart-status'));
check('unlink hidden when unlinked', window.document.getElementById('flipkart-disconnect').hidden === true);
check('connect button label', text('flipkart-connect') === 'Connect', text('flipkart-connect'));

// intent matcher
const m = window.matchFlipkartIntent;
const cases = [
  ['my Flipkart orders', { action: 'orders' }],
  ['show me my flipkart order status', { action: 'orders' }],
  ["what's in my flipkart cart", { action: 'cart' }],
  ['my wishlist', { action: 'wishlist' }],
  ['open my flipkart wishlist', { action: 'wishlist' }],
  ['flipkart account', { action: 'account' }],
  ['connect flipkart', { action: 'connect' }],
  ['unlink flipkart', { action: 'disconnect' }],
  ['flipkart track order', { action: 'orders' }],
  ['flipkart', { action: 'home' }],
  ['open flipkart', { action: 'home' }],
  ['search flipkart for earphones', { action: 'search', query: 'earphones' }],
  ['find running shoes on flipkart', { action: 'search', query: 'running shoes' }],
  ['flipkart bluetooth speaker', { action: 'search', query: 'bluetooth speaker' }],
  ['sort my orders by date', null],
  ['what is the order of planets', null],
  ['explain the flipkart business model', null],
  ['flipkart return policy', null],
  ['what is the flipkart share price', null]
];
for (const [input, expected] of cases) {
  const got = m(input);
  const ok = expected === null
    ? got === null
    : got && got.action === expected.action && (!expected.query || got.query === expected.query);
  check('intent: ' + input, ok, JSON.stringify(got));
}

// command execution (first command auto-links)
(async () => {
  const reply1 = await window.handleTools('open my flipkart orders');
  check('orders reply', reply1 === 'Flipkart linked. Opening your Flipkart orders, Boss.', reply1);
  check('orders opened correct URL', opened[opened.length - 1] === 'https://www.flipkart.com/myorders', opened[opened.length - 1]);
  check('card switched to linked', window.document.getElementById('flipkart-card').dataset.state === 'on');
  check('status shows LINKED', text('flipkart-status') === 'LINKED', text('flipkart-status'));
  check('unlink becomes visible', window.document.getElementById('flipkart-disconnect').hidden === false);
  check('connect button becomes Reconnect', text('flipkart-connect') === 'Reconnect', text('flipkart-connect'));
  check('detail mentions linked', /^Linked/.test(text('flipkart-detail')), text('flipkart-detail'));
  check('link persisted to localStorage', JSON.parse(window.localStorage.getItem('jarvis_flipkart_link_v1')).connected === true);

  const reply2 = await window.handleTools('search flipkart for earphones');
  check('search reply', reply2 === 'Opening Flipkart search for earphones, Boss.', reply2);
  check('search URL', opened[opened.length - 1] === 'https://www.flipkart.com/search?q=earphones', opened[opened.length - 1]);

  const reply3 = await window.handleTools("what's in my flipkart cart");
  check('cart reply', reply3 === 'Opening your Flipkart cart, Boss.', reply3);
  check('cart URL', opened[opened.length - 1] === 'https://www.flipkart.com/viewcart', opened[opened.length - 1]);

  const reply4 = await window.handleTools('connect flipkart');
  check('reconnect reply', reply4 === 'Flipkart is already linked, Boss. Login page opened again.', reply4);
  check('login URL', opened[opened.length - 1] === 'https://www.flipkart.com/account/login', opened[opened.length - 1]);

  const reply5 = await window.handleTools('unlink flipkart');
  check('unlink reply', reply5 === 'Flipkart unlinked from J.A.R.V.I.S, Boss. Your browser login is untouched.', reply5);
  check('card back to off', window.document.getElementById('flipkart-card').dataset.state === 'off');

  const reply6 = await window.handleTools('sort my orders by date');
  check('false positive passes through', reply6 === null, String(reply6));

  // settings connect link (a real anchor, so no pop-up blocker involved)
  const connectLink = window.document.getElementById('flipkart-connect');
  check('settings connect is a real link', connectLink.getAttribute('href') === 'https://www.flipkart.com/account/login', connectLink.href);
  check('settings connect opens in a new tab', connectLink.getAttribute('target') === '_blank');
  check('open flipkart link', window.document.getElementById('flipkart-open').getAttribute('href') === 'https://www.flipkart.com/');
  check('noopener on link', /noopener/.test(connectLink.getAttribute('rel') || ''));
  connectLink.addEventListener('click', event => event.preventDefault());
  connectLink.click();
  check('settings connect links', window.document.getElementById('flipkart-card').dataset.state === 'on');
  check('note updated', /linked/i.test(text('flipkart-note')), text('flipkart-note'));

  // disconnect through the UI
  window.document.getElementById('flipkart-disconnect').click();
  check('settings unlink works', window.document.getElementById('flipkart-card').dataset.state === 'off');

  // sidebar "Connections" opens settings and highlights the group
  window.document.getElementById('connectors-open').click();
  check('connections opens settings', window.document.getElementById('settings-panel').hidden === false);
  check('connections highlights group', window.document.getElementById('connectors-group').classList.contains('is-highlighted'));

  // reply polish: the "Boss." suffix becomes a full stop for Telugu mix
  const te = window.telugishToolReply('Opening your Flipkart cart, Boss.');
  check('telugish reply', te === 'మీ Flipkart cart తెరిచాను, Boss.', te);

  // popup blocked path
  const realOpen = window.open;
  window.open = () => null;
  const blocked = await window.handleTools('my flipkart orders');
  check('blocked popup message', blocked === 'The browser blocked the Flipkart tab, Boss. Allow pop-ups for J.A.R.V.I.S and try again.', blocked);
  window.open = realOpen;

  const failed = results.filter(r => !r.ok);
  for (const r of results) console.log((r.ok ? 'PASS' : 'FAIL') + '  ' + r.name + (r.ok ? '' : '  -> ' + r.extra));
  console.log('\n' + (results.length - failed.length) + '/' + results.length + ' checks passed');
  process.exit(failed.length ? 1 : 0);
})();
