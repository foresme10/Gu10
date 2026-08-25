/*
 * ChatGPT & Gemini Unlock Check for Surge
 * Version: 1.0.0
 *
 * Detection strategy:
 * - ChatGPT: actual homepage response + Cloudflare trace region.
 * - Gemini: actual signed-out web app response; optional region marker parsing.
 *
 * No MITM, cookies, account tokens, or external analytics are used.
 */

const REQUEST_TIMEOUT = 12;
const USER_AGENT =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) " +
  "AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 " +
  "Mobile/15E148 Safari/604.1";

// ISO 3166-1 alpha-2 codes from OpenAI's current ChatGPT supported-country list.
// The actual ChatGPT page response remains the primary signal; this list helps
// classify a regional block when an edge page returns an ambiguous status.
const CHATGPT_SUPPORTED_COUNTRIES = (
  "AL,DZ,AF,AX,AD,AO,AG,AR,AM,AW,AU,AT,AZ,BS,BH,BD,BB,BE,BZ,BM,BJ,BT," +
  "BO,BA,BW,BR,BN,BG,BF,BI,CV,KH,CM,CA,KY,CF,TD,CL,CO,KM,CG,CD,CR,CI," +
  "HR,CY,CZ,DK,DJ,DM,DO,EC,EG,SV,GQ,ER,EE,SZ,ET,FO,FJ,FI,FR,GF,PF,TF," +
  "GA,GM,GE,DE,GH,GR,GD,GL,GT,GP,GN,GW,GY,HT,VA,HN,HU,IS,IN,ID,IQ,IE," +
  "IL,IT,JM,JP,JO,KZ,KE,KI,KW,KG,LA,LV,LB,LS,LR,LY,LI,LT,LU,MG,MW,MY," +
  "MV,ML,MT,MH,MQ,MR,MU,YT,MX,FM,MD,MC,MN,ME,MA,MZ,MM,NA,NR,NP,NL,NC," +
  "NZ,NI,NE,NG,MK,NO,OM,PK,PW,PS,PA,PG,PY,PE,PH,PL,PT,QA,RE,RO,RW,BL," +
  "SH,KN,LC,MF,PM,VC,WS,SM,ST,SA,SN,RS,SC,SL,SG,SK,SI,SB,SO,ZA,KR,SS," +
  "ES,LK,SR,SE,CH,SD,SJ,TW,TJ,TZ,TH,TL,TG,TO,TT,TN,TR,TM,TV,UG,UA,AE," +
  "GB,US,UY,UZ,VU,VN,WF,YE,ZM,ZW"
).split(",");

const BLOCK_TEXT = {
  chatgpt: [
    "unsupported_country",
    "unsupported country",
    "country, region, or territory not supported",
    "not available in your country",
    "sorry, you have been blocked",
    "vpn blocked"
  ],
  gemini: [
    "gemini isn't currently supported in your country",
    "gemini is not currently supported in your country",
    "gemini isn't available in your country",
    "gemini is unavailable in your country",
    "not currently available in your country",
    "location is not supported",
    "unsupported country"
  ]
};

const tasks = {};
let remaining = 3;

probe("trace", {
  url: "https://chatgpt.com/cdn-cgi/trace",
  headers: requestHeaders("text/plain,*/*;q=0.8")
});

probe("chatgpt", {
  url: "https://chatgpt.com/",
  headers: requestHeaders("text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8")
});

probe("gemini", {
  url: "https://gemini.google.com/?hl=en",
  headers: requestHeaders("text/html,application/xhtml+xml;q=0.9,*/*;q=0.8")
});

function requestHeaders(accept) {
  return {
    "User-Agent": USER_AGENT,
    Accept: accept,
    "Accept-Language": "en-US,en;q=0.9",
    "Cache-Control": "no-cache",
    Pragma: "no-cache"
  };
}

function probe(name, options) {
  const startedAt = Date.now();
  options.timeout = REQUEST_TIMEOUT;
  options["auto-redirect"] = true;
  options["auto-cookie"] = false;

  $httpClient.get(options, function (error, response, data) {
    tasks[name] = {
      error: error || null,
      status: getStatus(response),
      body: typeof data === "string" ? data : "",
      latency: Date.now() - startedAt
    };

    remaining -= 1;
    if (remaining === 0) finish();
  });
}

function getStatus(response) {
  if (!response) return 0;
  return Number(response.status || response.statusCode || 0);
}

function finish() {
  const trace = parseTrace(tasks.trace);
  const chatgpt = classifyChatGPT(tasks.chatgpt, trace);
  const gemini = classifyGemini(tasks.gemini);
  const checkedAt = formatTime(new Date());
  const content = [
    formatLine("ChatGPT", chatgpt),
    formatLine("Gemini", gemini),
    "────────────",
    "检测时间  " + checkedAt
  ].join("\n");

  console.log(content);

  if (isPanelRun()) {
    $done({
      title: "AI 解锁检测",
      content: content,
      style: panelStyle(chatgpt, gemini),
      icon: "sparkles",
      "icon-color": panelColor(chatgpt, gemini)
    });
    return;
  }

  $notification.post("AI 解锁检测", shortSummary(chatgpt, gemini), content);
  $done();
}

function parseTrace(task) {
  const result = { country: "", colo: "" };
  if (!task || task.error || !task.body) return result;

  task.body.split(/\r?\n/).forEach(function (line) {
    const index = line.indexOf("=");
    if (index < 1) return;
    const key = line.slice(0, index).trim();
    const value = line.slice(index + 1).trim();
    if (key === "loc") result.country = value.toUpperCase();
    if (key === "colo") result.colo = value.toUpperCase();
  });

  return result;
}

function classifyChatGPT(task, trace) {
  const region = joinRegion(trace.country, trace.colo);
  if (!task || task.error) {
    return result("error", "网络错误", region, task, task && task.error);
  }

  const body = task.body.toLowerCase();
  if (containsAny(body, BLOCK_TEXT.chatgpt)) {
    return result("locked", "未解锁", region, task, "地区限制");
  }

  if (
    trace.country &&
    CHATGPT_SUPPORTED_COUNTRIES.indexOf(trace.country) === -1
  ) {
    return result("locked", "未解锁", region, task, "地区不受支持");
  }

  if (task.status === 429) {
    return result("limited", "可用但限流", region, task, "HTTP 429");
  }

  if (task.status >= 200 && task.status < 400) {
    return result("ok", "已解锁", region, task, "");
  }

  if (task.status === 403 || task.status === 451) {
    return result("locked", "未解锁", region, task, "HTTP " + task.status);
  }

  return result("error", "检测异常", region, task, httpReason(task.status));
}

function classifyGemini(task) {
  const region = task ? extractGeminiRegion(task.body) : "";
  if (!task || task.error) {
    return result("error", "网络错误", region, task, task && task.error);
  }

  const body = task.body.toLowerCase();
  if (containsAny(body, BLOCK_TEXT.gemini)) {
    return result("locked", "未解锁", region, task, "地区限制");
  }

  if (task.status === 429) {
    return result("limited", "可用但限流", region, task, "HTTP 429");
  }

  // Gemini's HTML layout and embedded region marker change frequently. A valid
  // web-app response without a regional-block message is the stable signal.
  if (task.status >= 200 && task.status < 400) {
    return result("ok", "已解锁", region, task, "");
  }

  if (task.status === 403 || task.status === 451) {
    return result("locked", "未解锁", region, task, "HTTP " + task.status);
  }

  return result("error", "检测异常", region, task, httpReason(task.status));
}

function extractGeminiRegion(body) {
  if (!body) return "";
  const patterns = [
    /,2,1,200,"([A-Z]{3})"/,
    /"countryCode"\s*:\s*"([A-Z]{2,3})"/i,
    /"country_code"\s*:\s*"([A-Z]{2,3})"/i
  ];

  for (let i = 0; i < patterns.length; i += 1) {
    const match = body.match(patterns[i]);
    if (match) return match[1].toUpperCase();
  }
  return "";
}

function containsAny(text, needles) {
  return needles.some(function (needle) {
    return text.indexOf(needle) !== -1;
  });
}

function result(code, label, region, task, detail) {
  return {
    code: code,
    label: label,
    region: region || "",
    latency: task ? task.latency : 0,
    detail: detail || ""
  };
}

function formatLine(name, value) {
  const icon = {
    ok: "✅",
    locked: "❌",
    limited: "⚠️",
    error: "⚠️"
  }[value.code];
  const extras = [];
  if (value.region) extras.push(value.region);
  if (value.latency) extras.push(value.latency + "ms");
  if (value.detail && value.code !== "ok") extras.push(value.detail);

  return (
    padRight(name, 9) +
    icon +
    " " +
    value.label +
    (extras.length ? " · " + extras.join(" · ") : "")
  );
}

function padRight(text, length) {
  let output = text;
  while (output.length < length) output += " ";
  return output;
}

function joinRegion(country, colo) {
  if (country && colo) return country + "/" + colo;
  return country || colo || "";
}

function httpReason(status) {
  return status ? "HTTP " + status : "无有效响应";
}

function panelStyle(chatgpt, gemini) {
  if (chatgpt.code === "ok" && gemini.code === "ok") return "good";
  if (chatgpt.code === "locked" || gemini.code === "locked") return "error";
  return "alert";
}

function panelColor(chatgpt, gemini) {
  const style = panelStyle(chatgpt, gemini);
  if (style === "good") return "#34C759";
  if (style === "error") return "#FF3B30";
  return "#FF9500";
}

function shortSummary(chatgpt, gemini) {
  return "ChatGPT " + chatgpt.label + " · Gemini " + gemini.label;
}

function isPanelRun() {
  return (
    typeof $input !== "undefined" &&
    $input &&
    $input.purpose === "panel"
  );
}

function formatTime(date) {
  const year = date.getFullYear();
  const month = twoDigits(date.getMonth() + 1);
  const day = twoDigits(date.getDate());
  const hour = twoDigits(date.getHours());
  const minute = twoDigits(date.getMinutes());
  const second = twoDigits(date.getSeconds());
  return year + "-" + month + "-" + day + " " + hour + ":" + minute + ":" + second;
}

function twoDigits(value) {
  return value < 10 ? "0" + value : String(value);
}
