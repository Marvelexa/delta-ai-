import { deltaAutoTraderEngine, AutoTraderPosition } from "../lib/deltaAutoTraderEngine";
import { deltaExchangeEngine } from "../lib/deltaExchangeEngine";

function assert(condition: boolean, testName: string, details?: string) {
  if (!condition) {
    console.error(`  ❌ [FAIL] ${testName}`);
    if (details) console.error(`     ↳ ${details}`);
    process.exit(1);
  } else {
    console.log(`  ✅ [PASS] ${testName}`);
    if (details) console.log(`     ↳ ${details}`);
  }
}

console.log("================================================================================");
console.log("🧪 RUNNING SUITE: TARGET RATCHET, TRAILING SL, AND DELTA BRACKET ORDERS");
console.log("================================================================================");

// 1. STEP-UP TARGET RATCHET TEST
console.log("\n1. STEP-UP TARGET RATCHET & LADDER TESTS");

async function runTest() {
  // Setup a mock position: Entry = 2500, Initial SL = 2450 (Risk = $7.50), Initial TP = 2600 (Gain = $15)
  const testPosition: AutoTraderPosition = {
    id: "test_ratchet_pos_1",
    symbol: "ETHUSD",
    type: "BUY",
    quantity: 15,
    entryPrice: 2500,
    currentPrice: 2500,
    stopLossPrice: 2450,
    targetPrice: 2600,
    initialRiskUSD: 7.50,
    atrValue: 30,
    confidenceScore: 85,
    unrealizedPnLUSD: 0,
    unrealizedPnLPct: 0,
    trailingStopActive: false,
    highestProfitUSD: 0,
    timeframeAlignment: "15m+1h+4h Aligned",
    entryTimestamp: new Date().toISOString(),
    entryTimeMs: Date.now(),
    maxHoldTimeExpiry: Date.now() + 86400000,
    ratchetTier: 0
  };

  (deltaAutoTraderEngine as any).openPositions = [testPosition];

  // Simulate price rising to 2600 (Target 1 Reached)
  await deltaAutoTraderEngine.updateLivePriceAndCheckExits("ETHUSD", 2605);

  assert((testPosition.ratchetTier || 0) >= 1, "Target Ratchet increments tier to 1 upon reaching Target 1", `ratchetTier = ${testPosition.ratchetTier}`);
  assert(testPosition.targetPrice > 2600, "Target Price extended upward above 2600", `New Target = $${testPosition.targetPrice}`);
  assert(testPosition.stopLossPrice > 2500, "Stop Loss moved above Entry into guaranteed profit", `New SL = $${testPosition.stopLossPrice}`);
  assert((testPosition.lockedProfitUSD || 0) > 0, "Guaranteed profit is locked", `Locked Profit = $${testPosition.lockedProfitUSD}`);

  // 2. SIMULATE TARGET 2 REACHED (Price rises to new target)
  const currentTP = testPosition.targetPrice;
  await deltaAutoTraderEngine.updateLivePriceAndCheckExits("ETHUSD", currentTP + 5);

  assert((testPosition.ratchetTier || 0) >= 2, "Target Ratchet increments tier to 2 upon reaching Target 2", `ratchetTier = ${testPosition.ratchetTier}`);
  assert(testPosition.targetPrice > currentTP, "Target Price extended further upward", `New Target = $${testPosition.targetPrice}`);
  assert(testPosition.stopLossPrice > 2550, "Stop Loss trailed further up into higher guaranteed profit", `New SL = $${testPosition.stopLossPrice}`);

  // 3. SIMULATE REVERSAL TO HIT TRAILING SL (Price drops to Stop Loss)
  const activeSL = testPosition.stopLossPrice;
  await deltaAutoTraderEngine.updateLivePriceAndCheckExits("ETHUSD", activeSL - 5);

  assert((deltaAutoTraderEngine as any).openPositions.length === 0, "Position automatically closed upon hitting trailed SL", "Open positions = 0");
  const latestClosed = deltaAutoTraderEngine.getClosedRecords()[0];
  assert(latestClosed && latestClosed.outcome === "WIN", "Closed record outcome is WIN with profit banked", `Outcome = ${latestClosed?.outcome}, PnL = $${latestClosed?.realizedPnLUSD}`);
}

runTest().then(() => {

// 4. BEARISH / SHORT SETUP EVALUATION TEST
console.log("\n2. BEARISH / SHORT SETUP SIGNAL TEST");
const mockBearish15m = Array.from({ length: 25 }, (_, i) => ({
  open: 105 - i * 0.5,
  high: 105.5 - i * 0.5,
  low: 104 - i * 0.5,
  close: 104.2 - i * 0.5,
  volume: 500 + i * 50
}));
const mockBearish1h = Array.from({ length: 25 }, (_, i) => ({
  open: 120 - i,
  high: 121 - i,
  low: 119 - i,
  close: 119.5 - i,
  volume: 500
}));
const mockBearish4h = Array.from({ length: 25 }, (_, i) => ({
  open: 150 - i * 2,
  high: 151 - i * 2,
  low: 148 - i * 2,
  close: 148.5 - i * 2,
  volume: 1000
}));

const bearAnalysis = deltaAutoTraderEngine.analyzeMultiTimeframe("BTCUSD", mockBearish15m, mockBearish1h, mockBearish4h);
assert(bearAnalysis.direction === "SELL", "System accurately identifies SELL / SHORT setups during bearish breakdown", `Direction: ${bearAnalysis.direction}, Bear Score: ${bearAnalysis.overallScore}/100`);
assert(bearAnalysis.overallScore >= 60, "Bearish setup receives high conviction score", `Score: ${bearAnalysis.overallScore}/100`);

// 5. DELTA EXCHANGE BRACKET ORDER METHOD EXISTENCE & SIGNATURE
console.log("\n3. DELTA EXCHANGE BRACKET ORDER METHODS");
assert(typeof deltaExchangeEngine.setBracketOrder === "function", "deltaExchangeEngine.setBracketOrder method exists");
assert(typeof deltaExchangeEngine.updateBracketOrder === "function", "deltaExchangeEngine.updateBracketOrder method exists");
assert(typeof deltaExchangeEngine.cancelBracketOrder === "function", "deltaExchangeEngine.cancelBracketOrder method exists");

console.log("\n================================================================================");
console.log("🏁 ALL TARGET RATCHET, SELL/SHORT & BRACKET TESTS PASSED PERFECTLY!");
console.log("================================================================================");
});
