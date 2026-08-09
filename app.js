(function () {
  "use strict";

  var form = document.getElementById("search-form");
  var input = document.getElementById("question");
  var submitButton = document.getElementById("submit-button");
  var statusMessage = document.getElementById("status-message");
  var answerCard = document.getElementById("answer-card");
  var answerText = document.getElementById("answer-text");
  var sourcesSection = document.getElementById("sources-section");
  var sourcesList = document.getElementById("sources-list");
  var resetButton = document.getElementById("reset-button");
  var indexPanel = document.getElementById("index-panel");
  var indexList = document.getElementById("index-list");
  var indexCount = document.getElementById("index-count");
  var activeController = null;

  function setStatus(message, isError) {
    statusMessage.textContent = message || "";
    statusMessage.classList.toggle("is-error", Boolean(isError));
  }

  function setLoading(isLoading) {
    submitButton.disabled = isLoading;
    input.disabled = isLoading;
    submitButton.classList.toggle("is-loading", isLoading);
    submitButton.setAttribute("aria-label", isLoading ? "답변을 찾는 중" : "질문 검색");
  }

  function getClientId() {
    var storageKey = "policestep-client-id";
    try {
      var saved = window.localStorage.getItem(storageKey);
      if (saved) return saved;
      var created = window.crypto && typeof window.crypto.randomUUID === "function"
        ? window.crypto.randomUUID()
        : "client-" + Date.now() + "-" + Math.random().toString(16).slice(2);
      window.localStorage.setItem(storageKey, created);
      return created;
    } catch (error) {
      return "session-" + Date.now() + "-" + Math.random().toString(16).slice(2);
    }
  }

  function validateQuestion(value) {
    var question = String(value || "").trim();
    if (!question) return "질문을 입력해 주세요.";
    if (question.length > 500) return "질문은 500자 이내로 입력해 주세요.";
    return "";
  }

  function clearSources() {
    while (sourcesList.firstChild) {
      sourcesList.removeChild(sourcesList.firstChild);
    }
    sourcesSection.hidden = true;
  }

  function renderAnswer(data) {
    var answer = data && typeof data.answer === "string"
      ? data.answer.trim()
      : "등록된 자료에서 관련 내용을 찾지 못했습니다.";
    var sources = data && Array.isArray(data.sources) ? data.sources : [];

    answerText.textContent = answer;
    clearSources();

    sources.forEach(function (source) {
      if (!source || typeof source.title !== "string") return;
      var item = document.createElement("li");
      var rowLabel = Number.isFinite(Number(source.row)) ? " · 시트 " + Number(source.row) + "행" : "";
      item.textContent = source.title.trim() + rowLabel;
      sourcesList.appendChild(item);
    });

    sourcesSection.hidden = sourcesList.childElementCount === 0;
    answerCard.hidden = false;
    answerCard.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }

  function userMessageFor(errorCode, fallback) {
    var messages = {
      INVALID_REQUEST: "질문 형식을 확인해 주세요.",
      QUESTION_TOO_LONG: "질문은 500자 이내로 입력해 주세요.",
      RATE_LIMIT: "질문이 너무 빠르게 반복되었습니다. 잠시 후 다시 시도해 주세요.",
      CONFIG_MISSING: "앱 연결 설정이 아직 완료되지 않았습니다.",
      SHEET_ERROR: "업무자료를 읽지 못했습니다. 관리자에게 알려 주세요.",
      GEMINI_AUTH: "AI 연결 설정을 확인해야 합니다. 관리자에게 알려 주세요.",
      GEMINI_QUOTA: "AI 사용량이 한도에 도달했습니다. 잠시 후 다시 시도해 주세요.",
      GEMINI_ERROR: "AI 답변을 만들지 못했습니다. 잠시 후 다시 시도해 주세요.",
      INTERNAL_ERROR: "일시적인 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.",
    };
    return messages[errorCode] || fallback || messages.INTERNAL_ERROR;
  }

  function getEndpoint() {
    var runtimeConfig = window.POLICESTEP_CONFIG || {};
    var endpoint = String(runtimeConfig.appsScriptUrl || "").trim();
    if (!/^https:\/\/script\.google\.com\/macros\/s\/[^/]+\/exec$/.test(endpoint)) {
      throw { code: "CONFIG_MISSING", message: "Apps Script의 /exec 주소를 config.js에 설정해 주세요." };
    }
    return endpoint;
  }

  async function requestJson(body, timeoutMs) {
    var controller = new AbortController();
    var timeoutId = window.setTimeout(function () { controller.abort(); }, timeoutMs);

    try {
      var response = await fetch(getEndpoint(), {
        method: "POST",
        headers: {
          "Content-Type": "text/plain;charset=UTF-8",
          "Accept": "application/json",
        },
        body: JSON.stringify(body),
        cache: "no-store",
        redirect: "follow",
        signal: controller.signal,
      });
      var responseText = await response.text();
      var payload;
      try {
        payload = JSON.parse(responseText);
      } catch (parseError) {
        throw { code: "INTERNAL_ERROR", message: "서버 응답을 확인할 수 없습니다." };
      }
      if (!payload || payload.ok !== true) {
        throw payload && payload.error
          ? payload.error
          : { code: "INTERNAL_ERROR", message: "자료를 가져오지 못했습니다." };
      }
      return payload.data || {};
    } finally {
      window.clearTimeout(timeoutId);
    }
  }

  function renderIndex(data) {
    var groups = data && Array.isArray(data.groups) ? data.groups : [];
    var total = Number(data && data.total) || 0;
    while (indexList.firstChild) indexList.removeChild(indexList.firstChild);

    if (!groups.length) {
      var empty = document.createElement("p");
      empty.className = "index-empty";
      empty.textContent = "현재 공개된 업무 목록이 없습니다.";
      indexList.appendChild(empty);
      indexCount.textContent = "0개 업무";
      return;
    }

    groups.forEach(function (group) {
      var details = document.createElement("details");
      details.className = "index-group";

      var summary = document.createElement("summary");
      var category = document.createElement("span");
      category.className = "index-category";
      category.textContent = String(group.category || "기타");
      var count = document.createElement("span");
      count.className = "index-group-count";
      count.textContent = String(Number(group.count) || 0) + "개";
      summary.appendChild(category);
      summary.appendChild(count);
      details.appendChild(summary);

      var items = document.createElement("div");
      items.className = "index-items";
      (Array.isArray(group.items) ? group.items : []).forEach(function (item) {
        if (!item || typeof item.title !== "string") return;
        var button = document.createElement("button");
        button.type = "button";
        button.className = "index-item";
        button.textContent = item.subcategory
          ? item.title + " · " + item.subcategory
          : item.title;
        button.addEventListener("click", function () {
          input.value = item.title + "에 대해 알려줘";
          setStatus("업무명이 입력되었습니다. 검색 버튼을 눌러 주세요.", false);
          input.focus();
          input.setSelectionRange(input.value.length, input.value.length);
          window.scrollTo({ top: 0, behavior: "smooth" });
        });
        items.appendChild(button);
      });
      details.appendChild(items);
      indexList.appendChild(details);
    });

    indexCount.textContent = total + "개 업무";
  }

  function renderIndexError(error) {
    while (indexList.firstChild) indexList.removeChild(indexList.firstChild);

    var message = document.createElement("p");
    message.className = "index-empty is-error";
    message.textContent = error && error.code === "INVALID_REQUEST"
      ? "색인 서버가 이전 버전입니다. Apps Script를 새 버전으로 배포해 주세요."
      : "업무 목록을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.";
    indexList.appendChild(message);
    indexCount.textContent = "연결 확인 필요";
  }

  async function loadIndex() {
    try {
      var data = await requestJson({ action: "index" }, 15000);
      renderIndex(data);
    } catch (error) {
      renderIndexError(error);
    }
  }

  async function requestAnswer(question) {
    var runtimeConfig = window.POLICESTEP_CONFIG || {};
    var endpoint = getEndpoint();

    activeController = new AbortController();
    var timeoutMs = Number(runtimeConfig.requestTimeoutMs) || 45000;
    var timeoutId = window.setTimeout(function () {
      activeController.abort();
    }, timeoutMs);

    try {
      var response = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "text/plain;charset=UTF-8",
          "Accept": "application/json",
        },
        body: JSON.stringify({ question: question, clientId: getClientId() }),
        cache: "no-store",
        redirect: "follow",
        signal: activeController.signal,
      });

      var responseText = await response.text();
      var payload;
      try {
        payload = JSON.parse(responseText);
      } catch (parseError) {
        throw { code: "INTERNAL_ERROR", message: "서버 응답을 확인할 수 없습니다." };
      }

      if (!payload || payload.ok !== true) {
        throw payload && payload.error
          ? payload.error
          : { code: "INTERNAL_ERROR", message: "답변을 가져오지 못했습니다." };
      }
      return payload.data || {};
    } catch (error) {
      if (error && error.name === "AbortError") {
        throw { code: "NETWORK_TIMEOUT", message: "응답 시간이 길어졌습니다. 다시 시도해 주세요." };
      }
      if (error && error.code) throw error;
      throw { code: "NETWORK_ERROR", message: "네트워크 연결을 확인한 후 다시 시도해 주세요." };
    } finally {
      window.clearTimeout(timeoutId);
      activeController = null;
    }
  }

  form.addEventListener("submit", async function (event) {
    event.preventDefault();
    var question = input.value.trim();
    var validationMessage = validateQuestion(question);
    if (validationMessage) {
      answerCard.hidden = true;
      setStatus(validationMessage, true);
      input.focus();
      return;
    }

    answerCard.hidden = true;
    clearSources();
    setLoading(true);
    setStatus("최신 업무자료에서 답을 찾고 있습니다…", false);

    try {
      var data = await requestAnswer(question);
      renderAnswer(data);
      setStatus("", false);
    } catch (error) {
      answerCard.hidden = true;
      setStatus(userMessageFor(error && error.code, error && error.message), true);
    } finally {
      setLoading(false);
    }
  });

  input.addEventListener("keydown", function (event) {
    if (event.key === "Enter") {
      event.preventDefault();
      form.requestSubmit();
    }
  });

  resetButton.addEventListener("click", function () {
    answerCard.hidden = true;
    clearSources();
    setStatus("", false);
    input.value = "";
    input.focus();
  });

  loadIndex();

  if ("serviceWorker" in navigator) {
    window.addEventListener("load", function () {
      navigator.serviceWorker.register("./service-worker.js").catch(function () {
        // PWA 설치 실패가 질문 기능을 막지 않도록 조용히 처리합니다.
      });
    });
  }
})();
