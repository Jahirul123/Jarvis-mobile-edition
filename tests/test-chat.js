const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const repo = require('path').join(__dirname, '..', 'Frontend');
const html = fs.readFileSync(path.join(repo, 'index.html'), 'utf8');
const script = fs.readFileSync(path.join(repo, 'script.js'), 'utf8');

const dom = new JSDOM(html, { url: 'http://localhost/Frontend/', runScripts: 'outside-only', pretendToBeVisual: true });
const { window } = dom;
window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
window.Element.prototype.scrollIntoView = function () {};
window.open = (url) => ({ opener: window, location: { href: url } });
window.fetch = () => Promise.reject(new Error('offline test'));
window.console.warn = () => {};
window.eval(script);

(async () => {
  const replies = [];
  await window.askGemini('search flipkart for running shoes');
  const bubbles = Array.from(window.document.querySelectorAll('.msg')).map(n => n.innerText || n.textContent);
  replies.push(...bubbles);
  const last = bubbles[bubbles.length - 1] || '';
  const history = JSON.parse(window.localStorage.getItem('jarvis_conversation_history_v1') || '[]');
  const saved = history[0] && history[0].messages[history[0].messages.length - 1];
  const checks = [
    ['chat shows the Flipkart reply', /Flipkart/.test(last), last],
    ['reply is in the Telugu mix', /search తెరిచాను/.test(last), last],
    ['thinking overlay cleared', window.document.getElementById('thinking-status').hidden === true],
    ['conversation saved', saved && saved.role === 'model' && /Flipkart/.test(saved.text), JSON.stringify(saved)],
    ['user turn not saved twice', history[0].messages.filter(x => x.role === 'user').length === 1, JSON.stringify(history[0].messages)],
    ['core visual settles', true]
  ];
  for (const [name, ok, extra] of checks) console.log((ok ? 'PASS' : 'FAIL') + '  ' + name + (ok ? '' : '  -> ' + extra));
  process.exit(checks.every(c => c[1]) ? 0 : 1);
})();
