// ===== 3. TOOLS (THE HANDS) — 15 TOOLS =====
async function handleTools(text) {
  const t = text.toLowerCase();

  // 1. Time
  if (
    /\btime\b/.test(t) ||
    t.includes("టైమ్") ||
    t.includes("సమయం")
  ) {
    return "The time is " + new Date().toLocaleTimeString() + ", Boss.";
  }

  // 2. Weather
  if (t.includes("weather") || t.includes("వాతావరణం")) {
    return await new Promise((resolve) => {
      navigator.geolocation.getCurrentPosition(
        async (position) => {
          try {
            const latitude = position.coords.latitude;
            const longitude = position.coords.longitude;

            const url =
              `https://api.open-meteo.com/v1/forecast` +
              `?latitude=${latitude}` +
              `&longitude=${longitude}` +
              `&current_weather=true`;

            const response = await fetch(url);
            const data = await response.json();

            resolve(
              `It is ${data.current_weather.temperature} degrees Celsius now, Boss.`
            );
          } catch (error) {
            console.error("Weather error:", error);
            resolve("Weather service error, Boss.");
          }
        },
        () => {
          resolve("I need location permission for weather, Boss.");
        }
      );
    });
  }

  // 3. Timer
  const match = t.match(
    /(\d+)\s*(seconds?|secs?|minutes?|mins?|hours?|hrs?)/i
  );

  if (
    (t.includes("timer") || t.includes("టైమర్")) &&
    match
  ) {
    const amount = parseInt(match[1], 10);
    const unit = match[2].toLowerCase();

    let factor;

    if (/^(hours?|hrs?|h)/.test(unit)) {
      factor = 60 * 60 * 1000;
    } else if (/^(seconds?|secs?|s)/.test(unit)) {
      factor = 1000;
    } else {
      factor = 60 * 1000;
    }

    const duration = amount * factor;

    setTimeout(() => {
      speak(`టైమర్ పూర్తైంది! ${amount} ${unit} అయ్యాయి.`);
    }, duration);

    return `Timer set for ${amount} ${unit}.`;
  }

  // 4. Translate
  if (t.includes("translate")) {
    const query =
      text.replace(/translate (this )?/i, "").trim() || "hello";

    try {
      const url =
        "https://api.mymemory.translated.net/get?" +
        "q=" +
        encodeURIComponent(query) +
        "&langpair=en|te";

      const response = await fetch(url);
      const data = await response.json();

      return "In Telugu: " + data.responseData.translatedText;
    } catch (error) {
      console.error("Translate error:", error);
      return "Translate error, Boss.";
    }
  }

  // 5. YouTube Play
  if (t.includes("play ") || t.includes("youtube ")) {
    const query = text
      .replace(/play |youtube (search )?/i, "")
      .trim();

    if (query) {
      window.open(
        "https://www.youtube.com/results?search_query=" +
          encodeURIComponent(query),
        "_blank"
      );

      return `Searching YouTube for ${query}, Boss.`;
    }
  }

  // No tool matched → send to Gemini Brain
  return null;
}
