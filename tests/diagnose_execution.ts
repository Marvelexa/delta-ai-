import { deltaAutoTraderEngine, CURATED_AUTO_TRADER_ASSETS } from "../lib/deltaAutoTraderEngine";
import { deltaExchangeEngine } from "../lib/deltaExchangeEngine";

async function main() {
  console.log("================================================================================");
  console.log("🔍 DIAGNOSING DELTA AUTO-TRADER EXECUTION & LIVE STATE");
  console.log("================================================================================\n");

  const state = deltaAutoTraderEngine.getLiveFullState();
  console.log("1. Settings:");
  console.log("   - isEnabled:", state.settings.isEnabled);
  console.log("   - mode:", state.settings.mode);
  console.log("   - minConfidenceThreshold:", state.settings.minConfidenceThreshold);
  console.log("   - maxConcurrentPositions:", state.settings.maxConcurrentPositions);
  console.log("   - tradesTakenToday:", state.status.tradesTakenToday, "/", state.settings.maxTradesPerDay);
  console.log("   - maxDailyLossPct:", state.settings.maxDailyLossPct);
  console.log("   - riskPerTradePct:", state.settings.riskPerTradePct);
  console.log("   - inspectionWindowMinutes:", state.settings.inspectionWindowMinutes);
  
  console.log("\n2. Status & Circuit Breakers:");
  console.log("   - botState:", state.status.botState);
  console.log("   - circuitBreakerActive:", state.status.circuitBreakerActive);
  console.log("   - consecutiveLossCount:", state.status.consecutiveLossCount);
  console.log("   - todayPnLUSD:", state.status.todayPnLUSD);
  console.log("   - totalFloatingDrawdownPct:", state.status.totalFloatingDrawdownPct);
  console.log("   - cooldownRemainingMins:", state.status.cooldownRemainingMins);
  console.log("   - openPositions count:", state.openPositions.length);
  if (state.openPositions.length > 0) {
    console.log("   - Open Positions:", state.openPositions.map(p => `${p.symbol} ${p.type} @ $${p.entryPrice} (PnL: $${p.unrealizedPnLUSD})`));
  }

  console.log("\n3. Current Inspection State:");
  console.log("   - currentInspection:", state.status.currentInspection);

  console.log("\n4. Running Live Multi-Asset Radar Scan across all 10 assets...");
  for (const asset of CURATED_AUTO_TRADER_ASSETS) {
    const [c15, c1h, c4h] = await Promise.all([
      deltaAutoTraderEngine.fetchCryptoCandles(asset.symbol, "15m", 30),
      deltaAutoTraderEngine.fetchCryptoCandles(asset.symbol, "1h", 30),
      deltaAutoTraderEngine.fetchCryptoCandles(asset.symbol, "4h", 30)
    ]);
    const analysis = deltaAutoTraderEngine.analyzeMultiTimeframe(asset.symbol, c15, c1h, c4h);
    console.log(`   🪙 ${asset.symbol.padEnd(8)}: Score=${String(analysis.overallScore).padStart(2)}/100, Dir=${analysis.direction.padEnd(7)}, isEntryValid=${analysis.isEntryValid}, EV=$${analysis.expectedValueUSD}, Candles=(15m:${c15.length}, 1h:${c1h.length}, 4h:${c4h.length})`);
    if (!analysis.isEntryValid) {
      console.log(`      ↳ Filtered Reason: ${analysis.reasoning}`);
    }
  }

  console.log("\n5. Testing Instant Execution Scan (scanAndExecuteNextTrade(true))...");
  const scanRes = await deltaAutoTraderEngine.scanAndExecuteNextTrade(true);
  console.log("   - Result:", scanRes);
}

main().catch(console.error);
