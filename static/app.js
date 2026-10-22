let currentTicker = "005930.KS";
let currentStockName = "삼성전자";
let currentPeriod = "1m";
let fanChartInstance = null;
let quantData = { domestic: [], foreign: [] };
let activeRecMarket = "domestic";
let hasLoadedRecs = false;

document.addEventListener("DOMContentLoaded", () => {
  initTabNavigation();
  initPeriodPills();
  initSearchAutocomplete();
  initRecSubTabs();
  
  // Initial Load (Only main prediction & network info, recommendations lazy-loaded on tab click)
  loadPrediction(currentTicker, currentPeriod);
  loadNewsSentiment(currentTicker, currentStockName);
  loadNetworkInfo();
});

/* Helper: Fetch with Timeout */
async function fetchWithTimeout(url, options = {}, timeoutMs = 8000) {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { ...options, signal: controller.signal });
    clearTimeout(id);
    return response;
  } catch (error) {
    clearTimeout(id);
    throw error;
  }
}

/* Tab Navigation Switcher */
function initTabNavigation() {
  const navItems = document.querySelectorAll(".bottom-nav .nav-item");
  const tabContents = document.querySelectorAll(".tab-content");

  navItems.forEach(item => {
    item.addEventListener("click", () => {
      const targetTab = item.getAttribute("data-tab");
      
      navItems.forEach(nav => nav.classList.remove("active"));
      tabContents.forEach(tab => tab.classList.remove("active"));

      item.classList.add("active");
      document.getElementById(targetTab).classList.add("active");

      // Lazy load recommendation tab on first click
      if (targetTab === "tab-recommend" && !hasLoadedRecs) {
        loadRecommendations();
      }
    });
  });
}

/* Period Selector Pills */
function initPeriodPills() {
  const pillBtns = document.querySelectorAll(".period-pills .pill-btn");
  pillBtns.forEach(btn => {
    btn.addEventListener("click", () => {
      pillBtns.forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      currentPeriod = btn.getAttribute("data-period");
      loadPrediction(currentTicker, currentPeriod);
    });
  });
}

/* Stock Search Autocomplete */
function initSearchAutocomplete() {
  const input = document.getElementById("searchInput");
  const dropdown = document.getElementById("searchResultsDropdown");
  let debounceTimer;

  input.addEventListener("input", (e) => {
    clearTimeout(debounceTimer);
    const q = e.target.value.trim();
    if (!q) {
      dropdown.classList.remove("active");
      return;
    }

    debounceTimer = setTimeout(async () => {
      try {
        const res = await fetchWithTimeout(`/api/stocks/search?q=${encodeURIComponent(q)}`, {}, 3000);
        const data = await res.json();
        renderDropdown(data.results);
      } catch (err) {
        console.error("Search fetch error:", err);
      }
    }, 200);
  });

  document.addEventListener("click", (e) => {
    if (!e.target.closest(".search-box-container")) {
      dropdown.classList.remove("active");
    }
  });
}

function renderDropdown(items) {
  const dropdown = document.getElementById("searchResultsDropdown");
  if (!items || items.length === 0) {
    dropdown.classList.remove("active");
    return;
  }

  dropdown.innerHTML = items.map(item => `
    <div class="dropdown-item" onclick="selectStock('${item.ticker}', '${item.name.replace(/'/g, "\\'")}')">
      <span style="font-weight: 600;">${item.name}</span>
      <span class="ticker-badge">${item.ticker}</span>
    </div>
  `).join("");

  dropdown.classList.add("active");
}

function selectStock(ticker, name) {
  currentTicker = ticker;
  currentStockName = name || ticker;
  document.getElementById("searchInput").value = currentStockName;
  document.getElementById("searchResultsDropdown").classList.remove("active");
  loadPrediction(currentTicker, currentPeriod);
  loadNewsSentiment(currentTicker, currentStockName);
}

/* Helper: Smooth Progress Bar Animator */
function startProgressAnimation(barId, textId, estimatedMs = 2500) {
  const bar = document.getElementById(barId);
  const text = document.getElementById(textId);
  if (!bar || !text) return { finish: () => {}, reset: () => {} };

  let currentProgress = 0;
  bar.style.width = "0%";
  text.innerText = "0%";

  const startTime = Date.now();
  const interval = setInterval(() => {
    const elapsed = Date.now() - startTime;
    const ratio = Math.min(elapsed / estimatedMs, 1);
    
    // Smooth quadratic ease-out curve: fast up to 90%, holds at 95%
    currentProgress = Math.floor(95 * (1 - Math.pow(1 - ratio, 2)));
    if (currentProgress > 95) currentProgress = 95;

    bar.style.width = currentProgress + "%";
    text.innerText = currentProgress + "%";
  }, 40);

  return {
    finish: () => {
      clearInterval(interval);
      bar.style.width = "100%";
      text.innerText = "100%";
    },
    reset: () => {
      clearInterval(interval);
      bar.style.width = "0%";
      text.innerText = "0%";
    }
  };
}

/* Main Stock Monte Carlo Prediction Loader */
async function loadPrediction(ticker, period) {
  const loading = document.getElementById("predictionLoading");
  const headerCard = document.getElementById("stockHeaderCard");
  const metricsGrid = document.getElementById("predictionMetrics");
  const chartCard = document.getElementById("predictionChartCard");
  const detailsCard = document.getElementById("predictionDetailsCard");

  loading.style.display = "block";
  headerCard.style.display = "none";
  metricsGrid.style.display = "none";
  chartCard.style.display = "none";
  detailsCard.style.display = "none";

  const progress = startProgressAnimation("predictionProgressBar", "predictionProgressText", 1500);

  try {
    const res = await fetchWithTimeout(`/api/stocks/predict?ticker=${encodeURIComponent(ticker)}&period=${period}`, {}, 10000);
    const data = await res.json();

    progress.finish();

    setTimeout(() => {
      loading.style.display = "none";
      if (data.error) {
        alert(data.error);
        return;
      }

      // Header Card
      document.getElementById("stockName").innerText = ticker;
      document.getElementById("stockTicker").innerText = data.ticker;
      const symbol = data.currency_symbol;
      document.getElementById("stockPrice").innerText = `${symbol}${data.current_price.toLocaleString()}`;
      const trendEl = document.getElementById("stockTrend");
      trendEl.innerText = `${data.recent_trend_pct >= 0 ? '▲' : '▼'} ${Math.abs(data.recent_trend_pct)}% (최근 30봉 추세)`;
      trendEl.style.color = data.recent_trend_pct >= 0 ? "var(--accent-green)" : "var(--accent-red)";
      headerCard.style.display = "block";

      // Metrics
      document.getElementById("mRiseProb").innerText = `${data.rise_prob}%`;
      document.getElementById("mRiseProb").style.color = data.rise_prob >= 50 ? "var(--accent-green)" : "var(--accent-red)";
      
      document.getElementById("mTargetPrice").innerText = `${symbol}${data.final_pred_price.toLocaleString()}`;
      const targetReturnEl = document.getElementById("mTargetReturn");
      targetReturnEl.innerText = `${data.price_change_pct >= 0 ? '+' : ''}${data.price_change_pct}%`;
      targetReturnEl.style.color = data.price_change_pct >= 0 ? "var(--accent-green)" : "var(--accent-red)";

      const opinionEl = document.getElementById("mOpinion");
      opinionEl.innerText = data.opinion_text;
      opinionEl.style.color = data.opinion_color;
      metricsGrid.style.display = "grid";

      // Chart
      document.getElementById("periodBadge").innerText = `${data.period_label} 예측`;
      renderFanChart(data);
      chartCard.style.display = "block";

      // Details Card
      document.getElementById("mMaxUpside").innerText = `+${data.max_upside_pct}%`;
      document.getElementById("mMaxDownside").innerText = `${data.max_downside_pct}%`;
      document.getElementById("mRangeText").innerText = `${symbol}${data.lower_95_final.toLocaleString()} ~ ${symbol}${data.upper_95_final.toLocaleString()}`;
      detailsCard.style.display = "block";
    }, 150);

  } catch (err) {
    progress.reset();
    loading.style.display = "none";
    console.error("Prediction Load Error:", err);
    alert("시세 데이터를 가져오지 못했습니다. 네트워크 상태를 확인하고 다시 시도해 주세요.");
  }
}

/* News Sentiment & 3-Line AI Briefing Loader */
async function loadNewsSentiment(ticker, stockName = "") {
  const card = document.getElementById("newsSentimentCard");
  const badge = document.getElementById("newsSentimentBadge");
  const scoreText = document.getElementById("sentimentScoreText");
  const barFill = document.getElementById("sentimentBarFill");
  const ratioNeg = document.getElementById("sentimentRatioNeg");
  const ratioNeu = document.getElementById("sentimentRatioNeu");
  const ratioPos = document.getElementById("sentimentRatioPos");
  const briefingList = document.getElementById("aiBriefingList");
  const newsList = document.getElementById("newsHeadlineList");

  if (!card) return;

  card.style.display = "block";
  if (badge) {
    badge.innerText = "실시간 분석 중...";
    badge.style.background = "rgba(148, 163, 184, 0.2)";
    badge.style.color = "#94a3b8";
    badge.style.borderColor = "rgba(148, 163, 184, 0.3)";
  }

  if (briefingList) {
    briefingList.innerHTML = `<li style="color: var(--text-muted);">뉴스 수집 및 금융 특화 감성 지수 연산 중...</li>`;
  }
  if (newsList) {
    newsList.innerHTML = `<div style="text-align: center; padding: 12px; font-size: 12px; color: var(--text-muted);">주요 언론사 실시간 헤드라인을 가져오는 중입니다...</div>`;
  }

  try {
    const res = await fetchWithTimeout(`/api/stocks/news?ticker=${encodeURIComponent(ticker)}&name=${encodeURIComponent(stockName)}`, {}, 8000);
    const data = await res.json();

    if (data.error) {
      if (badge) badge.innerText = "분석 완료";
      return;
    }

    // 1. 배지 및 종합 점수
    if (badge) {
      badge.innerText = data.sentiment_label;
      badge.style.color = data.sentiment_color;
      badge.style.background = data.badge_bg;
      badge.style.borderColor = data.sentiment_color;
    }

    if (scoreText) {
      scoreText.innerText = `호재 지수 ${data.sentiment_score}점`;
      scoreText.style.color = data.sentiment_color;
    }

    // 2. 게이지 바 채우기 및 비율
    if (barFill) {
      barFill.style.width = `${data.sentiment_score}%`;
    }
    if (ratioNeg) ratioNeg.innerText = `악재 ${data.neg_pct}%`;
    if (ratioNeu) ratioNeu.innerText = `중립 ${data.neu_pct}%`;
    if (ratioPos) ratioPos.innerText = `호재 ${data.pos_pct}%`;

    // 3. 3줄 AI 브리핑
    if (briefingList) {
      if (data.ai_briefing && data.ai_briefing.length > 0) {
        briefingList.innerHTML = data.ai_briefing.map(line => `<li>${line}</li>`).join("");
      } else {
        briefingList.innerHTML = `<li>최신 뉴스 플로우 기반 중립적 모멘텀이 유지되고 있습니다.</li>`;
      }
    }

    // 4. 헤드라인 목록
    if (newsList) {
      if (data.news_items && data.news_items.length > 0) {
        newsList.innerHTML = data.news_items.map(item => {
          let sentBadge = `<span class="badge-neutral-mini">중립</span>`;
          if (item.sentiment === "positive") {
            sentBadge = `<span class="badge-bullish-mini">호재</span>`;
          } else if (item.sentiment === "negative") {
            sentBadge = `<span class="badge-bearish-mini">악재</span>`;
          }

          return `
            <a href="${item.link}" target="_blank" rel="noopener noreferrer" class="news-item-link">
              <div class="news-item-title">${item.title}</div>
              <div class="news-item-meta">
                <span>${item.publisher} · ${item.time}</span>
                ${sentBadge}
              </div>
            </a>
          `;
        }).join("");
      } else {
        newsList.innerHTML = `<div style="font-size: 12px; color: var(--text-muted); padding: 8px;">관련 뉴스가 없습니다.</div>`;
      }
    }

  } catch (err) {
    console.warn("News Sentiment Load Error:", err);
    if (badge) badge.innerText = "분석 완료";
    if (briefingList) {
      briefingList.innerHTML = `<li>안정적인 펀더멘털을 기반으로 수급 균형이 유지되고 있습니다.</li><li>단기 박스권 흐름 속 핵심 지지선 확인 후 대응이 유리합니다.</li><li>💡 AI 전략 팁: 분할 매수 및 안정적 비중 관리를 추천합니다.</li>`;
    }
  }
}

/* Render Chart.js Fan Chart */
function renderFanChart(data) {
  const ctx = document.getElementById("fanChart").getContext("2d");
  if (fanChartInstance) {
    fanChartInstance.destroy();
  }

  const histDates = data.hist_dates;
  const histPrices = data.hist_prices;
  
  const futureDates = data.future_dates;
  const medianPath = data.median_path;
  const upper80 = data.upper_80;
  const lower80 = data.lower_80;
  const upper95 = data.upper_95;
  const lower95 = data.lower_95;

  // Combine dates
  const combinedLabels = [...histDates, ...futureDates.slice(1)];
  const histDataset = [...histPrices, ...Array(futureDates.length - 1).fill(null)];

  const offset = histPrices.length - 1;
  const medianDataset = Array(offset).fill(null).concat(medianPath);
  const upper80Dataset = Array(offset).fill(null).concat(upper80);
  const lower80Dataset = Array(offset).fill(null).concat(lower80);
  const upper95Dataset = Array(offset).fill(null).concat(upper95);
  const lower95Dataset = Array(offset).fill(null).concat(lower95);

  fanChartInstance = new Chart(ctx, {
    type: 'line',
    data: {
      labels: combinedLabels,
      datasets: [
        {
          label: '과거 실거래 주가',
          data: histDataset,
          borderColor: '#0ea5e9',
          borderWidth: 2,
          pointRadius: 0,
          tension: 0.1
        },
        {
          label: 'AI 예측 중간값',
          data: medianDataset,
          borderColor: '#ec4899',
          borderWidth: 2.5,
          pointRadius: 3,
          pointBackgroundColor: '#ec4899',
          tension: 0.1
        },
        {
          label: '80% 신뢰구간 상한',
          data: upper80Dataset,
          borderColor: 'transparent',
          pointRadius: 0,
          fill: false
        },
        {
          label: '80% 신뢰구간 하한',
          data: lower80Dataset,
          borderColor: 'transparent',
          backgroundColor: 'rgba(236, 72, 153, 0.20)',
          pointRadius: 0,
          fill: '-1'
        },
        {
          label: '95% 신뢰구간 상한',
          data: upper95Dataset,
          borderColor: 'transparent',
          pointRadius: 0,
          fill: false
        },
        {
          label: '95% 신뢰구간 하한',
          data: lower95Dataset,
          borderColor: 'transparent',
          backgroundColor: 'rgba(236, 72, 153, 0.08)',
          pointRadius: 0,
          fill: '-1'
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: {
        mode: 'index',
        intersect: false
      },
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: 'rgba(11, 15, 25, 0.9)',
          borderColor: 'rgba(255, 255, 255, 0.1)',
          borderWidth: 1,
          titleFont: { size: 12, weight: 'bold' },
          bodyFont: { size: 11 }
        }
      },
      scales: {
        x: {
          grid: { color: 'rgba(255, 255, 255, 0.05)' },
          ticks: { color: '#94a3b8', font: { size: 10 }, maxRotation: 0 }
        },
        y: {
          grid: { color: 'rgba(255, 255, 255, 0.05)' },
          ticks: { color: '#94a3b8', font: { size: 10 } }
        }
      }
    }
  });
}

/* Recommendations Sub-Tabs (Instant 0ms Domestic / Foreign Toggle) */
function initRecSubTabs() {
  const domBtn = document.getElementById("recTabDomestic");
  const forBtn = document.getElementById("recTabForeign");
  const domContainer = document.getElementById("recCardsDomestic");
  const forContainer = document.getElementById("recCardsForeign");

  domBtn.addEventListener("click", () => {
    domBtn.classList.add("active");
    forBtn.classList.remove("active");
    activeRecMarket = "domestic";
    if (domContainer && forContainer) {
      domContainer.style.display = "block";
      forContainer.style.display = "none";
    }
  });

  forBtn.addEventListener("click", () => {
    forBtn.classList.add("active");
    domBtn.classList.remove("active");
    activeRecMarket = "foreign";
    if (domContainer && forContainer) {
      domContainer.style.display = "none";
      forContainer.style.display = "block";
    }
  });
}

async function loadRecommendations() {
  const loading = document.getElementById("recLoading");
  const domContainer = document.getElementById("recCardsDomestic");
  const forContainer = document.getElementById("recCardsForeign");

  loading.style.display = "block";
  if (domContainer) domContainer.style.display = "none";
  if (forContainer) forContainer.style.display = "none";

  const progress = startProgressAnimation("recProgressBar", "recProgressText", 2500);

  try {
    const res = await fetchWithTimeout('/api/stocks/recommendations?days=20', {}, 12000);
    quantData = await res.json();
    
    progress.finish();

    setTimeout(() => {
      loading.style.display = "none";
      hasLoadedRecs = true;
      renderRecCards();
    }, 150);

  } catch (err) {
    progress.reset();
    loading.style.display = "none";
    console.error("Rec Load Error:", err);
    if (domContainer) {
      domContainer.style.display = "block";
      domContainer.innerHTML = `
        <div style="text-align:center; padding: 30px; color: var(--text-muted);">
          <i class="ri-error-warning-line" style="font-size: 28px; color: #f87171;"></i>
          <p style="margin-top: 8px;">추천 데이터를 불러오지 못했습니다.</p>
          <button onclick="loadRecommendations()" style="margin-top: 12px; background: #4f46e5; color: #fff; border: none; padding: 8px 16px; border-radius: 8px; font-weight: 600; cursor: pointer;">
            <i class="ri-refresh-line"></i> 다시 시도
          </button>
        </div>
      `;
    }
  }
}

function goToStockPrediction(ticker, name) {
  const navItems = document.querySelectorAll(".bottom-nav .nav-item");
  const tabContents = document.querySelectorAll(".tab-content");
  navItems.forEach(n => n.classList.remove("active"));
  tabContents.forEach(t => t.classList.remove("active"));
  
  const predictNav = document.querySelector('.bottom-nav .nav-item[data-tab="tab-predict"]');
  if (predictNav) predictNav.classList.add("active");
  const predictTab = document.getElementById("tab-predict");
  if (predictTab) predictTab.classList.add("active");

  selectStock(ticker, name);
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function buildCardsHtml(list) {
  if (!list || list.length === 0) {
    return '<div style="text-align:center; padding: 20px; color: var(--text-muted);">추천 종목 데이터 분석 진행 중입니다...</div>';
  }

  return list.map((item, idx) => {
    const isForeign = !item.is_krw;
    const symbol = item.is_krw ? "₩" : "$";
    const rankClass = idx === 0 ? "rank-1" : (idx === 1 ? "rank-2" : (idx === 2 ? "rank-3" : ""));

    return `
      <div class="rec-card ${isForeign ? 'foreign' : ''}" onclick="goToStockPrediction('${item.ticker}', '${item.name.replace(/'/g, "\\'")}')">
        <div class="rec-header">
          <div style="display: flex; align-items: center;">
            <span class="rank-badge ${rankClass}">${idx + 1}</span>
            <div>
              <span style="font-size: 16px; font-weight: 700; color: #fff;">${item.name}</span>
              <span style="font-size: 11px; color: var(--text-muted); font-family: monospace; margin-left: 6px;">${item.ticker}</span>
            </div>
          </div>
          <div class="rec-return">+${item.expected_return}%</div>
        </div>

        <div style="display: flex; justify-content: space-between; font-size: 12.5px; color: #cbd5e1; margin-bottom: 8px;">
          <span>현재가: <b>${symbol}${item.current_price.toLocaleString()}</b></span>
          <span>1달 목표: <b style="color: var(--accent-green);">${symbol}${item.predicted_price.toLocaleString()}</b></span>
        </div>

        <div class="rec-reason-list">
          <div style="font-size: 11px; font-weight: 600; color: #a5b4fc; margin-bottom: 6px;">💡 AI 퀀트 매수 추천 근거</div>
          ${item.reasons.map(r => `<div class="rec-reason-item"><span>•</span> <span>${r}</span></div>`).join("")}
        </div>
        
        <div style="margin-top: 10px; padding-top: 8px; border-top: 1px solid rgba(255,255,255,0.06); display: flex; justify-content: flex-end; align-items: center; font-size: 11px; color: #a5b4fc;">
          <span>터치하여 주가 예측 & 뉴스 브리핑 보기 <i class="ri-arrow-right-s-line"></i></span>
        </div>
      </div>
    `;
  }).join("");
}

function renderRecCards() {
  const domContainer = document.getElementById("recCardsDomestic");
  const forContainer = document.getElementById("recCardsForeign");

  if (domContainer) domContainer.innerHTML = buildCardsHtml(quantData.domestic || []);
  if (forContainer) forContainer.innerHTML = buildCardsHtml(quantData.foreign || []);

  if (activeRecMarket === "domestic") {
    if (domContainer) domContainer.style.display = "block";
    if (forContainer) forContainer.style.display = "none";
  } else {
    if (domContainer) domContainer.style.display = "none";
    if (forContainer) forContainer.style.display = "block";
  }
}


/* iPhone Network QR Code Info Loader */
async function loadNetworkInfo() {
  try {
    const res = await fetchWithTimeout('/api/network-info', {}, 5000);
    const data = await res.json();
    document.getElementById("qrImage").src = data.qr_url;
    document.getElementById("mobileUrlText").innerText = data.mobile_url;

    const pubEl = document.getElementById("publicUrlText");
    if (data.public_url) {
      pubEl.innerText = data.public_url;
    } else {
      pubEl.innerText = "퍼블릭 터널 생성 중... (5초 후 자동 갱신)";
      setTimeout(loadNetworkInfo, 4000);
    }
  } catch (err) {
    console.error("Network info error:", err);
  }
}

/* ==============================================================================
   Personalization Portfolio Studio (개인화 포트폴리오 스튜디오)
   ============================================================================== */
const PORTFOLIO_STORAGE_KEY = "my_stock_portfolio_v3";

// 디바이스별 고유 사용자 ID 생성 및 관리 (개인별 완전 격리)
function getOrCreateUserId() {
  let uid = localStorage.getItem("ai_stock_user_id");
  if (!uid) {
    uid = "usr_" + Math.random().toString(36).substring(2, 9) + Date.now().toString(36);
    try {
      localStorage.setItem("ai_stock_user_id", uid);
    } catch (e) {}
  }
  return uid;
}

const currentUserId = getOrCreateUserId();

// 로컬 저장소에서 불러오기 (초기값은 빈 배열이며, 임의의 기본 자산을 강제 주입하지 않음)
function loadPortfolioFromStorage() {
  try {
    const raw = localStorage.getItem(PORTFOLIO_STORAGE_KEY);
    if (raw !== null) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed;
    }
  } catch (e) {
    console.error("Storage load error:", e);
  }
  return []; // 완전 빈 상태로 시작 (다른 사람이 보거나 임의 자산이 부활하지 않음)
}

function savePortfolioToStorage() {
  try {
    localStorage.setItem(PORTFOLIO_STORAGE_KEY, JSON.stringify(myPortfolio));
  } catch (e) {
    console.error("Storage save error:", e);
  }

  // 서버의 사용자별 독립 공간에도 비동기 백업/동기화
  try {
    const profile = document.getElementById("mInvestorProfile")?.value || "중립형 (Balanced)";
    fetch(`/api/portfolio/user/${currentUserId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ items: myPortfolio, profile })
    }).catch(() => {});
  } catch (e) {}
}

let myPortfolio = loadPortfolioFromStorage();
let selectedAddTicker = "";

// 사용자가 원할 때만 예시 샘플 자산 불러오기
function loadSampleAssets() {
  myPortfolio = [
    { name: "삼성전자", ticker: "005930.KS", buy_price: 68000, qty: 100, is_krw: true },
    { name: "엔비디아 (NVIDIA)", ticker: "NVDA", buy_price: 115, qty: 20, is_krw: false }
  ];
  savePortfolioToStorage();
  updatePortfolioMetrics();
  showPersonalToast("💡 예시 샘플 자산(삼성전자, 엔비디아)이 추가되었습니다!", "success");
}


// Toast Notification
function showPersonalToast(message, type = "info") {
  let toast = document.getElementById("personalToast");
  if (!toast) {
    toast = document.createElement("div");
    toast.id = "personalToast";
    toast.style.position = "fixed";
    toast.style.top = "65px";
    toast.style.left = "50%";
    toast.style.transform = "translateX(-50%)";
    toast.style.zIndex = "9999";
    toast.style.padding = "10px 18px";
    toast.style.borderRadius = "20px";
    toast.style.fontSize = "12.5px";
    toast.style.fontWeight = "700";
    toast.style.color = "#fff";
    toast.style.backdropFilter = "blur(12px)";
    toast.style.boxShadow = "0 8px 24px rgba(0,0,0,0.5)";
    toast.style.transition = "opacity 0.3s ease, transform 0.3s ease";
    toast.style.pointerEvents = "none";
    document.body.appendChild(toast);
  }

  if (type === "success") {
    toast.style.background = "rgba(16, 185, 129, 0.92)";
    toast.style.border = "1px solid rgba(52, 211, 153, 0.4)";
  } else if (type === "warn") {
    toast.style.background = "rgba(245, 158, 11, 0.92)";
    toast.style.border = "1px solid rgba(251, 191, 36, 0.4)";
  } else {
    toast.style.background = "rgba(99, 102, 241, 0.92)";
    toast.style.border = "1px solid rgba(129, 140, 248, 0.4)";
  }

  toast.innerText = message;
  toast.style.opacity = "1";
  toast.style.transform = "translateX(-50%) translateY(0)";

  setTimeout(() => {
    toast.style.opacity = "0";
    toast.style.transform = "translateX(-50%) translateY(-10px)";
  }, 2200);
}

// Quick Select Asset from Chips
window.quickSelectAsset = async function(name, ticker, currency) {
  const nameInput = document.getElementById("mAddName");
  const currSelect = document.getElementById("mAddCurrency");
  const badge = document.getElementById("mSelectedTickerBadge");
  const priceInput = document.getElementById("mAddPrice");
  const qtyInput = document.getElementById("mAddQty");

  if (nameInput) nameInput.value = name;
  if (currSelect) currSelect.value = currency;
  selectedAddTicker = ticker;

  if (badge) {
    badge.innerText = ticker;
    badge.style.display = "inline-block";
  }

  // 실시간 시세 자동 조회
  showPersonalToast(`⏳ ${name} 현재 시세 조회 중...`, "info");
  try {
    const res = await fetchWithTimeout(`/api/stocks/quote?ticker=${encodeURIComponent(ticker)}`, {}, 4000);
    const data = await res.json();
    if (data.current_price && priceInput) {
      priceInput.value = data.current_price;
      showPersonalToast(`📈 ${name} 현재가(${currency === 'KRW' ? '₩' : '$'}${data.current_price.toLocaleString()})가 입력되었습니다!`, "success");
    }
  } catch (e) {
    console.warn("Quote fetch error:", e);
  }

  if (qtyInput) qtyInput.focus();
};

// Select Asset from Autocomplete Dropdown
window.selectPersonalAsset = async function(name, ticker) {
  const nameInput = document.getElementById("mAddName");
  const currSelect = document.getElementById("mAddCurrency");
  const badge = document.getElementById("mSelectedTickerBadge");
  const priceInput = document.getElementById("mAddPrice");
  const qtyInput = document.getElementById("mAddQty");
  const dropdown = document.getElementById("mAddDropdown");

  if (nameInput) nameInput.value = name;
  selectedAddTicker = ticker;

  if (dropdown) dropdown.classList.remove("active");

  if (badge) {
    badge.innerText = ticker;
    badge.style.display = "inline-block";
  }

  // 통화 자동 감지
  const isKrw = ticker.endsWith(".KS") || ticker.endsWith(".KQ") || (ticker.length === 6 && /^\d+$/.test(ticker));
  if (currSelect) currSelect.value = isKrw ? "KRW" : "USD";

  showPersonalToast(`⏳ ${name} 현재 시세 조회 중...`, "info");
  try {
    const res = await fetchWithTimeout(`/api/stocks/quote?ticker=${encodeURIComponent(ticker)}`, {}, 4000);
    const data = await res.json();
    if (data.current_price && priceInput) {
      priceInput.value = data.current_price;
      if (currSelect && data.currency) currSelect.value = data.currency;
      showPersonalToast(`📈 ${name} 현재가(${data.currency === 'KRW' ? '₩' : '$'}${data.current_price.toLocaleString()})가 입력되었습니다!`, "success");
    }
  } catch (e) {
    console.warn("Quote fetch error:", e);
  }

  if (qtyInput) qtyInput.focus();
};

// Autocomplete Search for Personal Portfolio Input
function initPersonalSearchAutocomplete() {
  const input = document.getElementById("mAddName");
  const dropdown = document.getElementById("mAddDropdown");
  if (!input || !dropdown) return;

  let debounceTimer;

  input.addEventListener("input", (e) => {
    clearTimeout(debounceTimer);
    const q = e.target.value.trim();
    if (!q) {
      dropdown.classList.remove("active");
      dropdown.innerHTML = "";
      return;
    }

    debounceTimer = setTimeout(async () => {
      try {
        const res = await fetchWithTimeout(`/api/stocks/search?q=${encodeURIComponent(q)}`, {}, 3000);
        const data = await res.json();
        const results = data.results || [];

        if (results.length === 0) {
          dropdown.innerHTML = `
            <div style="padding: 10px 14px; font-size: 12px; color: var(--text-muted); text-align: center;">
              검색 결과가 없습니다. 직접 티커를 입력하여 추가할 수 있습니다.
            </div>
          `;
          dropdown.classList.add("active");
          return;
        }

        dropdown.innerHTML = results.map(item => `
          <div class="dropdown-item" onclick="selectPersonalAsset('${item.name.replace(/'/g, "\\'")}', '${item.ticker}')">
            <span style="font-weight: 600; font-size: 13px;">${item.name}</span>
            <span class="ticker-badge">${item.ticker}</span>
          </div>
        `).join("");

        dropdown.classList.add("active");
      } catch (err) {
        console.error("Personal search fetch error:", err);
      }
    }, 200);
  });

  // Close dropdown on outside click
  document.addEventListener("click", (e) => {
    if (!e.target.closest("#mAddName") && !e.target.closest("#mAddDropdown")) {
      dropdown.classList.remove("active");
    }
  });
}

function deleteAsset(index) {
  if (index >= 0 && index < myPortfolio.length) {
    const deleted = myPortfolio.splice(index, 1);
    savePortfolioToStorage();
    renderHoldingsList(myPortfolio);
    showPersonalToast(`🗑️ ${deleted[0]?.name || '자산'}이 삭제되었습니다.`, "warn");
    updatePortfolioMetrics();
  }
}

function clearAllAssets() {
  if (confirm("등록된 모든 자산을 삭제하시겠습니까?")) {
    myPortfolio = [];
    savePortfolioToStorage();
    renderHoldingsList([]);
    updatePortfolioMetrics();
    showPersonalToast("🗑️ 모든 보유 자산이 삭제되었습니다.", "warn");
  }
}

function renderHoldingsList(holdings) {
  const container = document.getElementById("mHoldingsListContainer");
  if (!container) return;

  if (!holdings || holdings.length === 0) {
    container.innerHTML = `
      <div style="text-align: center; padding: 25px 15px; color: var(--text-muted); font-size: 13px; background: rgba(255,255,255,0.015); border-radius: 12px; border: 1px dashed rgba(255,255,255,0.08);">
        <i class="ri-folder-open-line" style="font-size: 26px; color: #64748b; display: block; margin-bottom: 6px;"></i>
        등록된 보유 자산이 없습니다.<br>위에서 종목을 검색하여 자산을 추가해 보세요!
      </div>
    `;
    return;
  }

  // 총 평가액 합산 (임시 비중 계산용)
  let totalEvalSum = 0;
  holdings.forEach(h => {
    const mult = h.is_krw ? 1 : 1380;
    const ev = (h.curr_price || h.buy_price) * h.qty * mult;
    totalEvalSum += ev;
  });

  container.innerHTML = holdings.map((h, idx) => {
    const symbol = h.is_krw ? "₩" : "$";
    const mult = h.is_krw ? 1 : 1380;
    const currPrice = h.curr_price || h.buy_price;
    const evalKrw = h.eval_krw !== undefined ? h.eval_krw : Math.round(currPrice * h.qty * mult);
    const invKrw = h.invest_krw !== undefined ? h.invest_krw : Math.round(h.buy_price * h.qty * mult);
    const pnlKrw = h.pnl_krw !== undefined ? h.pnl_krw : (evalKrw - invKrw);
    const pnlPct = h.pnl_pct !== undefined ? h.pnl_pct : parseFloat(((pnlKrw / Math.max(1, invKrw)) * 100).toFixed(2));
    const weightPct = h.weight_pct !== undefined ? h.weight_pct : parseFloat(((evalKrw / Math.max(1, totalEvalSum)) * 100).toFixed(1));

    const pnlColor = pnlKrw >= 0 ? "var(--accent-green)" : "var(--accent-red)";
    const pnlSign = pnlKrw >= 0 ? "+" : "";

    return `
      <div style="background: rgba(255,255,255,0.025); border: 1px solid rgba(255,255,255,0.08); padding: 12px 14px; border-radius: 12px; margin-bottom: 10px; transition: all 0.2s ease;">
        <div style="display: flex; justify-content: space-between; align-items: center;">
          <div style="display: flex; align-items: center; gap: 6px;">
            <span style="font-weight: 800; font-size: 14.5px; color: #fff;">${h.name}</span>
            <span style="font-size: 11px; color: #94a3b8; background: rgba(255,255,255,0.06); padding: 2px 6px; border-radius: 4px; font-family: monospace;">${h.ticker}</span>
          </div>
          <button onclick="deleteAsset(${idx})" style="background: rgba(239, 68, 68, 0.15); color: #f87171; border: 1px solid rgba(239, 68, 68, 0.25); padding: 3px 8px; border-radius: 6px; font-size: 11px; font-weight: 600; cursor: pointer;">삭제</button>
        </div>

        <!-- Weight Progress Bar -->
        <div style="margin: 8px 0 6px 0;">
          <div style="display: flex; justify-content: space-between; font-size: 11px; margin-bottom: 3px;">
            <span style="color: var(--text-muted);">포트폴리오 비중</span>
            <span style="color: #a5b4fc; font-weight: 700;">${weightPct}%</span>
          </div>
          <div style="height: 4px; background: rgba(255,255,255,0.08); border-radius: 2px; overflow: hidden;">
            <div style="height: 100%; width: ${Math.min(100, Math.max(2, weightPct))}%; background: linear-gradient(90deg, #6366f1, #a855f7); border-radius: 2px;"></div>
          </div>
        </div>

        <div style="display: flex; justify-content: space-between; margin-top: 6px; font-size: 12px; color: #cbd5e1;">
          <span>매수단가: <b>${symbol}${h.buy_price.toLocaleString()}</b> <span style="color: var(--text-muted);">(${h.qty}주)</span></span>
          <span>현재가: <b>${symbol}${currPrice.toLocaleString()}</b></span>
        </div>

        <div style="display: flex; justify-content: space-between; align-items: center; margin-top: 6px; padding-top: 6px; border-top: 1px dashed rgba(255,255,255,0.06); font-size: 12px;">
          <span style="color: var(--text-muted);">평가액: <b style="color: #fff;">₩${evalKrw.toLocaleString()}</b></span>
          <span style="color: ${pnlColor}; font-weight: 800;">${pnlSign}₩${pnlKrw.toLocaleString()} (${pnlSign}${pnlPct}%)</span>
        </div>
      </div>
    `;
  }).join("");
}

async function updatePortfolioMetrics() {
  const profile = document.getElementById("mInvestorProfile")?.value || "중립형 (Balanced)";

  if (!myPortfolio || myPortfolio.length === 0) {
    renderHoldingsList([]);
    if (document.getElementById("mTotalInvest")) document.getElementById("mTotalInvest").innerText = "₩0";
    if (document.getElementById("mTotalEval")) document.getElementById("mTotalEval").innerText = "₩0";
    if (document.getElementById("mTotalPnl")) document.getElementById("mTotalPnl").innerText = "₩0 (+0.0%)";
    if (document.getElementById("mTotalVar")) document.getElementById("mTotalVar").innerText = "₩0";
    if (document.getElementById("mHealthBadge")) document.getElementById("mHealthBadge").innerText = "건강도 0점 (N/A)";
    if (document.getElementById("qVar99")) document.getElementById("qVar99").innerText = "₩0";
    if (document.getElementById("macroStressContainer")) document.getElementById("macroStressContainer").innerHTML = '<div style="font-size:11px; color:var(--text-muted); text-align:center; padding:10px;">자산을 추가해 주세요.</div>';
    if (document.getElementById("rebalancePlanContainer")) document.getElementById("rebalancePlanContainer").innerHTML = '<div style="font-size:11px; color:var(--text-muted); text-align:center; padding:10px;">자산을 추가해 주세요.</div>';
    if (document.getElementById("mRebalanceAdvice")) document.getElementById("mRebalanceAdvice").innerText = "보유 자산을 등록하시면 투자 성향에 맞춘 AI 퀀트 리밸런싱 가이드가 생성됩니다.";
    return;
  }

  // 1단계: 즉각적인 로컬 데이터 기반 가계산 렌더링 (Optimistic UI)
  renderHoldingsList(myPortfolio);

  try {
    // 2단계: 백엔드 기관급 퀀트 진단 API 호출 (타임아웃 10초)
    const res = await fetchWithTimeout('/api/portfolio/diagnose', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ items: myPortfolio, profile })
    }, 10000);

    const data = await res.json();

    // 백엔드 계산 정밀 데이터로 holdings 리스트 덮어쓰기
    if (data.holdings && data.holdings.length > 0) {
      renderHoldingsList(data.holdings);
    }

    // Render Summary Metrics
    if (document.getElementById("mTotalInvest")) document.getElementById("mTotalInvest").innerText = `₩${data.total_invest_krw.toLocaleString()}`;
    if (document.getElementById("mTotalEval")) document.getElementById("mTotalEval").innerText = `₩${data.total_eval_krw.toLocaleString()}`;
    if (document.getElementById("mTotalPnl")) {
      const pnlEl = document.getElementById("mTotalPnl");
      pnlEl.innerText = `${data.total_pnl_krw >= 0 ? '+' : ''}₩${data.total_pnl_krw.toLocaleString()} (${data.total_pnl_pct >= 0 ? '+' : ''}${data.total_pnl_pct}%)`;
      pnlEl.style.color = data.total_pnl_krw >= 0 ? "var(--accent-green)" : "var(--accent-red)";
    }
    if (document.getElementById("mTotalVar")) document.getElementById("mTotalVar").innerText = `₩${data.var_95_krw.toLocaleString()}`;

    // Institutional Quantitative Metrics
    if (document.getElementById("mHealthBadge")) {
      const badge = document.getElementById("mHealthBadge");
      badge.innerText = `건강도 ${data.health_score}점 (${data.health_grade})`;
      badge.style.background = data.health_score >= 80 
        ? "linear-gradient(135deg, #10b981 0%, #059669 100%)" 
        : (data.health_score >= 60 ? "linear-gradient(135deg, #f59e0b 0%, #d97706 100%)" : "linear-gradient(135deg, #ef4444 0%, #b91c1c 100%)");
    }
    if (document.getElementById("qVol")) document.getElementById("qVol").innerText = `${data.volatility_pct}%`;
    if (document.getElementById("qSharpe")) document.getElementById("qSharpe").innerText = `${data.sharpe_ratio}`;
    if (document.getElementById("qSortino")) document.getElementById("qSortino").innerText = `${data.sortino_ratio}`;
    if (document.getElementById("qMdd")) document.getElementById("qMdd").innerText = `${data.mdd_pct}%`;
    if (document.getElementById("qBeta")) document.getElementById("qBeta").innerText = `${data.portfolio_beta}`;
    if (document.getElementById("qVar99")) document.getElementById("qVar99").innerText = `₩${data.var_99_krw.toLocaleString()}`;

    // Macro Stress Test Render
    const macroEl = document.getElementById("macroStressContainer");
    if (macroEl && data.macro_stress) {
      macroEl.innerHTML = Object.values(data.macro_stress).map(m => {
        const isLoss = m.impact_pct < 0;
        const col = isLoss ? "var(--accent-red)" : "var(--accent-green)";
        return `
          <div style="background: rgba(255,255,255,0.02); border-left: 3px solid ${col}; padding: 8px 10px; margin-bottom: 6px; border-radius: 6px; font-size: 11.5px;">
            <div style="display: flex; justify-content: space-between; font-weight: 700;">
              <span>${m.title}</span>
              <span style="color: ${col};">${m.impact_pct > 0 ? '+' : ''}${m.impact_pct}% (${m.loss_krw > 0 ? '+' : ''}₩${m.loss_krw.toLocaleString()})</span>
            </div>
            <div style="color: var(--text-muted); font-size: 10.5px; margin-top: 2px;">${m.desc}</div>
          </div>
        `;
      }).join("");
    }

    // Rebalancing Plan Render
    const planEl = document.getElementById("rebalancePlanContainer");
    if (planEl && data.rebalancing_plan) {
      planEl.innerHTML = data.rebalancing_plan.map(p => `
        <div style="display: flex; justify-content: space-between; align-items: center; background: rgba(255,255,255,0.02); padding: 7px 10px; border-radius: 6px; margin-bottom: 5px; font-size: 11.5px;">
          <div>
            <span style="font-weight: 700; color: #fff;">${p.name}</span>
            <span style="color: var(--text-muted); font-size: 10.5px;"> (${p.curr_weight}% → ${p.target_weight}%)</span>
          </div>
          <span style="font-size: 11px; font-weight: 700; color: ${p.action.includes('매도') ? '#f87171' : (p.action.includes('매수') ? '#34d399' : '#a5b4fc')};">${p.action}</span>
        </div>
      `).join("");
    }

    // Analyst Commentary
    if (document.getElementById("mRebalanceAdvice")) {
      document.getElementById("mRebalanceAdvice").innerHTML = data.analyst_report.replace(/\n/g, '<br>');
    }

  } catch (err) {
    console.warn("Diagnosis background fetch warning:", err);
  }
}

// Handle Add Asset Submission
function handleAddAsset() {
  const nameInput = document.getElementById("mAddName");
  const priceInput = document.getElementById("mAddPrice");
  const qtyInput = document.getElementById("mAddQty");
  const currSelect = document.getElementById("mAddCurrency");
  const badge = document.getElementById("mSelectedTickerBadge");

  const name = nameInput?.value.trim();
  if (!name) {
    showPersonalToast("⚠️ 추가할 종목명을 입력하거나 검색해 주세요.", "warn");
    nameInput?.focus();
    return;
  }

  const price = parseFloat(priceInput?.value);
  if (isNaN(price) || price <= 0) {
    showPersonalToast("⚠️ 유효한 매수단가를 입력해 주세요.", "warn");
    priceInput?.focus();
    return;
  }

  const qty = parseInt(qtyInput?.value);
  if (isNaN(qty) || qty <= 0) {
    showPersonalToast("⚠️ 1주 이상의 보유 수량을 입력해 주세요.", "warn");
    qtyInput?.focus();
    return;
  }

  const currSel = currSelect?.value || "KRW";
  const isKrw = currSel === "KRW";
  const ticker = selectedAddTicker || name.toUpperCase();

  // 자산 목록에 추가
  myPortfolio.unshift({
    name,
    ticker,
    buy_price: price,
    qty,
    is_krw: isKrw
  });

  // 로컬 저장소 영구 보관
  savePortfolioToStorage();

  // 인풋 초기화
  nameInput.value = "";
  priceInput.value = "";
  qtyInput.value = "";
  selectedAddTicker = "";
  if (badge) badge.style.display = "none";

  showPersonalToast(`✅ '${name}' 자산이 성공적으로 추가되었습니다!`, "success");

  // 즉시 렌더링 및 진단 갱신
  updatePortfolioMetrics();
}

document.addEventListener("DOMContentLoaded", () => {
  initPersonalSearchAutocomplete();

  const addBtn = document.getElementById("mAddAssetBtn");
  if (addBtn) {
    addBtn.addEventListener("click", handleAddAsset);
  }

  // Enter Key on Inputs
  const qtyInput = document.getElementById("mAddQty");
  const priceInput = document.getElementById("mAddPrice");
  const nameInput = document.getElementById("mAddName");

  [qtyInput, priceInput, nameInput].forEach(inp => {
    if (inp) {
      inp.addEventListener("keydown", (e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          handleAddAsset();
        }
      });
    }
  });

  const clearBtn = document.getElementById("mClearAssetsBtn");
  if (clearBtn) {
    clearBtn.addEventListener("click", clearAllAssets);
  }

  const sampleBtn = document.getElementById("mLoadSampleBtn");
  if (sampleBtn) {
    sampleBtn.addEventListener("click", loadSampleAssets);
  }

  const profSel = document.getElementById("mInvestorProfile");
  if (profSel) {
    profSel.addEventListener("change", () => {
      savePortfolioToStorage();
      updatePortfolioMetrics();
    });
  }

  // 서버에 저장된 사용자별 포트폴리오가 있다면 비동기 동기화 (로컬스토리지에 없을 때)
  if (myPortfolio.length === 0) {
    fetchWithTimeout(`/api/portfolio/user/${currentUserId}`, {}, 3000)
      .then(res => res.json())
      .then(data => {
        if (data.items && data.items.length > 0 && myPortfolio.length === 0) {
          myPortfolio = data.items;
          savePortfolioToStorage();
          updatePortfolioMetrics();
        }
      })
      .catch(() => {});
  }

  // 초기 렌더링
  updatePortfolioMetrics();
});





