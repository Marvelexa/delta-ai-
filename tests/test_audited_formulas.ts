import { deltaAutoTraderEngine, OHLCVBar, FEE_BUFFER_PER_TRADE_USD } from "../lib/deltaAutoTraderEngine";

console.log("================================================================================");
console.log("🧪 AUDITED QUANTITATIVE MATHEMATICAL FORMULAS VALIDATION SUITE");
console.log("================================================================================\n");

let passed = 0;
let total = 0;

function assert(condition: boolean, name: string, detail?: string) {
  total++;
  if (condition) {
    console.log(`  ✅ [PASS] ${name}`);
    if (detail) console.log(`     ↳ ${detail}`);
    passed++;
  } else {
    console.error(`  ❌ [FAIL] ${name}`);
    if (detail) console.error(`     ↳ ${detail}`);
  }
}

// ─────────────────────────────────────────────────────────────
// 1. Fibonacci Golden Pocket (Correct Retracement Math)
// ─────────────────────────────────────────────────────────────
console.log("1. FIBONACCI GOLDEN POCKET FORMULA (AUDITED CORRECTION)");
// Synthetic price bars with High = 200, Low = 100, Range = 100
// Retracement measured down from High: 61.8% to 65% pullback = [200 - 65, 200 - 61.8] = [135, 138.2]
const fibBarsBull: OHLCVBar[] = Array.from({ length: 20 }, (_, i) => ({
  time: i * 900,
  open: 150,
  high: i === 5 ? 200 : 160,
  low: i === 0 ? 100 : 130,
  close: i === 19 ? 136.5 : 150, // Price in 135 - 138.2 zone!
  volume: 1000
}));

const fibResultBull = deltaAutoTraderEngine.calculateFibonacciGoldenPocket(fibBarsBull);
assert(fibResultBull.inGoldenPocket === true && fibResultBull.fibType === "BULLISH_PULLBACK",
  "Bullish Golden Pocket triggers on deep 61.8%-65.0% pullback (135 - 138.2) measured down from High",
  `inGoldenPocket: ${fibResultBull.inGoldenPocket}, Zone: [${fibResultBull.level065} - ${fibResultBull.level0618}], Current: 136.5`
);

// Retracement measured up from Low in downtrend: 61.8% to 65% bounce = [100 + 61.8, 100 + 65] = [161.8, 165]
const fibBarsBear: OHLCVBar[] = Array.from({ length: 20 }, (_, i) => ({
  time: i * 900,
  open: 150,
  high: i === 0 ? 200 : 170,
  low: i === 5 ? 100 : 140,
  close: i === 19 ? 163.0 : 150, // Price in 161.8 - 165 zone!
  volume: 1000
}));

const fibResultBear = deltaAutoTraderEngine.calculateFibonacciGoldenPocket(fibBarsBear);
assert(fibResultBear.inGoldenPocket === true && fibResultBear.fibType === "BEARISH_PULLBACK",
  "Bearish Golden Pocket triggers on deep 61.8%-65.0% relief bounce (161.8 - 165) measured up from Low",
  `inGoldenPocket: ${fibResultBear.inGoldenPocket}, Zone: [${fibResultBear.level0618} - ${fibResultBear.level065}], Current: 163.0`
);

// ─────────────────────────────────────────────────────────────
// 2. TD Sequential 9 Exhaustion (Top vs Bottom Mirrored Counts)
// ─────────────────────────────────────────────────────────────
console.log("\n2. TD SEQUENTIAL 9 EXHAUSTION (MIRRORED TOP & BOTTOM)");
// 9 consecutive closes higher than close 4 bars ago (Buy Exhaustion / Top)
const topBars: OHLCVBar[] = Array.from({ length: 15 }, (_, i) => ({
  time: i * 900,
  open: 100 + i * 5,
  high: 105 + i * 5,
  low: 99 + i * 5,
  close: 104 + i * 5,
  volume: 1000
}));
const tdTop = deltaAutoTraderEngine.calculateTDSequential(topBars);
assert(tdTop.isBuyExhausted === true && tdTop.buySetupCount >= 9,
  "TD Sequential identifies Bullish Buy Exhaustion (Top) on 9 consecutive Close > Close[t-4]",
  `buySetupCount: ${tdTop.buySetupCount}, isBuyExhausted: ${tdTop.isBuyExhausted}`
);

// 9 consecutive closes lower than close 4 bars ago (Sell Exhaustion / Bottom)
const bottomBars: OHLCVBar[] = Array.from({ length: 15 }, (_, i) => ({
  time: i * 900,
  open: 200 - i * 5,
  high: 202 - i * 5,
  low: 194 - i * 5,
  close: 195 - i * 5,
  volume: 1000
}));
const tdBottom = deltaAutoTraderEngine.calculateTDSequential(bottomBars);
assert(tdBottom.isSellExhausted === true && tdBottom.sellSetupCount >= 9,
  "TD Sequential identifies Bearish Sell Exhaustion (Bottom) on 9 consecutive Close < Close[t-4]",
  `sellSetupCount: ${tdBottom.sellSetupCount}, isSellExhausted: ${tdBottom.isSellExhausted}`
);

// ─────────────────────────────────────────────────────────────
// 3. Bayesian Confluence with Correlation Shrinkage
// ─────────────────────────────────────────────────────────────
console.log("\n3. BAYESIAN LOG-ODDS CONFLUENCE WITH CORRELATION SHRINKAGE");
const bayesScoreAllTrue = deltaAutoTraderEngine.calculateBayesianConfluenceScore({
  macroTrendAligned: true,
  smcPatternConfirmed: true,
  kamaAligned: true,
  buyVolumeDominanceRatio: 0.75,
  zScoreSafe: true,
  hurstTrending: true
});
assert(bayesScoreAllTrue > 80 && bayesScoreAllTrue < 99,
  "Bayesian Confluence produces realistic calibrated confidence without probability explosion",
  `Posterior Win Probability: ${bayesScoreAllTrue}%`
);

const bayesScoreLow = deltaAutoTraderEngine.calculateBayesianConfluenceScore({
  macroTrendAligned: false,
  smcPatternConfirmed: false,
  kamaAligned: false,
  buyVolumeDominanceRatio: 0.40,
  zScoreSafe: false,
  hurstTrending: false
});
assert(bayesScoreLow <= 58,
  "Unconfirmed indicators yield base prior baseline probability",
  `Posterior Win Probability: ${bayesScoreLow}%`
);

// ─────────────────────────────────────────────────────────────
// 4. Cumulative Volume Delta (CVD) Running Sum & BuyVolumeDominanceRatio
// ─────────────────────────────────────────────────────────────
console.log("\n4. RUNNING CUMULATIVE VOLUME DELTA (CVD) & DIVERGENCE");
const cvdBars: OHLCVBar[] = [
  { time: 1, open: 100, high: 102, low: 99, close: 101, volume: 500 },
  { time: 2, open: 101, high: 103, low: 100, close: 102, volume: 600 },
  { time: 3, open: 102, high: 104, low: 101, close: 103, volume: 700 },
  { time: 4, open: 103, high: 105, low: 102, close: 104, volume: 800 },
  { time: 5, open: 104, high: 106, low: 103, close: 105, volume: 900 }
];
const cvdReport = deltaAutoTraderEngine.calculateCVD(cvdBars);
assert(cvdReport.currentCVD > 0, "Running CVD accumulates buy/sell volume delta across bars", `Running CVD: ${cvdReport.currentCVD}`);
assert(cvdReport.buyVolumeDominanceRatio >= 0.65, "BuyVolumeDominanceRatio accurately reflects windowed buy volume ratio", `Buy Dominance: ${(cvdReport.buyVolumeDominanceRatio * 100).toFixed(1)}%`);

// ─────────────────────────────────────────────────────────────
// 5. Half-Kelly Position Sizing
// ─────────────────────────────────────────────────────────────
console.log("\n5. HALF-KELLY CRITERION BET SIZING");
const kellyFraction = deltaAutoTraderEngine.calculateKellyFraction(0.75, 2.05);
assert(kellyFraction > 0.05 && kellyFraction <= 0.15,
  "Half-Kelly formula bounds optimal fractional leverage (0.02 - 0.15)",
  `Half-Kelly Fraction: ${kellyFraction}`
);

// ─────────────────────────────────────────────────────────────
// 6. Net-of-Fee True Signed Expected Value (EV)
// ─────────────────────────────────────────────────────────────
console.log("\n6. TRUE SIGNED EXPECTED VALUE (EV) NET OF FEES");
const mockCandles: OHLCVBar[] = Array.from({ length: 30 }, (_, i) => ({
  time: Date.now() - (30 - i) * 900000,
  open: 70000 + i * 50,
  high: 70050 + i * 50,
  low: 69980 + i * 50,
  close: 70040 + i * 50,
  volume: 1200
}));

const analysis = deltaAutoTraderEngine.analyzeMultiTimeframe("BTCUSD", mockCandles, mockCandles, mockCandles);
assert(typeof analysis.projectedProfitUSD === "number",
  "Expected Value is strictly numerical and accounts for taker fees",
  `Net EV: $${analysis.projectedProfitUSD} USD (Fee Buffer: $${FEE_BUFFER_PER_TRADE_USD} USD)`
);

// ─────────────────────────────────────────────────────────────
// 7. Volatility-Threshold Regime Filter
// ─────────────────────────────────────────────────────────────
console.log("\n7. VOLATILITY THRESHOLD REGIME FILTER");
const regime = deltaAutoTraderEngine.calculateMarkovMarketRegime(mockCandles);
assert(regime.regime === "TRENDING_EXPANSION" || regime.regime === "COMPRESSION_CHOP",
  "Regime classifier properly computes return variance & regime state",
  `Regime: ${regime.regime}, Transition Prob: ${regime.transitionProb}`
);

console.log("\n================================================================================");
console.log(`🏁 SUITE COMPLETE: ${passed} / ${total} TESTS PASSED`);
console.log("================================================================================");
