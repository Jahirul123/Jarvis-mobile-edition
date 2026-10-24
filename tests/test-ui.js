// UI layer regression checks: palette, toasts, message structure, stat chips.
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');
const repo = require('path').join(__dirname, '..', 'Frontend');
const dom = new JSDOM(fs.readFileSync(path.join(repo, 'index.html'), 'utf8'), {
  url: 'http://localhost/Frontend/', runScripts: 'outside-only', pretendToBeVisual: true
});
const { window } = dom;
window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
window.Element.prototype.scrollIntoView = function () {};
window.open = () => ({ opener: window });
window.fetch = () => Promise.reject(new Error('offline'));
window.console.warn = () => {};
// jsdom has no geolocation; leaving it defined makes the weather tool await
// forever and keep the app's busy flag set. Removing it exercises the real
// "no permission" branch instead.
try {
  Object.defineProperty(window.navigator, 'geolocation', { value: undefined, configurable: true });
} catch (e) { /* ignore */ }
window.eval(fs.readFileSync(path.join(repo, 'script.js'), 'utf8'));

const results = [];
const clearChat = () => {
  window.document.getElementById('chat').replaceChildren();
  window.document.body.classList.remove('has-conversation');
};
const check = (name, ok, extra = '') => results.push({ name, ok: !!ok, extra });
const $ = sel => window.document.querySelector(sel);
const $$ = sel => [...window.document.querySelectorAll(sel)];

(async () => {
  // --- runPrompt dispatches the turn straight into the chat (palette / chips path)
  window.runPrompt('what is the weather right now?');
  check('runPrompt renders the user turn',
    /weather right now/i.test($$('.msg.user').pop().querySelector('.msg-text').textContent),
    $$('.msg.user').pop().querySelector('.msg-text').textContent);
  check('runPrompt clears the composer', $('#msg').value === '');
  clearChat();
  await new Promise(r => setTimeout(r, 30));

  // --- message structure
  clearChat();
  await new Promise(r => setTimeout(r, 30));
  window.add('YOU: hello jarvis', 'user');
  window.add('J.A.R.V.I.S: hello, Boss.', 'ai');
  const msgs = $$('.msg');
  check('messages rendered', msgs.length === 2, String(msgs.length));
  check('user message structure', !!msgs[0].querySelector('.msg-avatar') && !!msgs[0].querySelector('.msg-body .msg-text'), msgs[0].className);
  check('ai message has timestamp', /\d/.test(msgs[1].querySelector('.msg-time').textContent), msgs[1].querySelector('.msg-time').textContent);
  check('sender labels', msgs[0].querySelector('.msg-who').textContent === 'YOU' && msgs[1].querySelector('.msg-who').textContent === 'J.A.R.V.I.S');
  check('user avatar glyph', msgs[0].querySelector('.msg-avatar').textContent === 'J');

  // --- reply updates the nested text node, not the whole bubble
  const node = window.add('J.A.R.V.I.S: Thinking...', 'ai', true);
  window.setReply(node, 'J.A.R.V.I.S: done at last');
  check('setReply keeps structure', node.querySelectorAll('.msg-text').length === 1 && !!node.querySelector('.msg-meta'), node.innerHTML.slice(0, 80));
  check('setReply text', node.querySelector('.msg-text').textContent === 'done at last', node.querySelector('.msg-text').textContent);

  // --- quick chips run instantly
  clearChat();
  await new Promise(r => setTimeout(r, 30));
  // pending requests from earlier palette runs are aborted, so reset awareness
  const before = $$('.msg.user').length;
  const chip = $$('.quick-chip')[0];
  chip.dispatchEvent(new window.Event('click'));
  check('quick chip sends at once', $$('.msg.user').length === before + 1, 'count ' + $$('.msg.user').length + ' vs ' + (before + 1));

  // --- prompt card loads instead of sending
  const userBefore = $$('.msg.user').length;
  $$('.prompt-card')[0].click();
  check('prompt card only fills input', $$('.msg.user').length === userBefore && /briefing/i.test($('#msg').value), $('#msg').value);

  // --- toasts
  $$('.toast').forEach(t => t.remove());
  window.showToast('Saved.', 'success');
  const toast = $$('.toast').pop();
  check('toast rendered', !!toast && toast.textContent === 'Saved.', toast && toast.textContent);
  check('toast tone', toast.dataset.tone === 'success');
  for (let i = 0; i < 5; i++) window.showToast('spam ' + i);
  check('toast stack capped at 3', $$('.toast').length === 3, String($$('.toast').length));
  check('newest toast kept', /spam 4/.test($$('.toast').pop().textContent), $$('.toast').pop().textContent);

  // --- core state + stat chip
  window.setJarvisVisualState('THINKING');
  check('core state on <html>', window.document.documentElement.dataset.coreState === 'thinking', window.document.documentElement.dataset.coreState);
  check('stat chip follows core', $('#stat-core').textContent === 'CORE THINKING', $('#stat-core').textContent);

  // --- flipkart stat chip
  window.unlinkFlipkart();
  check('stat chip unlinked', /NOT LINKED/.test($('#stat-flipkart').textContent), $('#stat-flipkart').textContent);
  window.document.getElementById('flipkart-connect').click();
  check('stat chip linked', /LINKED/.test($('#stat-flipkart').textContent) && !/NOT LINKED/.test($('#stat-flipkart').textContent), $('#stat-flipkart').textContent);

  // --- palette
  window.openPalette();
  const items = () => $$('.palette-item');
  check('palette opens', !$('#palette').hidden);
  check('palette lists commands', items().length >= 10, String(items().length));
  check('first item selected', items()[0].getAttribute('aria-selected') === 'true');
  check('palette icons are svg', items().every(i => i.querySelector('svg')), '');
  window.runPaletteCommand(0); // "New conversation" -> safe, no network
  check('palette closes after run', $('#palette').hidden === true);
  window.closePalette();

  window.openPalette();
  $('#palette-input').value = 'flip';
  $('#palette-input').dispatchEvent(new window.Event('input'));
  check('palette filters', items().length === 2 && items().every(i => /Flipkart|accounts/i.test(i.textContent)), items().map(i => i.textContent).join(' | '));
  $('#palette-input').value = 'zzzz';
  $('#palette-input').dispatchEvent(new window.Event('input'));
  check('palette empty state', !!$('.palette-empty') && items().length === 0);
  window.closePalette();
  check('palette closes on demand', $('#palette').hidden === true);

  // --- sidebar aria
  const toggle = $('#sidebar-toggle');
  check('sidebar toggle has aria-expanded', toggle.getAttribute('aria-expanded') === 'true', toggle.getAttribute('aria-expanded'));

  const failed = results.filter(r => !r.ok);
  results.forEach(r => console.log((r.ok ? 'PASS' : 'FAIL') + '  ' + r.name + (r.ok ? '' : '  -> ' + r.extra)));
  console.log('\n' + (results.length - failed.length) + '/' + results.length + ' checks passed');
  process.exit(failed.length ? 1 : 0);
})();
