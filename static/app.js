let currentTicker = "005930.KS";
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
  document.getElementById("searchInput").value = name;
  document.getElementById("searchResultsDropdown").classList.remove("active");
  loadPrediction(currentTicker, currentPeriod);
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

function buildCardsHtml(list) {
  if (!list || list.length === 0) {
    return '<div style="text-align:center; padding: 20px; color: var(--text-muted);">추천 종목 데이터 분석 진행 중입니다...</div>';
  }

  return list.map((item, idx) => {
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

/* Personalization Portfolio Studio */
let myPortfolio = [
  { name: "삼성전자", ticker: "005930.KS", buy_price: 68000, qty: 100, is_krw: true },
  { name: "엔비디아", ticker: "NVDA", buy_price: 115, qty: 20, is_krw: false }
];

function deleteAsset(index) {
  if (index >= 0 && index < myPortfolio.length) {
    myPortfolio.splice(index, 1);
    updatePortfolioMetrics();
  }
}

function clearAllAssets() {
  if (confirm("등록된 모든 자산을 삭제하시겠습니까?")) {
    myPortfolio = [];
    updatePortfolioMetrics();
  }
}

function renderHoldingsList(holdings) {
  const container = document.getElementById("mHoldingsListContainer");
  if (!container) return;

  if (!holdings || holdings.length === 0) {
    container.innerHTML = `
      <div style="text-align: center; padding: 20px; color: var(--text-muted); font-size: 13px;">
        등록된 자산이 없습니다. 위에서 보유 종목을 추가해 주세요.
      </div>
    `;
    return;
  }

  container.innerHTML = holdings.map((h, idx) => {
    const symbol = h.is_krw ? "₩" : "$";
    const pnlColor = h.pnl_krw >= 0 ? "var(--accent-green)" : "var(--accent-red)";
    const pnlSign = h.pnl_krw >= 0 ? "+" : "";

    return `
      <div style="background: rgba(255,255,255,0.025); border: 1px solid rgba(255,255,255,0.06); padding: 10px 12px; border-radius: 10px; margin-bottom: 8px;">
        <div style="display: flex; justify-content: space-between; align-items: center;">
          <div>
            <span style="font-weight: 700; font-size: 14px; color: #fff;">${h.name}</span>
            <span style="font-size: 11px; color: var(--text-muted); margin-left: 6px; font-family: monospace;">${h.ticker}</span>
          </div>
          <button onclick="deleteAsset(${idx})" style="background: rgba(239, 68, 68, 0.15); color: #f87171; border: none; padding: 3px 8px; border-radius: 6px; font-size: 11px; cursor: pointer;">❌ 삭제</button>
        </div>
        <div style="display: flex; justify-content: space-between; margin-top: 6px; font-size: 12px; color: #cbd5e1;">
          <span>매수단가: ${symbol}${h.buy_price.toLocaleString()} (${h.qty}주)</span>
          <span style="color: #a5b4fc; font-weight: 600;">비중 ${h.weight_pct}%</span>
        </div>
        <div style="display: flex; justify-content: space-between; margin-top: 4px; font-size: 12px;">
          <span style="color: var(--text-muted);">평가금액: ₩${h.eval_krw.toLocaleString()}</span>
          <span style="color: ${pnlColor}; font-weight: 700;">${pnlSign}₩${h.pnl_krw.toLocaleString()} (${pnlSign}${h.pnl_pct}%)</span>
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
    if (document.getElementById("macroStressContainer")) document.getElementById("macroStressContainer").innerHTML = '<div style="font-size:11px; color:var(--text-muted);">자산을 추가해 주세요.</div>';
    if (document.getElementById("rebalancePlanContainer")) document.getElementById("rebalancePlanContainer").innerHTML = '<div style="font-size:11px; color:var(--text-muted);">자산을 추가해 주세요.</div>';
    if (document.getElementById("mRebalanceAdvice")) document.getElementById("mRebalanceAdvice").innerText = "보유 자산을 등록하시면 투자 성향에 맞춘 AI 퀀트 리밸런싱 가이드가 생성됩니다.";
    return;
  }

  try {
    const res = await fetchWithTimeout('/api/portfolio/diagnose', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ items: myPortfolio, profile })
    }, 5000);

    const data = await res.json();

    // Render Holdings List directly from Backend Calculated Data (100% Synchronized)
    renderHoldingsList(data.holdings);

    // Render Metrics
    if (document.getElementById("mTotalInvest")) document.getElementById("mTotalInvest").innerText = `₩${data.total_invest_krw.toLocaleString()}`;
    if (document.getElementById("mTotalEval")) document.getElementById("mTotalEval").innerText = `₩${data.total_eval_krw.toLocaleString()}`;
    if (document.getElementById("mTotalPnl")) {
      const pnlEl = document.getElementById("mTotalPnl");
      pnlEl.innerText = `${data.total_pnl_krw >= 0 ? '+' : ''}₩${data.total_pnl_krw.toLocaleString()} (${data.total_pnl_pct >= 0 ? '+' : ''}${data.total_pnl_pct}%)`;
      pnlEl.style.color = data.total_pnl_krw >= 0 ? "var(--accent-green)" : "var(--accent-red)";
    }
    if (document.getElementById("mTotalVar")) document.getElementById("mTotalVar").innerText = `₩${data.var_95_krw.toLocaleString()}`;

    // Institutional Quantitative Metrics
    if (document.getElementById("mHealthBadge")) document.getElementById("mHealthBadge").innerText = `건강도 ${data.health_score}점 (${data.health_grade})`;
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
        <div style="display: flex; justify-content: space-between; align-items: center; background: rgba(255,255,255,0.02); padding: 6px 10px; border-radius: 6px; margin-bottom: 4px; font-size: 11.5px;">
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
    console.error("Diagnosis error:", err);
  }
}

document.addEventListener("DOMContentLoaded", () => {
  const addBtn = document.getElementById("mAddAssetBtn");
  if (addBtn) {
    addBtn.addEventListener("click", () => {
      const name = document.getElementById("mAddName").value.trim() || "신규자산";
      const currSel = document.getElementById("mAddCurrency")?.value || "KRW";
      const price = parseFloat(document.getElementById("mAddPrice").value) || 50000;
      const qty = parseInt(document.getElementById("mAddQty").value) || 10;
      const isKrw = currSel === "KRW";
      
      myPortfolio.push({ name, ticker: name.toUpperCase(), buy_price: price, qty, is_krw: isKrw });
      
      document.getElementById("mAddName").value = "";
      document.getElementById("mAddPrice").value = "";
      document.getElementById("mAddQty").value = "";

      updatePortfolioMetrics();
    });
  }

  const clearBtn = document.getElementById("mClearAssetsBtn");
  if (clearBtn) {
    clearBtn.addEventListener("click", clearAllAssets);
  }

  const profSel = document.getElementById("mInvestorProfile");
  if (profSel) {
    profSel.addEventListener("change", updatePortfolioMetrics);
  }

  updatePortfolioMetrics();
});



