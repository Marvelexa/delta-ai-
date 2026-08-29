async function check() {
  try {
    const res = await fetch("http://localhost:3002/api/autotrader/state");
    console.log("Response status:", res.status);
    const text = await res.text();
    console.log("Response text (first 200 chars):", text.substring(0, 200));
    const data = JSON.parse(text);
    console.log("=== SERVER ON PORT 3002 STATE ===");
    console.log("Bot State:", data.state?.status?.botState);
    console.log("Is Enabled:", data.state?.settings?.isEnabled);
    console.log("Open Positions (" + data.state?.openPositions?.length + "):", data.state?.openPositions?.map((p: any) => `${p.symbol} ${p.type} @ $${p.entryPrice} (Score: ${p.confidenceScore}, EV: +$${p.entryEVUSD})`));
    console.log("Status Inspection:", data.state?.status?.currentInspection);
  } catch (e: any) {
    console.error("Error fetching state:", e.message);
  }
}

check();
