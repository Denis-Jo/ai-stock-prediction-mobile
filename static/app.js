let currentTicker = "005930.KS";
let currentPeriod = "1m";
let fanChartInstance = null;
let quantData = { domestic: [], foreign: [] };
let activeRecMarket = "domestic";

document.addEventListener("DOMContentLoaded", () => {
  initTabNavigation();
  initPeriodPills();
  initSearchAutocomplete();
  initRecSubTabs();
  
  // Initial Loads
  loadPrediction(currentTicker, currentPeriod);
  loadNetworkInfo();
  loadRecommendations();
});

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
        const res = await fetch(`/api/stocks/search?q=${encodeURIComponent(q)}`);
        const data = await res.json();
        renderDropdown(data.results);
      } catch (err) {
        console.error("Search fetch error:", err);
      }
    }, 250);
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
  document.getElementById("searchInput").value = name;
  document.getElementById("searchResultsDropdown").classList.remove("active");
  loadPrediction(currentTicker, currentPeriod);
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

  try {
    const res = await fetch(`/api/stocks/predict?ticker=${encodeURIComponent(ticker)}&period=${period}`);
    const data = await res.json();

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

  } catch (err) {
    loading.style.display = "none";
    console.error("Prediction Load Error:", err);
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

/* Recommendations Sub-Tabs & Data Loader */
function initRecSubTabs() {
  const domBtn = document.getElementById("recTabDomestic");
  const forBtn = document.getElementById("recTabForeign");

  domBtn.addEventListener("click", () => {
    domBtn.classList.add("active");
    forBtn.classList.remove("active");
    activeRecMarket = "domestic";
    renderRecCards();
  });

  forBtn.addEventListener("click", () => {
    forBtn.classList.add("active");
    domBtn.classList.remove("active");
    activeRecMarket = "foreign";
    renderRecCards();
  });
}

async function loadRecommendations() {
  const loading = document.getElementById("recLoading");
  loading.style.display = "block";
  try {
    const res = await fetch('/api/stocks/recommendations?days=20');
    quantData = await res.json();
    loading.style.display = "none";
    renderRecCards();
  } catch (err) {
    loading.style.display = "none";
    console.error("Rec Load Error:", err);
  }
}

function renderRecCards() {
  const container = document.getElementById("recCardsContainer");
  const list = quantData[activeRecMarket] || [];

  if (list.length === 0) {
    container.innerHTML = '<div style="text-align:center; padding: 20px; color: var(--text-muted);">추천 종목 데이터 분석 진행 중입니다...</div>';
    return;
  }

  container.innerHTML = list.map((item, idx) => {
    const isForeign = !item.is_krw;
    const symbol = item.is_krw ? "₩" : "$";
    const rankClass = idx === 0 ? "rank-1" : (idx === 1 ? "rank-2" : (idx === 2 ? "rank-3" : ""));

    return `
      <div class="rec-card ${isForeign ? 'foreign' : ''}">
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
      </div>
    `;
  }).join("");
}

/* iPhone Network QR Code Info Loader */
async function loadNetworkInfo() {
  try {
    const res = await fetch('/api/network-info');
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

