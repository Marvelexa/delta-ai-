import { deltaAutoTraderEngine, MAX_CONSECUTIVE_LOSSES_ALLOWED } from "../lib/deltaAutoTraderEngine";

console.log("================================================================================");
console.log("🛡️ VERIFYING CIRCUIT BREAKERS & RISK SIZING FIXES");
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
// Test 1: Fix 1 — Circuit breaker guard in scanAndExecuteNextTrade
// ─────────────────────────────────────────────────────────────
console.log("1. FIX 1: CIRCUIT BREAKER GUARD (consecutiveLossCount TYPO FIX)");
(deltaAutoTraderEngine as any).consecutiveLossCount = 3;
(deltaAutoTraderEngine as any).settings.isEnabled = true;
(deltaAutoTraderEngine as any).isExecutionLocked = false;
(deltaAutoTraderEngine as any).openPositions = [];

deltaAutoTraderEngine.scanAndExecuteNextTrade(true).then((res) => {
  assert(res.executed === false && res.message.includes("CIRCUIT BREAKER ACTIVE"),
    "Circuit breaker halts new trade scans when consecutiveLossCount reaches 3",
    `Message: ${res.message}`
  );

  // Reset consecutiveLossCount
  (deltaAutoTraderEngine as any).consecutiveLossCount = 0;

  // ─────────────────────────────────────────────────────────────
  // Test 2: Fix 2 — Floating / Unrealized Drawdown trips Circuit Breaker
  // ─────────────────────────────────────────────────────────────
  console.log("\n2. FIX 2: FLOATING / UNREALIZED DRAWDOWN BREAKER TRIP");
  (deltaAutoTraderEngine as any).dailyStartCapitalUSD = 1000;
  (deltaAutoTraderEngine as any).settings.maxDailyLossPct = 3.0; // 3% max daily loss cap ($30)
  
  // Inject a mock open position with severe floating drawdown (-$35 USD = -3.5%)
  (deltaAutoTraderEngine as any).openPositions = [{
    id: "TEST-DD-POS",
    symbol: "BTCUSD",
    type: "BUY",
    entryPrice: 70000,
    currentPrice: 67550,
    stopLossPrice: 66000,
    initialStopLoss: 66000,
    targetPrice: 72000,
    quantity: 0.014,
    confidenceScore: 80,
    unrealizedPnLUSD: -35.00,
    unrealizedPnLPct: -3.5,
    trailingStopActive: false,
    highestProfitUSD: 0,
    timeframeAlignment: "Test",
    entryTimestamp: new Date().toISOString(),
    entryTimeMs: Date.now(),
    maxHoldTimeExpiry: Date.now() + 3600000
  }];

  const status = deltaAutoTraderEngine.getStatus();
  assert(status.circuitBreakerActive === true,
    "Floating drawdown (-3.5% exceeding 3.0% limit) trips circuit breaker immediately",
    `CircuitBreakerActive: ${status.circuitBreakerActive}, Floating Drawdown: ${status.totalFloatingDrawdownPct}%`
  );
  assert(status.botState === "CIRCUIT_BREAKER_HALT",
    "Bot state transitions to CIRCUIT_BREAKER_HALT on floating drawdown cap breach",
    `Bot State: ${status.botState}`
  );

  // Clear mock open position
  (deltaAutoTraderEngine as any).openPositions = [];

  // ─────────────────────────────────────────────────────────────
  // Test 3: Fix 3 — Per-Trade Risk Floor (respects 1.5% and lower settings)
  // ─────────────────────────────────────────────────────────────
  console.log("\n3. FIX 3: PER-TRADE RISK SIZING RESPECTS USER CONFIGURED SETTINGS");
  (deltaAutoTraderEngine as any).settings.currentCapitalUSD = 1000.0;
  (deltaAutoTraderEngine as any).settings.riskPerTradePct = 1.5; // Configure 1.5% risk

  const lot15 = deltaAutoTraderEngine.calculateDynamicLotSize("BTCUSD", 70000, 1000);
  const actualRiskPct15 = (lot15.initialRiskUSD / lot15.accountEquity) * 100;
  assert(Math.abs(actualRiskPct15 - 1.5) < 0.2,
    "Dynamic Lot Size accurately risks 1.5% without 2.2% forced override",
    `Risk Allowed: $${lot15.initialRiskUSD.toFixed(2)} USD on $${lot15.accountEquity} equity (${actualRiskPct15.toFixed(2)}%)`
  );

  (deltaAutoTraderEngine as any).settings.riskPerTradePct = 1.0; // Configure 1.0% risk
  const lot10 = deltaAutoTraderEngine.calculateDynamicLotSize("BTCUSD", 70000, 1000);
  const actualRiskPct10 = (lot10.initialRiskUSD / lot10.accountEquity) * 100;
  assert(Math.abs(actualRiskPct10 - 1.0) < 0.2,
    "Dynamic Lot Size accurately risks 1.0% without 2.2% forced override",
    `Risk Allowed: $${lot10.initialRiskUSD.toFixed(2)} USD on $${lot10.accountEquity} equity (${actualRiskPct10.toFixed(2)}%)`
  );

  console.log("\n================================================================================");
  console.log(`🏁 SUITE COMPLETE: ${passed} / ${total} TESTS PASSED`);
  console.log("================================================================================");
  process.exit(passed === total ? 0 : 1);
});
