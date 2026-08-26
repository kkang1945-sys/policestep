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
  var lawList = document.getElementById("law-list");
  var lawCount = document.getElementById("law-count");
  var cctvDisclosure = document.getElementById("cctv-disclosure");
  var cctvForm = document.getElementById("cctv-search-form");
  var cctvInput = document.getElementById("cctv-address");
  var cctvSearchButton = document.getElementById("cctv-search-button");
  var cctvStatus = document.getElementById("cctv-status");
  var cctvAddressResults = document.getElementById("cctv-address-results");
  var cctvNearby = document.getElementById("cctv-nearby");
  var cctvSelectedAddress = document.getElementById("cctv-selected-address");
  var cctvDataTime = document.getElementById("cctv-data-time");
  var cctvList = document.getElementById("cctv-list");
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
      CCTV_CONFIG: "CCTV·도로명주소 연결 설정이 아직 완료되지 않았습니다.",
      ADDRESS_INVALID: "도로명주소만 입력해 주세요. 개인정보와 상세주소는 사용할 수 없습니다.",
      ADDRESS_NOT_FOUND: "대전광역시 도로명주소를 찾지 못했습니다.",
      ADDRESS_ERROR: "도로명주소를 확인하지 못했습니다. 잠시 후 다시 시도해 주세요.",
      CCTV_API: "대전 CCTV 공공데이터를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.",
      CCTV_DATA: "검색 가능한 CCTV 위치정보가 없습니다.",
      CCTV_RATE_LIMIT: "CCTV 검색 요청이 많습니다. 잠시 후 다시 시도해 주세요.",
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

  function clearElement(element) {
    while (element.firstChild) element.removeChild(element.firstChild);
  }

  function setCctvStatus(message, isError) {
    cctvStatus.textContent = message || "";
    cctvStatus.classList.toggle("is-error", Boolean(isError));
  }

  function setCctvLoading(isLoading, label) {
    cctvInput.disabled = isLoading;
    cctvSearchButton.disabled = isLoading;
    cctvSearchButton.textContent = isLoading ? (label || "확인 중…") : "주소 검색";
  }

  function cctvErrorMessage(error) {
    if (error && error.name === "AbortError") {
      return "응답 시간이 길어졌습니다. 다시 시도해 주세요.";
    }
    if (error && error.code === "INVALID_REQUEST") {
      return "CCTV 서버가 이전 버전입니다. Apps Script의 CCTV 기능을 새 버전으로 배포해 주세요.";
    }
    return userMessageFor(error && error.code, error && error.message);
  }

  function resetCctvResults(clearInput) {
    clearElement(cctvAddressResults);
    clearElement(cctvList);
    cctvNearby.hidden = true;
    cctvSelectedAddress.textContent = "";
    cctvDataTime.textContent = "";
    setCctvStatus("", false);
    if (clearInput) cctvInput.value = "";
  }

  function formatDistance(meters) {
    var value = Number(meters);
    if (!Number.isFinite(value)) return "거리 미상";
    if (value < 1000) return Math.round(value) + "m";
    return (value / 1000).toFixed(value < 10000 ? 1 : 0) + "km";
  }

  function mapLinkFor(item) {
    var name = encodeURIComponent("공공 CCTV " + String(item.address || "위치"));
    return "https://map.kakao.com/link/map/" + name + "," + Number(item.latitude) + "," + Number(item.longitude);
  }

  function renderNearbyCctv(data, selectedAddress) {
    var items = data && Array.isArray(data.items) ? data.items : [];
    clearElement(cctvList);
    cctvSelectedAddress.textContent = selectedAddress;
    cctvDataTime.textContent = data && data.dataDate ? "조회 " + data.dataDate : "공공데이터 기준";

    items.forEach(function (item, index) {
      var row = document.createElement("li");
      row.className = "cctv-item";

      var rank = document.createElement("span");
      rank.className = "cctv-rank";
      rank.textContent = String(index + 1);

      var main = document.createElement("div");
      main.className = "cctv-item-main";
      var address = document.createElement("strong");
      address.textContent = String(item.address || "주소 정보 없음");
      var meta = document.createElement("span");
      meta.textContent = [item.type, item.agency].filter(Boolean).join(" · ") || "공공 CCTV";
      main.appendChild(address);
      main.appendChild(meta);

      var distance = document.createElement("span");
      distance.className = "cctv-distance";
      distance.textContent = formatDistance(item.distanceMeters);

      var mapLink = document.createElement("a");
      mapLink.className = "cctv-map-link";
      mapLink.href = mapLinkFor(item);
      mapLink.target = "_blank";
      mapLink.rel = "noopener noreferrer";
      mapLink.textContent = "지도에서 CCTV 위치 보기";

      row.appendChild(rank);
      row.appendChild(main);
      row.appendChild(distance);
      row.appendChild(mapLink);
      cctvList.appendChild(row);
    });

    cctvNearby.hidden = items.length === 0;
  }

  async function selectCctvAddress(address) {
    clearElement(cctvAddressResults);
    cctvNearby.hidden = true;
    setCctvLoading(true, "CCTV 찾는 중…");
    setCctvStatus("공개 CCTV 위치와 거리를 계산하고 있습니다…", false);

    try {
      var data = await requestJson({
        action: "cctvNearby",
        address: {
          roadAddress: address.roadAddress,
          admCd: address.admCd,
          rnMgtSn: address.rnMgtSn,
          udrtYn: address.udrtYn,
          buldMnnm: address.buldMnnm,
          buldSlno: address.buldSlno
        }
      }, 45000);
      renderNearbyCctv(data, address.roadAddress);
      setCctvStatus(data.items && data.items.length
        ? "가까운 CCTV " + data.items.length + "곳을 거리순으로 표시했습니다."
        : "가까운 CCTV를 찾지 못했습니다.", !(data.items && data.items.length));
    } catch (error) {
      cctvNearby.hidden = true;
      setCctvStatus(cctvErrorMessage(error), true);
    } finally {
      setCctvLoading(false);
    }
  }

  function renderCctvAddresses(data) {
    var items = data && Array.isArray(data.items) ? data.items : [];
    clearElement(cctvAddressResults);
    items.forEach(function (address) {
      var button = document.createElement("button");
      button.type = "button";
      button.className = "cctv-address-option";
      button.textContent = address.roadAddress;
      button.addEventListener("click", function () { selectCctvAddress(address); });
      cctvAddressResults.appendChild(button);
    });
    setCctvStatus(items.length
      ? "공식 도로명주소를 선택하면 가까운 CCTV를 찾습니다."
      : "대전광역시 도로명주소를 찾지 못했습니다.", items.length === 0);
  }

  function validateRoadAddress(value) {
    var text = String(value || "").replace(/\s+/g, " ").trim();
    if (!text) return { ok: false, message: "도로명주소를 입력해 주세요." };
    if (text.length > 80) return { ok: false, message: "주소는 80자 이내로 입력해 주세요." };
    if (/\b\d{6}\s*-?\s*[1-8]\d{6}\b|\b(?:01[016789]|0[2-6][1-5]?)\s*-?\s*\d{3,4}\s*-?\s*\d{4}\b|[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i.test(text)) {
      return { ok: false, message: "개인정보가 포함되어 검색하지 않았습니다. 도로명주소만 입력해 주세요." };
    }
    if (/(?:이름|성명|신고자|피해자|피의자|용의자|민원인|전화|연락처|사건\s*번호)\s*[:：]?/i.test(text)) {
      return { ok: false, message: "사람·사건 정보는 입력할 수 없습니다. 도로명주소만 입력해 주세요." };
    }
    if (/\d+\s*동\s*\d+\s*호|\d+\s*(?:층|호)\b|(?:아파트|오피스텔|빌라)\s*\d*\s*동/i.test(text)) {
      return { ok: false, message: "동·층·호수 등 상세주소는 입력할 수 없습니다." };
    }
    if (!/^[0-9A-Za-z가-힣\s\-·]+$/.test(text)) {
      return { ok: false, message: "도로명주소에 필요한 글자만 입력해 주세요." };
    }
    return { ok: true, value: text };
  }
  function renderIndex(data) {
    var groups = data && Array.isArray(data.groups) ? data.groups : [];
    while (indexList.firstChild) indexList.removeChild(indexList.firstChild);
    if (lawList) while (lawList.firstChild) lawList.removeChild(lawList.firstChild);

    var standardGroups = [];
    var lawGroup = null;

    groups.forEach(function(g) {
      if (String(g.category).trim() === "지역경찰 운영지침") {
        lawGroup = g;
      } else {
        standardGroups.push(g);
      }
    });

    // Render Standard Groups
    if (!standardGroups.length) {
      var empty = document.createElement("p");
      empty.className = "index-empty";
      empty.textContent = "현재 공개된 업무 목록이 없습니다.";
      indexList.appendChild(empty);
      indexCount.textContent = "0개 업무";
    } else {
      var standardTotal = 0;
      standardGroups.forEach(function (group) {
        standardTotal += Number(group.count) || 0;
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
            var cat = group.category || "기타";
            input.value = "[" + cat + "] " + item.title + "에 대해 알려줘";
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
      indexCount.textContent = standardTotal + "개 업무";
    }

    // Render Law Group
    if (lawList) {
      if (!lawGroup || !lawGroup.items || !lawGroup.items.length) {
        var emptyLaw = document.createElement("p");
        emptyLaw.className = "index-empty";
        emptyLaw.textContent = "현재 공개된 지침이 없습니다.";
        lawList.appendChild(emptyLaw);
        if (lawCount) lawCount.textContent = "0개 조문";
      } else {
        if (lawCount) lawCount.textContent = (Number(lawGroup.count) || 0) + "개 조문";
        
        var itemsContainer = document.createElement("div");
        itemsContainer.className = "index-items";
        
        var tree = {};
        var directItems = [];

        (Array.isArray(lawGroup.items) ? lawGroup.items : []).forEach(function (item) {
          if (!item || typeof item.title !== "string") return;
          var subcat = item.subcategory || "";
          if (!subcat) {
            directItems.push(item);
          } else {
            var parts = subcat.split(">").map(function(s) { return s.trim(); });
            var chapter = parts[0] || "";
            var section = parts[1] || "";
            
            if (!tree[chapter]) tree[chapter] = { direct: [], sections: {} };
            
            if (section) {
              if (!tree[chapter].sections[section]) tree[chapter].sections[section] = [];
              tree[chapter].sections[section].push(item);
            } else {
              tree[chapter].direct.push(item);
            }
          }
        });

        function createButton(item) {
          var button = document.createElement("button");
          button.type = "button";
          button.className = "index-item";
          button.textContent = item.title;
          button.addEventListener("click", function () {
            var cat = lawGroup.category || "기타";
            input.value = "[" + cat + "] " + item.title + "에 대해 알려줘";
            setStatus("업무명이 입력되었습니다. 검색 버튼을 눌러 주세요.", false);
            input.focus();
            input.setSelectionRange(input.value.length, input.value.length);
            window.scrollTo({ top: 0, behavior: "smooth" });
          });
          return button;
        }

        Object.keys(tree).forEach(function(chapter) {
           var chapterDetails = document.createElement("details");
           chapterDetails.className = "index-chapter";
           var chapterSummary = document.createElement("summary");
           chapterSummary.textContent = chapter;
           chapterSummary.className = "index-chapter-summary";
           chapterDetails.appendChild(chapterSummary);
           
           var chapterContent = document.createElement("div");
           chapterContent.className = "index-chapter-content";

           Object.keys(tree[chapter].sections).forEach(function(section) {
             var sectionDetails = document.createElement("details");
             sectionDetails.className = "index-section";
             var sectionSummary = document.createElement("summary");
             sectionSummary.textContent = section;
             sectionSummary.className = "index-section-summary";
             sectionDetails.appendChild(sectionSummary);
             
             var sectionContent = document.createElement("div");
             sectionContent.className = "index-section-content";
             tree[chapter].sections[section].forEach(function(item) {
               sectionContent.appendChild(createButton(item));
             });
             sectionDetails.appendChild(sectionContent);
             chapterContent.appendChild(sectionDetails);
           });

           tree[chapter].direct.forEach(function(item) {
              chapterContent.appendChild(createButton(item));
           });

           chapterDetails.appendChild(chapterContent);
           itemsContainer.appendChild(chapterDetails);
        });

        directItems.forEach(function(item) {
           itemsContainer.appendChild(createButton(item));
        });

        lawList.appendChild(itemsContainer);
      }
    }
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

  if (cctvForm && cctvDisclosure) {
    cctvForm.addEventListener("submit", async function (event) {
      event.preventDefault();
      resetCctvResults(false);

      var validation = validateRoadAddress(cctvInput.value);
      if (!validation.ok) {
        setCctvStatus(validation.message, true);
        cctvInput.focus();
        return;
      }

      setCctvLoading(true, "검색 중…");
      setCctvStatus("대전광역시 공식 도로명주소를 확인하고 있습니다…", false);
      try {
        var data = await requestJson({ action: "cctvAddressSearch", keyword: validation.value }, 20000);
        renderCctvAddresses(data);
      } catch (error) {
        setCctvStatus(cctvErrorMessage(error), true);
      } finally {
        setCctvLoading(false);
      }
    });

    cctvDisclosure.addEventListener("toggle", function () {
      if (!cctvDisclosure.open) resetCctvResults(true);
    });
  }
  loadIndex();

  if ("serviceWorker" in navigator) {
    window.addEventListener("load", function () {
      navigator.serviceWorker.register("./service-worker.js").catch(function () {
        // PWA 설치 실패가 질문 기능을 막지 않도록 조용히 처리합니다.
      });
    });
  }
})();
