/* J.A.R.V.I.S Mobile Edition — repaired standalone script
 * Required HTML IDs: chat, msg, send, mic-btn, clear-btn, cam-btn, img-input
 * IMPORTANT: A browser-stored API key is not secure for a public website.
 */
(() => {
  'use strict';

  const MODEL = 'gemini-3.8-flash';
  const API_KEY_STORAGE = 'jarvis_key';
  const MEMORY_STORAGE = 'jarvis_memory';
  const MAX_MEMORY = 24;

  let API_KEY = localStorage.getItem(API_KEY_STORAGE) || '';
  let MEMORY = [];
  let selectedImage = null;
  let busy = false;
  let recognition = null;

  const chat = document.getElementById('chat');
  const input = document.getElementById('msg');
  const sendBtn = document.getElementById('send') ||
                  document.getElementById('send-btn');
  const micBtn = document.getElementById('mic-btn');
  const clearBtn = document.getElementById('clear-btn');
  const camBtn = document.getElementById('cam-btn');
  const imgInput = document.getElementById('img-input');

  if (!chat || !input) {
    console.error('J.A.R.V.I.S: Missing #chat or #msg in index.html.');
    return;
  }

  try {
    const saved = JSON.parse(
      localStorage.getItem(MEMORY_STORAGE) || '[]'
    );

    if (Array.isArray(saved)) {
      MEMORY = saved.filter(m =>
        m &&
        ['user', 'model'].includes(m.role) &&
        typeof m.text === 'string'
      ).slice(-MAX_MEMORY);
    }
  } catch (_) {
    MEMORY = [];
  }

  function saveMemory() {
    try {
      localStorage.setItem(
        MEMORY_STORAGE,
        JSON.stringify(MEMORY.slice(-MAX_MEMORY))
      );
    } catch (e) {
      console.warn('Could not save chat memory:', e);
    }
  }

  function add(message, type = 'ai') {
    const item = document.createElement('div');
    item.className =
      type === 'user' ? 'user-message' : 'ai-message';
    item.textContent = String(message);
    item.style.whiteSpace = 'pre-wrap';
    item.style.overflowWrap = 'anywhere';

    chat.appendChild(item);
    chat.scrollTop = chat.scrollHeight;
    return item;
  }

  MEMORY.forEach(m =>
    add(
      (m.role === 'user' ? 'YOU: ' : 'J.A.R.V.I.S: ') + m.text,
      m.role === 'user' ? 'user' : 'ai'
    )
  );

  function askForKey() {
    const entered = window.prompt(
      'Enter your Gemini API key. Do not use a public/shared key:'
    );

    if (!entered || !entered.trim()) {
      throw new Error('Gemini API key was not entered.');
    }

    API_KEY = entered.trim();
    localStorage.setItem(API_KEY_STORAGE, API_KEY);
    return API_KEY;
  }

  async function callGemini(promptText, imageData = null) {
    if (!API_KEY) askForKey();

    const contents = MEMORY.slice(-12).map(m => ({
      role: m.role,
      parts: [{ text: m.text }]
    }));

    const parts = [{ text: String(promptText) }];

    if (imageData) {
      parts.push({
        inline_data: {
          mime_type: imageData.mimeType,
          data: imageData.base64
        }
      });
    }

    contents.push({ role: 'user', parts });

    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-goog-api-key': API_KEY
        },
        body: JSON.stringify({
          contents,
          generationConfig: {
            temperature: 0.7,
            maxOutputTokens: 2048
          }
        })
      }
    );

    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      const detail =
        data?.error?.message || `HTTP ${response.status}`;

      if ([400, 401, 403].includes(response.status)) {
        throw new Error(
          `Gemini API error: ${detail}. Check your API key, API access, and model name.`
        );
      }

      if (response.status === 429) {
        throw new Error(
          'Gemini rate limit/quota reached. Wait and try again.'
        );
      }

      throw new Error(`Gemini request failed: ${detail}`);
    }

    const answer = (
      data.candidates?.[0]?.content?.parts || []
    ).map(p => p.text || '').join('').trim();

    if (!answer) {
      const reason =
        data.promptFeedback?.blockReason || 'No text returned';
      throw new Error(`Gemini returned no answer (${reason}).`);
    }

    return answer;
  }

  async function fetchJson(url, timeoutMs = 12000) {
    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort(),
      timeoutMs
    );

    try {
      const res = await fetch(url, {
        signal: controller.signal
      });

      if (!res.ok) {
        throw new Error(`Request failed (${res.status})`);
      }

      return await res.json();
    } finally {
      clearTimeout(timeout);
    }
  }

  function getPosition() {
    return new Promise((resolve, reject) => {
      if (!navigator.geolocation) {
        return reject(
          new Error('This browser does not support location.')
        );
      }

      navigator.geolocation.getCurrentPosition(
        pos => resolve({
          latitude: pos.coords.latitude,
          longitude: pos.coords.longitude
        }),
        () => reject(
          new Error(
            'Location permission denied. Ask for a city name instead.'
          )
        ),
        {
          enableHighAccuracy: false,
          timeout: 10000,
          maximumAge: 300000
        }
      );
    });
  }

  async function weatherFor(query) {
    let latitude, longitude, label;

    const cityMatch = query.match(
      /\b(?:in|for|at)\s+([a-zA-Z][a-zA-Z .'-]{1,50})/i
    );

    const city = cityMatch?.[1]?.trim()
      .replace(/[?.!,]+$/, '');

    if (city && !/^(my area|here|me)$/i.test(city)) {
      const geo = await fetchJson(
        'https://geocoding-api.open-meteo.com/v1/search?count=1&language=en&format=json&name=' +
        encodeURIComponent(city)
      );

      const place = geo.results?.[0];

      if (!place) {
        throw new Error(
          `Could not find the location "${city}". Try a larger city name.`
        );
      }

      latitude = place.latitude;
      longitude = place.longitude;
      label = [
        place.name,
        place.admin1,
        place.country
      ].filter(Boolean).join(', ');
    } else {
      const pos = await getPosition();
      latitude = pos.latitude;
      longitude = pos.longitude;
      label = 'your current location';
    }

    const data = await fetchJson(
      `https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}` +
      '&current=temperature_2m,relative_humidity_2m,apparent_temperature,is_day,precipitation,weather_code,wind_speed_10m' +
      '&daily=temperature_2m_max,temperature_2m_min,precipitation_probability_max' +
      '&forecast_days=1&timezone=auto'
    );

    const descriptions = {
      0: 'clear sky',
      1: 'mainly clear',
      2: 'partly cloudy',
      3: 'overcast',
      45: 'fog',
      48: 'depositing rime fog',
      51: 'light drizzle',
      53: 'moderate drizzle',
      55: 'dense drizzle',
      61: 'slight rain',
      63: 'moderate rain',
      65: 'heavy rain',
      71: 'slight snow',
      73: 'moderate snow',
      75: 'heavy snow',
      80: 'rain showers',
      81: 'moderate rain showers',
      82: 'violent rain showers',
      95: 'thunderstorm',
      96: 'thunderstorm with hail',
      99: 'heavy thunderstorm with hail'
    };

    const c = data.current;
    const d = data.daily;

    return `Weather for ${label}\n` +
      `Conditions: ${descriptions[c.weather_code] || 'code ' + c.weather_code}\n` +
      `Temperature: ${c.temperature_2m}°C (feels like ${c.apparent_temperature}°C)\n` +
      `Humidity: ${c.relative_humidity_2m}%\n` +
      `Wind: ${c.wind_speed_10m} km/h\n` +
      `Today's high/low: ${d.temperature_2m_max?.[0]}°C / ${d.temperature_2m_min?.[0]}°C\n` +
      `Maximum precipitation probability: ${d.precipitation_probability_max?.[0] ?? 'unavailable'}%`;
  }

  async function handleTools(text) {
    const value = text.trim();
    const lower = value.toLowerCase();

    if (/^(?:open\s+)?youtube(?:\s+please)?[.!?]*$/i.test(value)) {
      window.open(
        'https://youtube.com',
        '_blank',
        'noopener,noreferrer'
      );
      return 'Opening YouTube.';
    }

    if (/^(?:open\s+)?google(?:\s+please)?[.!?]*$/i.test(value)) {
      window.open(
        'https://google.com',
        '_blank',
        'noopener,noreferrer'
      );
      return 'Opening Google.';
    }

    const urlMatch = value.match(
      /^(?:open|visit|go to)\s+(https?:\/\/\S+)$/i
    );

    if (urlMatch) {
      try {
        const url = new URL(urlMatch[1]);

        if (!['http:', 'https:'].includes(url.protocol)) {
          return 'Only HTTP and HTTPS links can be opened.';
        }

        window.open(
          url.href,
          '_blank',
          'noopener,noreferrer'
        );

        return `Opening ${url.hostname}.`;
      } catch (_) {
        return 'That link does not look valid.';
      }
    }

    const googleMatch = value.match(
      /^(?:google search|search (?:on )?google)(?: for)?\s+(.+)$/i
    );

    if (googleMatch) {
      const q = googleMatch[1].trim();

      window.open(
        'https://www.google.com/search?q=' +
        encodeURIComponent(q),
        '_blank',
        'noopener,noreferrer'
      );

      return `Searching Google for ${q}.`;
    }

    const videoMatch = value.match(
      /^(?:play|youtube(?: search)?(?: for)?|search (?:on )?youtube(?: for)?)\s+(.+)$/i
    );

    if (videoMatch) {
      const q = videoMatch[1].trim();

      window.open(
        'https://www.youtube.com/results?search_query=' +
        encodeURIComponent(q),
        '_blank',
        'noopener,noreferrer'
      );

      return `Searching YouTube for ${q}.`;
    }

    if (/\b(weather|forecast|temperature)\b/.test(lower)) {
      try {
        return await weatherFor(value);
      } catch (e) {
        return `Weather lookup failed: ${e.message}`;
      }
    }

    if (
      /^(?:what time is it|current time|time now|what is the time)[?.! ]*$/i.test(value)
    ) {
      return `Your device's local time is ${new Date().toLocaleString()}.`;
    }

    if (/^(?:clear|clear chat|clear memory)$/i.test(value)) {
      MEMORY = [];
      saveMemory();
      chat.replaceChildren();
      return 'Chat memory cleared.';
    }

    return null;
  }

  async function sendMessage(rawText) {
    const text = String(rawText || '').trim();

    if (!text || busy) return;

    busy = true;
    input.disabled = true;

    add('YOU: ' + text, 'user');

    MEMORY.push({
      role: 'user',
      text
    });

    saveMemory();

    const pending = add('J.A.R.V.I.S: Thinking…', 'ai');

    try {
      let answer = await handleTools(text);

      if (!answer) {
        answer = await callGemini(text, selectedImage);
      }

      pending.textContent = 'J.A.R.V.I.S: ' + answer;

      MEMORY.push({
        role: 'model',
        text: answer
      });

      MEMORY = MEMORY.slice(-MAX_MEMORY);
      saveMemory();
      speak(answer);
    } catch (e) {
      pending.textContent =
        'J.A.R.V.I.S error: ' + (e?.message || String(e));

      console.error(e);
    } finally {
      selectedImage = null;

      if (imgInput) {
        imgInput.value = '';
      }

      busy = false;
      input.disabled = false;
      input.focus();
    }
  }

  function speak(text) {
    if (!('speechSynthesis' in window)) return;

    window.speechSynthesis.cancel();

    const utterance = new SpeechSynthesisUtterance(
      String(text).slice(0, 3500)
    );

    utterance.lang = 'en-IN';
    utterance.rate = 1;

    window.speechSynthesis.speak(utterance);
  }

  function startVoice() {
    const SpeechRecognition =
      window.SpeechRecognition ||
      window.webkitSpeechRecognition;

    if (!SpeechRecognition) {
      add(
        'Voice input is not supported in this browser. Try Chrome, or type your message.',
        'ai'
      );
      return;
    }

    if (recognition) {
      recognition.stop();
      recognition = null;
      return;
    }

    recognition = new SpeechRecognition();
    recognition.lang = 'en-IN';
    recognition.interimResults = false;
    recognition.maxAlternatives = 1;

    recognition.onresult = event => {
      const transcript =
        event.results?.[0]?.[0]?.transcript || '';

      input.value = transcript;
      sendMessage(transcript);
    };

    recognition.onerror = event => {
      add('Voice input error: ' + event.error, 'ai');
    };

    recognition.onend = () => {
      recognition = null;
    };

    recognition.start();
  }

  if (imgInput) {
    imgInput.addEventListener('change', () => {
      const file = imgInput.files?.[0];

      if (!file) {
        selectedImage = null;
        return;
      }

      if (!file.type.startsWith('image/')) {
        add('Please choose an image file.', 'ai');
        imgInput.value = '';
        return;
      }

      if (file.size > 4 * 1024 * 1024) {
        add(
          'Image is too large. Choose an image smaller than 4 MB.',
          'ai'
        );
        imgInput.value = '';
        return;
      }

      const reader = new FileReader();

      reader.onload = () => {
        const result = String(reader.result || '');

        selectedImage = {
          mimeType: file.type,
          base64: result.split(',')[1] || ''
        };

        add(
          'Image attached. Type a question about it and send.',
          'ai'
        );
      };

      reader.onerror = () => {
        add('Could not read that image.', 'ai');
      };

      reader.readAsDataURL(file);
    });
  }

  if (micBtn) {
    micBtn.addEventListener('click', startVoice);
  }

  if (camBtn && imgInput) {
    camBtn.addEventListener('click', () => imgInput.click());
  }

  if (clearBtn) {
    clearBtn.addEventListener('click', () => {
      MEMORY = [];
      saveMemory();
      chat.replaceChildren();
      selectedImage = null;

      if (imgInput) {
        imgInput.value = '';
      }

      add('Chat cleared.', 'ai');
    });
  }

  input.addEventListener('keydown', event => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();

      const text = input.value;
      input.value = '';

      sendMessage(text);
    }
  });

  if (sendBtn) {
    sendBtn.addEventListener('click', () => {
      const text = input.value;
      input.value = '';
      sendMessage(text);
    });
  }

  window.JARVIS = {
    send: sendMessage,

    clear: () => {
      MEMORY = [];
      saveMemory();
      chat.replaceChildren();
    },

    setApiKey: key => {
      API_KEY = String(key || '').trim();

      if (API_KEY) {
        localStorage.setItem(API_KEY_STORAGE, API_KEY);
      } else {
        localStorage.removeItem(API_KEY_STORAGE);
      }
    }
  };

  add(
    'J.A.R.V.I.S is ready. Type a message and press Enter, or use the microphone.',
    'ai'
  );
})();
