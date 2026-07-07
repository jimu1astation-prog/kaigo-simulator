import { useState, useMemo } from "react";
import {
  ComposedChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ReferenceLine, ResponsiveContainer
} from "recharts";

const START_YEAR = 2025;
const END_YEAR   = 2040;
const CONFIRMED_CAP_UNTIL = 2028;
const CONFIRMED_CAP = 126900;
const REVIEW_YEARS = [2029, 2034, 2039];

function buildPeriods(startYear, endYear) {
  const periods = [];
  for (let year = startYear; year <= endYear; year++) {
    // 開始年の6月末は信頼できる実測値が無いため対象外（12月末データから開始）
    if (year !== startYear) {
      periods.push({ year, half: 1, label: `${year}年6月末`, key: `${year}-1` });
    }
    periods.push({ year, half: 2, label: `${year}年12月末`, key: `${year}-2` });
  }
  return periods;
}
const PERIODS = buildPeriods(START_YEAR, END_YEAR);

const EXPERT_FORECAST = [
  { period: "2025年12月末", vacancy: 59029, residents: 67871 },
  { period: "2026年3月末",  vacancy: 52155, residents: 74745, actual: true },
  { period: "2026年6月末",  vacancy: 46074, residents: 80826 },
  { period: "2026年12月末", vacancy: 33119, residents: 93781 },
  { period: "2027年6月末",  vacancy: 20164, residents: 106736 },
  { period: "2027年12月末", vacancy: 7209,  residents: 119691 },
  { period: "2028年3月",    vacancy: 0,     residents: 126900, danger: true },
];

// 2025年12月末は出入国在留管理庁の実測値をそのまま採用する（3シナリオ共通・固定値）。
// 2026年3月末の実測値74,745人（=DEFAULTS.currentResidents）は半年グリッドに乗らないため、
// 2025年12月末の処理直後にこの値へスナップし、2026年6月末以降は自社の流入出モデルで独自に試算する。
// 専門家推計（EXPERT_FORECAST）はあくまで参考ラインであり、この試算には使用しない。
const HISTORICAL_RESIDENTS = {
  "2025-2": 67871,
};

const SCENARIOS = {
  hippaku:  { label: "逼迫", sublabel: "上限に早く達する", color: "#f87171", inMult: 1.25, outMult: 0.8,  icon: "⚠" },
  standard: { label: "標準", sublabel: "現状トレンド継続",  color: "#60a5fa", inMult: 1.0,  outMult: 1.0,  icon: "●" },
  yoyu:     { label: "余裕", sublabel: "空き枠が長く続く",  color: "#4ade80", inMult: 0.75, outMult: 1.25, icon: "✓" },
};

const DEFAULTS = {
  currentResidents:      74745,
  traineeKaigoResidents: 18400,
  traineeConvRate:       70,
  directEntryBase:       18000,
  directEntryGrowth:     8,
  repatriateRate:        10,
  kaishouRate:           3,
  ikuseiroTransferStart: 2030,
  ikuseiroInitial:       3000,
  ikuseiroGrowth:        20,
  cap2029: 126900,
  cap2034: 126900,
  cap2039: 126900,
  aCompanies: 52,
  aWorkers:   200,
  monthlyFee: 30000,
};

function getCap(year, p) {
  if (year <= CONFIRMED_CAP_UNTIL) return CONFIRMED_CAP;
  if (year <= 2033) return p.cap2029;
  if (year <= 2038) return p.cap2034;
  return p.cap2039;
}

function simulate(p, scenarioKey) {
  const sc = SCENARIOS[scenarioKey];
  const rows = [];
  let residents         = p.currentResidents;
  let directEntryAnnual = p.directEntryBase;

  PERIODS.forEach(({ year, half, label, key }) => {
    const cap          = getCap(year, p);
    const confirmed    = year <= CONFIRMED_CAP_UNTIL;
    const histValue     = HISTORICAL_RESIDENTS[key];
    const isHistorical  = histValue != null;

    let traineeConv = null, direct = null, ikuseiroConv = null, totalInflow = null;
    let repatriate  = null, kaishou = null, totalOutflow = null;
    let newResidents;

    if (isHistorical) {
      // 実測値をそのまま採用（シナリオ間で差は出さない）
      newResidents = histValue;
    } else {
      const traineeAnnualGrad = Math.round(p.traineeKaigoResidents / 3);
      const traineeConvAnnual = Math.round(traineeAnnualGrad * (p.traineeConvRate / 100) * sc.inMult);
      traineeConv = Math.round(traineeConvAnnual / 2);

      direct = Math.round((directEntryAnnual * sc.inMult) / 2);

      ikuseiroConv = 0;
      if (year >= p.ikuseiroTransferStart) {
        const yt = year - p.ikuseiroTransferStart;
        const ikuseiroAnnual = Math.round(p.ikuseiroInitial * Math.pow(1 + p.ikuseiroGrowth / 100, yt) * sc.inMult);
        ikuseiroConv = Math.round(ikuseiroAnnual / 2);
      }

      totalInflow  = traineeConv + direct + ikuseiroConv;
      repatriate   = Math.round(residents * (p.repatriateRate / 100 / 2) * sc.outMult);
      kaishou      = Math.round(residents * (p.kaishouRate    / 100 / 2) * sc.outMult);
      totalOutflow = repatriate + kaishou;

      newResidents = Math.min(Math.max(0, residents + totalInflow - totalOutflow), cap);
    }

    const vacancy  = Math.max(0, cap - newResidents);
    const fillRate = Math.round((newResidents / cap) * 100);
    const chance   = fillRate >= 95 ? "danger" : fillRate >= 80 ? "caution" : fillRate >= 60 ? "normal" : "good";

    rows.push({
      year, half, label, key,
      cap, confirmed, residents: Math.round(newResidents),
      vacancy, fillRate, chance, historical: isHistorical,
      traineeConv, direct, ikuseiroConv, totalInflow,
      repatriate, kaishou, totalOutflow,
    });

    residents = newResidents;
    if (key === "2025-2") {
      // 2026年3月末の実測値（74,745人）は半年グリッドに乗らないため、ここでスナップして
      // 2026年6月末以降は自社モデルの流入出仮定で独自に試算する（専門家推計はコピーしない）
      residents = p.currentResidents;
    }
    if (half === 2) {
      directEntryAnnual *= (1 + p.directEntryGrowth / 100);
    }
  });

  return rows;
}

const fmt  = n => n == null ? "-" : Math.round(n).toLocaleString("ja-JP");
const fmtK = n => {
  if (n == null) return "-";
  return n >= 10000 ? `${(n / 10000).toFixed(1)}万` : n.toLocaleString("ja-JP");
};

const CHANCE_META = {
  danger:  { color: "#f87171", bg: "rgba(248,113,113,0.08)", label: "⚠ 逼迫",    sub: "新規受入ほぼ不可" },
  caution: { color: "#fbbf24", bg: "rgba(251,191,36,0.08)",  label: "△ 注意",    sub: "残り枠わずか" },
  normal:  { color: "#60a5fa", bg: "rgba(96,165,250,0.08)",  label: "○ 標準",    sub: "営業継続を推奨" },
  good:    { color: "#4ade80", bg: "rgba(74,222,128,0.08)",  label: "◎ チャンス", sub: "積極営業タイミング" },
};

function TT({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  const parts = String(label).split("-");
  const niceLabel = parts[1] === "2" ? `${parts[0]}年12月末` : `${parts[0]}年6月末`;
  return (
    <div style={{ background:"#0f172a", border:"1px solid #1e3a5f", borderRadius:8, padding:"10px 14px", fontSize:11, color:"#e2e8f0", minWidth:190 }}>
      <div style={{ fontWeight:700, marginBottom:6, color:"#7dd3fc" }}>{niceLabel}</div>
      {payload.filter(p => p.value != null).map(p => (
        <div key={p.name} style={{ display:"flex", justifyContent:"space-between", gap:16, marginBottom:3 }}>
          <span style={{ color: p.stroke || p.color }}>{p.name}</span>
          <span style={{ fontWeight:600 }}>{fmt(p.value)}人</span>
        </div>
      ))}
    </div>
  );
}

function SliderRow({ label, value, min, max, step, unit, hint, onChange, highlight }) {
  return (
    <div style={{ marginBottom:16 }}>
      <div style={{ display:"flex", justifyContent:"space-between", marginBottom:4 }}>
        <span style={{ fontSize:12, color: highlight ? "#fbbf24" : "#94a3b8", letterSpacing:"0.01em" }}>{label}</span>
        <span style={{ fontSize:13, fontWeight:700, color: highlight ? "#fbbf24" : "#e2e8f0", fontVariantNumeric:"tabular-nums" }}>
          {value.toLocaleString()}{unit}
        </span>
      </div>
      <input type="range" min={min} max={max} step={step} value={value}
        onChange={e => onChange(Number(e.target.value))}
        style={{ width:"100%", accentColor: highlight ? "#fbbf24" : "#3b82f6", cursor:"pointer" }} />
      {hint && <div style={{ fontSize:10, color:"#475569", marginTop:3, letterSpacing:"0.01em" }}>{hint}</div>}
    </div>
  );
}

export default function App() {
  const [p, setP]               = useState(DEFAULTS);
  const [activeS, setActiveS]   = useState(["hippaku","standard","yoyu"]);
  const [showExpert, setShowExpert] = useState(true);
  const [openSection, setOpenSection] = useState(null);
  const [tab, setTab]           = useState("chart");

  const set = key => val => setP(prev => ({ ...prev, [key]: val }));
  const toggle = s => setOpenSection(prev => prev === s ? null : s);

  const all = useMemo(() => ({
    hippaku:  simulate(p, "hippaku"),
    standard: simulate(p, "standard"),
    yoyu:     simulate(p, "yoyu"),
  }), [p]);

  const chartData = useMemo(() => all.standard.map((d, i) => ({
    key: d.key,
    year: d.year,
    half: d.half,
    capConfirmed:   d.year <= CONFIRMED_CAP_UNTIL ? d.cap : undefined,
    capUnconfirmed: d.year >  CONFIRMED_CAP_UNTIL ? d.cap : undefined,
    逼迫_空き枠: all.hippaku[i].vacancy,
    標準_空き枠: all.standard[i].vacancy,
    余裕_空き枠: all.yoyu[i].vacancy,
  })), [all]);

  const currentVacancy  = Math.max(0, CONFIRMED_CAP - p.currentResidents);
  const currentFill     = Math.round((p.currentResidents / CONFIRMED_CAP) * 100);
  const currentChanceKey = currentFill >= 95 ? "danger" : currentFill >= 80 ? "caution" : currentFill >= 60 ? "normal" : "good";
  const currentChance   = CHANCE_META[currentChanceKey];
  const chanceHalfYears = all.standard.filter(r => r.fillRate < 80).length;
  const chanceYearsDisplay = chanceHalfYears % 2 === 0 ? String(chanceHalfYears / 2) : (chanceHalfYears / 2).toFixed(1);
  const dangerRow       = all.standard.find(r => r.fillRate >= 90);
  const dangerLabel     = dangerRow ? dangerRow.label : "−";

  return (
    <div style={{
      minHeight:"100vh",
      background:"#020c1a",
      color:"#e2e8f0",
      fontFamily:"'Inter','Noto Sans JP','Hiragino Sans',sans-serif",
      paddingBottom:80,
      maxWidth:600,
      margin:"0 auto"
    }}>

      {/* ヘッダー */}
      <div style={{
        background:"linear-gradient(160deg, #051526 0%, #0a1f3a 60%, #0d2544 100%)",
        borderBottom:"1px solid #1e3a5f",
        padding:"20px 20px 16px",
        position:"sticky", top:0, zIndex:100
      }}>
        <div style={{ display:"flex", alignItems:"center", gap:10 }}>
          <div style={{
            width:36, height:36, borderRadius:8, background:"linear-gradient(135deg,#1d4ed8,#0ea5e9)",
            display:"flex", alignItems:"center", justifyContent:"center", fontSize:16, flexShrink:0
          }}>📊</div>
          <div>
            <div style={{ fontSize:10, letterSpacing:"0.15em", color:"#38bdf8", marginBottom:2, textTransform:"uppercase", fontWeight:600 }}>
              特定技能・介護分野／登録支援機関向け
            </div>
            <div style={{ fontSize:16, fontWeight:800, lineHeight:1.2, letterSpacing:"-0.01em" }}>
              市場・営業チャンス シミュレーター
            </div>
          </div>
        </div>
        <div style={{ fontSize:10, color:"#475569", marginTop:6, marginLeft:46 }}>2025年12月–2040年（半年ごと）　社内営業判断用</div>
      </div>

      {/* 警告バナー */}
      <div style={{ margin:"14px 16px", background:"rgba(239,68,68,0.07)", border:"1px solid rgba(239,68,68,0.3)", borderRadius:12, padding:"14px 16px" }}>
        <div style={{ fontSize:11, color:"#f87171", fontWeight:700, marginBottom:8, display:"flex", alignItems:"center", gap:6 }}>
          <span style={{ fontSize:14 }}>🚨</span> 専門家推計（Global HR Strategy 2026年上半期資料）
        </div>
        <div style={{ fontSize:11, color:"#94a3b8", lineHeight:1.9, marginBottom:12 }}>
          現行ペース（年+26,332人・令和8年3月末時点 出入国在留管理庁速報値）が続いた場合、介護分野は
          <span style={{ color:"#f87171", fontWeight:700 }}>　2028年3月に受入停止</span>
          となる見込み。外食業は2026年5月に実際に停止済み。
        </div>
        <div style={{ overflowX:"auto", WebkitOverflowScrolling:"touch" }}>
          <table style={{ width:"100%", borderCollapse:"collapse", fontSize:11 }}>
            <thead>
              <tr>
                {["時点","残り枠","在留者数","状況"].map(h => (
                  <th key={h} style={{ padding:"6px 8px", textAlign:"right", color:"#475569", borderBottom:"1px solid #1e3a5f", whiteSpace:"nowrap", fontWeight:600, fontSize:10 }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {EXPERT_FORECAST.map((row, i) => (
                <tr key={i} style={{ background: row.danger ? "rgba(239,68,68,0.12)" : row.actual ? "rgba(96,165,250,0.08)" : "transparent" }}>
                  <td style={{ padding:"7px 8px", color: row.danger ? "#f87171" : row.actual ? "#7dd3fc" : "#94a3b8", fontWeight: (row.danger || row.actual) ? 700 : 400, whiteSpace:"nowrap" }}>
                    {row.period}{row.danger ? " 🚨" : row.actual ? " ●実績" : ""}
                  </td>
                  <td style={{ padding:"7px 8px", textAlign:"right", color: row.danger ? "#f87171" : row.vacancy < 20000 ? "#fbbf24" : "#4ade80", fontWeight: row.danger ? 700 : 600, fontVariantNumeric:"tabular-nums" }}>
                    {row.danger ? "停止" : fmt(row.vacancy)}
                  </td>
                  <td style={{ padding:"7px 8px", textAlign:"right", color:"#475569", fontVariantNumeric:"tabular-nums" }}>{fmt(row.residents)}</td>
                  <td style={{ padding:"7px 8px", textAlign:"right" }}>
                    <span style={{ fontSize:10, padding:"2px 7px", borderRadius:20, background: row.danger ? "rgba(239,68,68,0.2)" : row.actual ? "rgba(96,165,250,0.2)" : i <= 1 ? "rgba(74,222,128,0.15)" : "rgba(251,191,36,0.15)", color: row.danger ? "#f87171" : row.actual ? "#7dd3fc" : i <= 1 ? "#4ade80" : "#fbbf24", fontWeight:600, whiteSpace:"nowrap" }}>
                      {row.danger ? "停止見込" : row.actual ? "確定値" : i <= 1 ? "チャンス" : "注意"}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div style={{ fontSize:9, color:"#334155", marginTop:8, lineHeight:1.6 }}>
          ※直近1年間の増加ペースが継続した場合の機械的推計。離脱・帰国や上限見直しは考慮していない。●実績は出入国在留管理庁 令和8年3月末速報値
        </div>
      </div>

      {/* KPI 3連 */}
      <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr 1fr", gap:8, margin:"0 16px 14px" }}>
        {[
          { label:"介護分野上限", value:fmtK(CONFIRMED_CAP), sub:"確定値", color:"#fbbf24" },
          { label:"現在の在留者", value:fmtK(p.currentResidents), sub:"R8.3末(速報)", color:"#60a5fa" },
          { label:"現在の空き枠", value:fmtK(currentVacancy), sub:`充填率 ${currentFill}%`, color:"#4ade80" },
        ].map((item,i) => (
          <div key={i} style={{ background:"rgba(255,255,255,0.03)", border:"1px solid #1e3a5f", borderRadius:10, padding:"12px 8px", textAlign:"center" }}>
            <div style={{ fontSize:9, color:"#475569", marginBottom:4, letterSpacing:"0.02em" }}>{item.label}</div>
            <div style={{ fontSize:18, fontWeight:800, color:item.color, fontVariantNumeric:"tabular-nums" }}>{item.value}</div>
            <div style={{ fontSize:9, color:"#334155", marginTop:2 }}>{item.sub}</div>
          </div>
        ))}
      </div>

      {/* 現況バナー */}
      <div style={{ margin:"0 16px 14px", background:currentChance.bg, border:`1px solid ${currentChance.color}44`, borderRadius:12, padding:"14px 16px" }}>
        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center" }}>
          <div>
            <div style={{ fontSize:10, color:"#475569", marginBottom:4 }}>現在の市場状況（標準シナリオ）</div>
            <div style={{ fontSize:22, fontWeight:800, color:currentChance.color, letterSpacing:"-0.01em" }}>{currentChance.label}</div>
            <div style={{ fontSize:11, color:"#94a3b8", marginTop:2 }}>{currentChance.sub}</div>
          </div>
          <div style={{ textAlign:"right" }}>
            <div style={{ fontSize:10, color:"#475569", marginBottom:2 }}>チャンス期間</div>
            <div style={{ fontSize:28, fontWeight:800, color:"#60a5fa", fontVariantNumeric:"tabular-nums", lineHeight:1 }}>{chanceYearsDisplay}<span style={{ fontSize:12 }}>年</span></div>
            <div style={{ fontSize:10, color:"#475569", marginTop:4 }}>危険ライン {dangerLabel}</div>
          </div>
        </div>
        <div style={{ marginTop:12, background:"rgba(255,255,255,0.06)", borderRadius:6, height:8, overflow:"hidden" }}>
          <div style={{ height:"100%", borderRadius:6, width:`${currentFill}%`, background: currentFill >= 80 ? "linear-gradient(90deg,#f87171,#ef4444)" : currentFill >= 60 ? "linear-gradient(90deg,#fbbf24,#f59e0b)" : "linear-gradient(90deg,#4ade80,#22c55e)", transition:"width 0.4s ease" }} />
        </div>
        <div style={{ display:"flex", justifyContent:"space-between", fontSize:9, color:"#334155", marginTop:4 }}>
          <span>0%</span><span>60%</span><span>80%</span><span>95%</span><span>100%</span>
        </div>
      </div>

      {/* タブナビ */}
      <div style={{ display:"flex", margin:"0 16px 2px", background:"rgba(255,255,255,0.03)", border:"1px solid #1e3a5f", borderRadius:10, overflow:"hidden" }}>
        {[["chart","📈 グラフ"],["chance","🎯 営業チャンス"],["astation","🏢 試算"]].map(([key,label]) => (
          <button key={key} onClick={() => setTab(key)} style={{
            flex:1, padding:"10px 4px", border:"none",
            background: tab===key ? "rgba(96,165,250,0.15)" : "transparent",
            color: tab===key ? "#7dd3fc" : "#475569",
            cursor:"pointer", fontSize:10, fontWeight: tab===key ? 700 : 400,
            borderRight: key !== "astation" ? "1px solid #1e3a5f" : "none",
            transition:"all 0.15s"
          }}>{label}</button>
        ))}
      </div>

      {/* ── グラフタブ */}
      {tab === "chart" && (
        <div style={{ padding:"12px 16px 0" }}>
          {/* シナリオ選択 */}
          <div style={{ display:"flex", gap:6, marginBottom:10 }}>
            {Object.entries(SCENARIOS).map(([key,sc]) => (
              <button key={key} onClick={() => setActiveS(prev =>
                prev.includes(key) ? prev.filter(k=>k!==key) : [...prev,key]
              )} style={{
                flex:1, padding:"9px 6px", borderRadius:9, cursor:"pointer",
                border:`1.5px solid ${activeS.includes(key) ? sc.color : "#1e3a5f"}`,
                background: activeS.includes(key) ? sc.color+"15" : "transparent",
                textAlign:"center", transition:"all 0.15s"
              }}>
                <div style={{ fontSize:12, fontWeight:700, color: activeS.includes(key) ? sc.color : "#334155" }}>
                  {sc.icon} {sc.label}
                </div>
                <div style={{ fontSize:9, color:"#334155", marginTop:2 }}>{sc.sublabel}</div>
              </button>
            ))}
          </div>

          {/* 専門家推計トグル */}
          <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:10 }}>
            <button onClick={() => setShowExpert(v=>!v)} style={{
              padding:"5px 14px", borderRadius:20, fontSize:10, cursor:"pointer",
              border:`1.5px solid ${showExpert ? "#f87171" : "#1e3a5f"}`,
              background: showExpert ? "rgba(248,113,113,0.12)" : "transparent",
              color: showExpert ? "#f87171" : "#475569", fontWeight:600, transition:"all 0.15s"
            }}>🚨 専門家推計ライン</button>
            <span style={{ fontSize:9, color:"#334155" }}>Global HR Strategy 2026資料</span>
          </div>

          {/* 上限凡例 */}
          <div style={{ background:"rgba(255,255,255,0.02)", border:"1px solid #1e3a5f", borderRadius:8, padding:"8px 12px", marginBottom:10 }}>
            <div style={{ fontSize:10, color:"#64748b", lineHeight:2 }}>
              <span style={{ color:"#fbbf24", fontWeight:700 }}>━ 上限（実線）</span>
              <span style={{ color:"#475569" }}>　介護126,900人（確定）</span>
              {"　"}
              <span style={{ color:"rgba(251,191,36,0.5)", fontWeight:700 }}>╌ 上限（点線）</span>
              <span style={{ color:"#475569" }}>　2029年以降（仮定）</span>
            </div>
            <div style={{ fontSize:9, color:"#334155", marginTop:4 }}>2025年12月末は実測値。2026年6月末以降は自社モデルによる独自試算です（専門家推計は参考ラインとして表示）</div>
          </div>

          <ResponsiveContainer width="100%" height={260}>
            <ComposedChart data={chartData} margin={{ top:8, right:8, left:0, bottom:0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#0d2544" />
              <XAxis dataKey="key" tick={{ fontSize:9, fill:"#334155" }} tickFormatter={v => {
                const parts = String(v).split("-");
                return parts[1] === "1" ? `'${parts[0].slice(2)}` : "";
              }} />
              <YAxis tick={{ fontSize:9, fill:"#334155" }} tickFormatter={fmtK} width={38} />
              <Tooltip content={<TT />} />
              {REVIEW_YEARS.map(y => (
                <ReferenceLine key={y} x={`${y}-1`} stroke="#1e3a5f" strokeDasharray="4 2"
                  label={{ value:"見直し", position:"top", fontSize:8, fill:"#334155" }} />
              ))}
              {showExpert && (
                <ReferenceLine x="2028-1" stroke="#f87171" strokeDasharray="3 3" strokeWidth={1.5}
                  label={{ value:"🚨停止見込", position:"insideTopRight", fontSize:9, fill:"#f87171" }} />
              )}
              <ReferenceLine x={`${p.ikuseiroTransferStart}-1`} stroke="rgba(251,191,36,0.3)" strokeDasharray="3 3"
                label={{ value:"育成就労↑", position:"insideTopLeft", fontSize:8, fill:"#92400e" }} />
              <Line dataKey="capConfirmed"   name="上限（確定）" stroke="#fbbf24" strokeWidth={2}   dot={false} connectNulls={false} />
              <Line dataKey="capUnconfirmed" name="上限（仮定）" stroke="#fbbf24" strokeWidth={1.5} dot={false} strokeDasharray="6 4" connectNulls={false} opacity={0.5} />
              {activeS.includes("hippaku")  && <Line dataKey="逼迫_空き枠" name="⚠ 逼迫" stroke="#f87171" strokeWidth={1.5} dot={false} strokeDasharray="4 2" />}
              {activeS.includes("standard") && <Line dataKey="標準_空き枠" name="● 標準" stroke="#60a5fa" strokeWidth={2.5} dot={false} />}
              {activeS.includes("yoyu")     && <Line dataKey="余裕_空き枠" name="✓ 余裕" stroke="#4ade80" strokeWidth={1.5} dot={false} />}
            </ComposedChart>
          </ResponsiveContainer>

          {/* 上限調整 */}
          <div style={{ marginTop:14 }}>
            <button onClick={() => toggle("cap")} style={{
              width:"100%", padding:"10px 16px", background:"rgba(251,191,36,0.05)",
              border:`1px solid ${openSection==="cap" ? "#fbbf24" : "rgba(251,191,36,0.2)"}`,
              borderRadius: openSection==="cap" ? "9px 9px 0 0" : 9,
              color:"#fbbf24", cursor:"pointer", fontSize:11, fontWeight:700,
              display:"flex", justifyContent:"space-between", transition:"all 0.15s"
            }}>
              <span>⚙ 2029年以降の上限を調整（政府未発表・仮定）</span>
              <span>{openSection==="cap" ? "▲" : "▼"}</span>
            </button>
            {openSection === "cap" && (
              <div style={{ background:"rgba(251,191,36,0.03)", border:"1px solid rgba(251,191,36,0.2)", borderTop:"none", borderRadius:"0 0 9px 9px", padding:"16px" }}>
                <div style={{ fontSize:10, color:"#92400e", marginBottom:14, lineHeight:1.7 }}>
                  介護上限は現在126,900人（確定）。2029年以降は政府未発表。
                  据え置き・引き上げ両方のシナリオで試算できます。
                </div>
                {[["cap2029","2029〜2033年"],["cap2034","2034〜2038年"],["cap2039","2039年〜2040年"]].map(([key,label]) => (
                  <SliderRow key={key} label={label} value={p[key]}
                    min={80000} max={300000} step={5000} unit="人"
                    highlight={p[key] !== 126900}
                    hint={p[key] === 126900 ? "据え置き（確定値と同じ）" : `${p[key].toLocaleString()}人に設定`}
                    onChange={set(key)} />
                ))}
                <button onClick={() => setP(prev => ({ ...prev, cap2029:126900, cap2034:126900, cap2039:126900 }))}
                  style={{ padding:"6px 14px", background:"transparent", border:"1px solid rgba(251,191,36,0.3)", borderRadius:6, color:"#fbbf24", cursor:"pointer", fontSize:11 }}>
                  すべて据え置きに戻す
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── 営業チャンスタブ */}
      {tab === "chance" && (
        <div style={{ padding:"12px 16px" }}>
          <div style={{ background:"rgba(248,113,113,0.07)", border:"1px solid rgba(248,113,113,0.25)", borderRadius:10, padding:"14px", marginBottom:14 }}>
            <div style={{ fontSize:10, color:"#f87171", fontWeight:700, marginBottom:10 }}>
              🚨 専門家推計（現行ペース継続の場合）
            </div>
            <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:8 }}>
              {EXPERT_FORECAST.map((row, i) => (
                <div key={i} style={{
                  background: row.danger ? "rgba(239,68,68,0.15)" : "rgba(255,255,255,0.03)",
                  border: `1px solid ${row.danger ? "rgba(248,113,113,0.4)" : "#1e3a5f"}`,
                  borderRadius:8, padding:"10px 12px"
                }}>
                  <div style={{ fontSize:9, color:"#475569", marginBottom:4 }}>{row.period}</div>
                  <div style={{ fontSize:17, fontWeight:800, color: row.danger ? "#f87171" : row.vacancy < 20000 ? "#fbbf24" : "#4ade80", fontVariantNumeric:"tabular-nums" }}>
                    {row.danger ? "🚨 停止" : `${fmtK(row.vacancy)}人`}
                  </div>
                  {!row.danger && <div style={{ fontSize:9, color:"#334155", marginTop:2 }}>空き枠</div>}
                </div>
              ))}
            </div>
          </div>

          <div style={{ fontSize:10, color:"#475569", marginBottom:8 }}>
            シミュレーション結果（半年ごと・2025年12月末は実測値、2026年6月末以降は自社モデルの試算）　充填率:
            <span style={{ color:"#4ade80" }}> ◎60%未満</span>
            <span style={{ color:"#60a5fa" }}> ○60〜80%</span>
            <span style={{ color:"#fbbf24" }}> △80〜95%</span>
            <span style={{ color:"#f87171" }}> ⚠95%以上</span>
          </div>
          <div style={{ overflowX:"auto", WebkitOverflowScrolling:"touch" }}>
            <table style={{ width:"100%", borderCollapse:"collapse", fontSize:10 }}>
              <thead>
                <tr style={{ background:"rgba(255,255,255,0.03)" }}>
                  {["時点","上限","空き枠","充填率","⚠逼迫","●標準","✓余裕"].map(h => (
                    <th key={h} style={{ padding:"8px 5px", textAlign:"right", color:"#475569", borderBottom:"1px solid #1e3a5f", whiteSpace:"nowrap", fontWeight:600, fontSize:9 }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {all.standard.map((row, i) => {
                  const h = all.hippaku[i];
                  const y = all.yoyu[i];
                  const isReview  = REVIEW_YEARS.includes(row.year);
                  const isDanger2028 = row.year === 2028;
                  const isHistorical = row.historical;
                  const cm = CHANCE_META[row.chance];
                  return (
                    <tr key={row.key} style={{
                      background: isDanger2028 ? "rgba(239,68,68,0.08)" : isReview ? "rgba(251,191,36,0.04)" : isHistorical ? "rgba(96,165,250,0.04)" : "transparent",
                      borderLeft: isDanger2028 ? "2px solid #f87171" : isReview ? "2px solid #fbbf24" : isHistorical ? "2px solid #60a5fa" : "2px solid transparent"
                    }}>
                      <td style={{ padding:"7px 5px", color: isDanger2028 ? "#f87171" : isReview ? "#fbbf24" : isHistorical ? "#7dd3fc" : "#64748b", fontWeight: (isDanger2028||isReview) ? 700 : 400, fontVariantNumeric:"tabular-nums", whiteSpace:"nowrap" }}>
                        {row.label}{isDanger2028 ? " 🚨" : isReview ? " ★" : isHistorical ? " 📊" : ""}
                      </td>
                      <td style={{ padding:"7px 5px", textAlign:"right", color: row.year <= CONFIRMED_CAP_UNTIL ? "#fbbf24" : "rgba(251,191,36,0.4)", fontSize:9, fontVariantNumeric:"tabular-nums" }}>
                        {fmtK(row.cap)}{row.year > CONFIRMED_CAP_UNTIL ? "仮" : ""}
                      </td>
                      <td style={{ padding:"7px 5px", textAlign:"right", fontWeight:700, color:cm.color, fontVariantNumeric:"tabular-nums" }}>
                        {fmtK(row.vacancy)}
                      </td>
                      <td style={{ padding:"7px 5px", textAlign:"right" }}>
                        <span style={{ fontSize:10, padding:"2px 6px", borderRadius:20, background: cm.color+"20", color:cm.color, fontWeight:700 }}>
                          {row.fillRate}%
                        </span>
                      </td>
                      {isHistorical ? (
                        <td colSpan={3} style={{ padding:"7px 5px", textAlign:"center", fontSize:9, color:"#7dd3fc" }}>
                          実測値（3シナリオ共通）
                        </td>
                      ) : (
                        <>
                          <td style={{ padding:"7px 5px", textAlign:"center", fontSize:9, color:CHANCE_META[h.chance].color }}>{CHANCE_META[h.chance].label}</td>
                          <td style={{ padding:"7px 5px", textAlign:"center", fontSize:9, color:cm.color }}>{cm.label}</td>
                          <td style={{ padding:"7px 5px", textAlign:"center", fontSize:9, color:CHANCE_META[y.chance].color }}>{CHANCE_META[y.chance].label}</td>
                        </>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── A-station試算タブ */}
      {tab === "astation" && (
        <div style={{ padding:"12px 16px" }}>
          <div style={{ background:"rgba(255,255,255,0.02)", border:"1px solid #1e3a5f", borderRadius:12, padding:"16px", marginBottom:12 }}>
            <div style={{ fontSize:11, color:"#60a5fa", fontWeight:700, marginBottom:14, letterSpacing:"0.02em" }}>現状入力</div>
            <SliderRow label="支援中の企業数" value={p.aCompanies} min={1} max={200} step={1} unit="社" onChange={set("aCompanies")} />
            <SliderRow label="支援中の外国人数" value={p.aWorkers} min={1} max={1000} step={5} unit="人" onChange={set("aWorkers")} />
            <SliderRow label="1人あたり月額支援費" value={p.monthlyFee} min={10000} max={80000} step={1000} unit="円" onChange={set("monthlyFee")} />
          </div>

          <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:8, marginBottom:12 }}>
            {[
              { label:"月間売上（推計）",   value:`¥${(p.aWorkers*p.monthlyFee/10000).toFixed(0)}万`, color:"#60a5fa" },
              { label:"年間売上（推計）",   value:`¥${(p.aWorkers*p.monthlyFee*12/10000).toFixed(0)}万`, color:"#60a5fa" },
              { label:"全国シェア（推計）", value:`${((p.aWorkers/p.currentResidents)*100).toFixed(2)}%`, color:"#fbbf24" },
              { label:"1社あたり平均",      value:`${Math.round(p.aWorkers/p.aCompanies)}人`, color:"#94a3b8" },
            ].map((item,i) => (
              <div key={i} style={{ background:"rgba(255,255,255,0.03)", border:"1px solid #1e3a5f", borderRadius:10, padding:"14px 12px", textAlign:"center" }}>
                <div style={{ fontSize:9, color:"#475569", marginBottom:6, letterSpacing:"0.02em" }}>{item.label}</div>
                <div style={{ fontSize:20, fontWeight:800, color:item.color, fontVariantNumeric:"tabular-nums" }}>{item.value}</div>
              </div>
            ))}
          </div>

          <div style={{ background:"rgba(248,113,113,0.07)", border:"1px solid rgba(248,113,113,0.25)", borderRadius:10, padding:"14px", marginBottom:12 }}>
            <div style={{ fontSize:11, color:"#f87171", fontWeight:700, marginBottom:8 }}>🚨 営業タイムリミット</div>
            <div style={{ fontSize:12, color:"#94a3b8", lineHeight:2 }}>
              専門家推計では現行ペースで <span style={{ color:"#f87171", fontWeight:700 }}>2028年3月に受入停止</span>。
              今から約<span style={{ color:"#fbbf24", fontWeight:700 }}>1年8ヶ月</span>。
              この期間に空き枠を持つ介護事業所への営業を集中させることが重要。
            </div>
          </div>

          <div style={{ background:"rgba(255,255,255,0.02)", border:"1px solid #1e3a5f", borderRadius:12, padding:"16px" }}>
            <div style={{ fontSize:11, color:"#4ade80", fontWeight:700, marginBottom:12 }}>
              空き枠シェア獲得試算　現在の空き枠 <span style={{ fontVariantNumeric:"tabular-nums" }}>{fmt(currentVacancy)}</span>人
            </div>
            {[0.5, 1.0, 2.0, 3.0].map(pct => {
              const target = Math.round(currentVacancy * pct / 100);
              const rev    = target * p.monthlyFee;
              return (
                <div key={pct} style={{ display:"flex", justifyContent:"space-between", alignItems:"center", padding:"10px 0", borderBottom:"1px solid #0d2544" }}>
                  <div>
                    <span style={{ fontSize:12, fontWeight:700, color:"#e2e8f0" }}>空き枠の{pct}%獲得</span>
                    <span style={{ fontSize:10, color:"#334155", marginLeft:6, fontVariantNumeric:"tabular-nums" }}>≈ {fmt(target)}人</span>
                  </div>
                  <div style={{ textAlign:"right" }}>
                    <div style={{ fontSize:14, fontWeight:700, color:"#4ade80", fontVariantNumeric:"tabular-nums" }}>月{(rev/10000).toFixed(0)}万円</div>
                    <div style={{ fontSize:9, color:"#334155", fontVariantNumeric:"tabular-nums" }}>年{(rev*12/10000).toFixed(0)}万円</div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* 詳細パラメーター */}
      <div style={{ margin:"14px 16px 0" }}>
        <button onClick={() => toggle("flow")} style={{
          width:"100%", padding:"10px 16px", background:"rgba(255,255,255,0.02)",
          border:`1px solid ${openSection==="flow" ? "#60a5fa" : "#1e3a5f"}`,
          borderRadius: openSection==="flow" ? "9px 9px 0 0" : 9,
          color:"#64748b", cursor:"pointer", fontSize:11, fontWeight:600,
          display:"flex", justifyContent:"space-between", transition:"all 0.15s"
        }}>
          <span>⚙ 詳細パラメーター（流入・流出の仮定値）</span>
          <span>{openSection==="flow" ? "▲" : "▼"}</span>
        </button>
        {openSection === "flow" && (
          <div style={{ background:"rgba(255,255,255,0.02)", border:"1px solid #1e3a5f", borderTop:"none", borderRadius:"0 0 9px 9px", padding:"16px" }}>
            <div style={{ fontSize:10, color:"#334155", marginBottom:14, lineHeight:1.7 }}>
              2025年12月末は実測値で固定。2026年6月末以降はこの流入出仮定に基づき自社モデルで試算します（専門家推計とは独立に計算されるため、数値は一致しません）。
            </div>
            <SliderRow label="技能実習介護 在留者総数" value={p.traineeKaigoResidents}
              min={5000} max={40000} step={100} unit="人"
              hint={`年間修了者(÷3)≈${Math.round(p.traineeKaigoResidents/3).toLocaleString()}人　実績:18,400人`}
              onChange={set("traineeKaigoResidents")} />
            <SliderRow label="技能実習→特定技能 転換率" value={p.traineeConvRate}
              min={10} max={95} step={1} unit="%"
              hint={`年間転換者≈${Math.round(p.traineeKaigoResidents/3*p.traineeConvRate/100).toLocaleString()}人`}
              onChange={set("traineeConvRate")} />
            <SliderRow label="試験合格・直接入国（年間）" value={p.directEntryBase}
              min={2000} max={40000} step={500} unit="人"
              hint="R7後半ペース換算 約25,900人/年" onChange={set("directEntryBase")} />
            <SliderRow label="直接入国者 年間増加率" value={p.directEntryGrowth}
              min={-5} max={30} step={1} unit="%/年" onChange={set("directEntryGrowth")} />
            <div style={{ borderTop:"1px solid #0d2544", margin:"12px 0" }} />
            <SliderRow label="帰国・転職等 年間離脱率" value={p.repatriateRate}
              min={3} max={30} step={1} unit="%/年" hint="業界推計 10〜15%" onChange={set("repatriateRate")} />
            <SliderRow label="介護福祉士→在留「介護」移行率" value={p.kaishouRate}
              min={0} max={15} step={0.5} unit="%/年"
              hint="合格すると特定技能カウント外→枠が空く" onChange={set("kaishouRate")} />
            <div style={{ borderTop:"1px solid #0d2544", margin:"12px 0" }} />
            <div style={{ fontSize:10, color:"#fbbf24", marginBottom:10, fontWeight:600 }}>
              育成就労（2027年4月入国→最短2030年転換）
            </div>
            <SliderRow label="転換者が出始める年" value={p.ikuseiroTransferStart}
              min={2030} max={2035} step={1} unit="年" onChange={set("ikuseiroTransferStart")} />
            <SliderRow label="初年度 転換者数" value={p.ikuseiroInitial}
              min={500} max={15000} step={500} unit="人" onChange={set("ikuseiroInitial")} />
            <SliderRow label="転換者 年間増加率" value={p.ikuseiroGrowth}
              min={0} max={50} step={1} unit="%/年" onChange={set("ikuseiroGrowth")} />
          </div>
        )}
      </div>

      {/* 注意事項 */}
      <div style={{ margin:"12px 16px 0", background:"rgba(255,255,255,0.02)", border:"1px solid #1e3a5f", borderRadius:10, padding:"12px 16px" }}>
        <div style={{ fontSize:9, color:"#334155", lineHeight:2 }}>
          <div style={{ color:"#475569", fontWeight:600, marginBottom:4 }}>⚠ データ出典・注意事項</div>
          <div>・在留者数74,745人：出入国在留管理庁「特定技能１号の受入れ見込数及び在留者数について」令和8年3月末時点・速報値</div>
          <div>・受入れ見込数の充足率：58.9%（同資料）</div>
          <div>・上限126,900人：介護分野別運用方針（全体805,700人とは別、令和8年1月閣議決定）</div>
          <div>・専門家推計：Global HR Strategy 2026年上半期資料</div>
          <div>・2025年12月末は実測値（出入国在留管理庁）で固定。2026年6月末以降は下記の流入出仮定に基づく自社モデルの試算値で、専門家推計とは独立に計算（一致しない場合あり。半年ベースは年間仮定値を単純に2分割）</div>
          <div>・2029年以降の上限・シナリオラインは仮定値（点線）</div>
          <div style={{ color:"#f87171", marginTop:4 }}>・本ツールは社内営業判断用。外部開示・行政提出には使用不可</div>
        </div>
      </div>
    </div>
  );
}
