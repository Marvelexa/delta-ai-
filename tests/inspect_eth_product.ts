import dotenv from "dotenv";
dotenv.config();

import { deltaExchangeEngine } from "../lib/deltaExchangeEngine";

async function main() {
  await deltaExchangeEngine.fetchProducts();
  for (const sym of ["BTCUSD", "ETHUSD", "SOLUSD", "XRPUSD", "BNBUSD", "DOGEUSD"]) {
    const p = (deltaExchangeEngine as any).products.get(sym);
    console.log(sym, {
      id: p?.id,
      symbol: p?.symbol,
      contract_value: p?.contract_value,
      contract_unit_currency: p?.contract_unit_currency,
      tick_size: p?.tick_size,
      initial_margin: p?.initial_margin
    });
  }
}

main().catch(console.error);
