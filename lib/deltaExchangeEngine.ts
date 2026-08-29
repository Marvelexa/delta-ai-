import WebSocketWS from "ws";
import nodeCrypto from "crypto";

// Universal WebSocket resolver (Browser window.WebSocket vs Node.js ws)
const getWebSocketClass = (): any => {
  if (typeof window !== "undefined" && (window as any).WebSocket) {
    return (window as any).WebSocket;
  }
  return WebSocketWS;
};

export interface DeltaProduct {
  id: number;
  symbol: string;
  description: string;
  underlying_asset: { symbol: string };
  quoting_asset: { symbol: string };
  product_type: string; // perpetual_futures, call_options, put_options, move_options
  tick_size: string;
  contract_value: string;
  state: string; // live, expired
}

export interface DeltaTicker {
  symbol: string;
  mark_price: string;
  close: string;
  open: string;
  high: string;
  low: string;
  volume: number;
  oi: string; // open interest
  timestamp: number;
  funding_rate?: string;
  turnover_usd?: number;
  leverage?: number;
  quotes?: {
    best_bid: string;
    best_ask: string;
  };
}

export interface DeltaCandle {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

type TickListener = (symbol: string, priceINR: number, priceUSD: number, volume: number) => void;

// ------ Delta Exchange India REST + WebSocket Engine ------

const BASE_URL = "https://api.india.delta.exchange/v2";
const WS_URL = "wss://socket.india.delta.exchange";

class DeltaExchangeEngine {
  private apiKey: string;
  private apiSecret: string;
  private products: Map<string, DeltaProduct> = new Map(); // symbol -> product
  private productIdMap: Map<number, DeltaProduct> = new Map(); // id -> product
  private ws: any = null;
  private isConnected: boolean = false;
  private reconnectAttempts: number = 0;
  private maxReconnectAttempts: number = 20;
  private heartbeatInterval: any = null;
  private reconnectTimer: any = null;
  private tickListeners: TickListener[] = [];
  private usdInrRate: number = 83.50; // Fallback, updated live
  private lastPrices: Map<string, { usd: number; inr: number; volume: number; timestamp: number }> = new Map();

  // Default crypto symbols to track
  private defaultSymbols: string[] = [
    "BTCUSD", "ETHUSD", "SOLUSD", "XRPUSD", "DOGEUSD",
    "BNBUSD", "ADAUSD", "AVAXUSD", "DOTUSD", "LINKUSD",
    "BTCUSDT", "ETHUSDT"
  ];

  public getApiKey(): string {
    if (!this.apiKey && typeof process !== "undefined") {
      this.apiKey = process.env?.DELTA_EXCHANGE_API_KEY || process.env?.VITE_DELTA_EXCHANGE_API_KEY || "";
    }
    return this.apiKey || "";
  }

  public getApiSecret(): string {
    if (!this.apiSecret && typeof process !== "undefined") {
      this.apiSecret = process.env?.DELTA_EXCHANGE_API_SECRET || process.env?.VITE_DELTA_EXCHANGE_API_SECRET || "";
    }
    return this.apiSecret || "";
  }

  constructor() {
    this.apiKey = this.getApiKey();
    this.apiSecret = this.getApiSecret();
    if (this.apiKey) {
      console.log(`[DeltaExchange] 🟢 API Key loaded: ${this.apiKey.slice(0, 8)}...`);
    } else {
      console.warn("[DeltaExchange] ℹ️ DELTA_EXCHANGE_API_KEY not configured. LIVE trading restricted.");
    }
  }

  public setCredentials(apiKey: string, apiSecret: string): void {
    if (apiKey) this.apiKey = apiKey.trim();
    if (apiSecret) this.apiSecret = apiSecret.trim();
    console.log(`[DeltaExchange] 🔑 Credentials updated: ${this.apiKey.slice(0, 8)}...`);
  }

  // ────────────────────────────────────────────
  // HMAC-SHA256 Signature Generation
  // ────────────────────────────────────────────
  private generateSignature(method: string, path: string, queryString: string = "", body: string = ""): { signature: string; timestamp: string } {
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const prehash = method.toUpperCase() + timestamp + path + queryString + body;
    let signature = "UNSUPPORTED_BROWSER_HMAC";
    const secret = this.getApiSecret();
    try {
      if (nodeCrypto && typeof (nodeCrypto as any).createHmac === "function" && secret) {
        signature = (nodeCrypto as any).createHmac("sha256", secret).update(prehash).digest("hex");
      }
    } catch (e) {}
    return { signature, timestamp };
  }

  private getAuthHeaders(method: string, path: string, queryString: string = "", body: string = ""): Record<string, string> {
    const { signature, timestamp } = this.generateSignature(method, path, queryString, body);
    return {
      "api-key": this.getApiKey(),
      "timestamp": timestamp,
      "signature": signature,
      "Content-Type": "application/json",
      "User-Agent": "DeltaExchangeEngine/1.0"
    };
  }

  // ────────────────────────────────────────────
  // USD/INR Rate Fetcher (Live)
  // ────────────────────────────────────────────
  public async fetchUsdInrRate(): Promise<number> {
    try {
      const res = await fetch("https://query2.finance.yahoo.com/v8/finance/chart/USDINR=X?range=1d&interval=1m", {
        headers: { "User-Agent": "Mozilla/5.0" }
      });
      if (res.ok) {
        const json: any = await res.json();
        const rate = json?.chart?.result?.[0]?.meta?.regularMarketPrice;
        if (rate && rate > 50 && rate < 150) {
          this.usdInrRate = Number(rate.toFixed(2));
          console.log(`[DeltaExchange] 💱 USD/INR rate updated: ₹${this.usdInrRate}`);
        }
      }
    } catch (e) {
      // Keep existing fallback rate
    }
    return this.usdInrRate;
  }

  public getUsdInrRate(): number {
    return this.usdInrRate;
  }

  private productsFetchPromise: Promise<DeltaProduct[]> | null = null;

  // ────────────────────────────────────────────
  // REST API: Fetch All Products
  // ────────────────────────────────────────────
  public async fetchProducts(): Promise<DeltaProduct[]> {
    if (this.products.size > 0) {
      return Array.from(this.products.values());
    }
    if (this.productsFetchPromise) {
      return this.productsFetchPromise;
    }

    this.productsFetchPromise = (async () => {
      try {
        const res = await fetch(`${BASE_URL}/products`, {
          headers: { "Content-Type": "application/json", "User-Agent": "DeltaExchangeEngine/1.0" }
        });
        if (!res.ok) {
          console.warn(`[DeltaExchange] ❌ Products fetch failed: HTTP ${res.status}`);
          return [];
        }
        const json: any = await res.json();
        const products: DeltaProduct[] = json?.result || json || [];

        this.products.clear();
        this.productIdMap.clear();
        let count = 0;
        for (const p of products) {
          if (p.state === "live" && p.symbol) {
            this.products.set(p.symbol.toUpperCase(), p);
            this.productIdMap.set(p.id, p);
            count++;
          }
        }
        console.log(`[DeltaExchange] 📦 Loaded ${count} live products from Delta Exchange India`);
        return products.filter(p => p.state === "live");
      } catch (e: any) {
        console.warn(`[DeltaExchange] ❌ Products fetch error: ${e.message}`);
        return [];
      } finally {
        this.productsFetchPromise = null;
      }
    })();

    return this.productsFetchPromise;
  }

  // ────────────────────────────────────────────
  // REST API: Fetch Ticker (Single Symbol)
  // ────────────────────────────────────────────
  public async fetchTicker(symbol: string): Promise<DeltaTicker | null> {
    try {
      const res = await fetch(`${BASE_URL}/tickers/${symbol.toUpperCase()}`, {
        headers: { "Content-Type": "application/json", "User-Agent": "DeltaExchangeEngine/1.0" }
      });
      if (!res.ok) return null;
      const json: any = await res.json();
      const ticker: DeltaTicker = json?.result || json;
      if (ticker && ticker.mark_price) {
        const priceUSD = parseFloat(ticker.mark_price) || parseFloat(ticker.close) || 0;
        const priceINR = Number((priceUSD * this.usdInrRate).toFixed(2));
        this.lastPrices.set(symbol.toUpperCase(), {
          usd: priceUSD,
          inr: priceINR,
          volume: ticker.volume || 0,
          timestamp: Date.now()
        });
        return ticker;
      }
      return null;
    } catch (e) {
      return null;
    }
  }

  // ────────────────────────────────────────────
  // REST API: Fetch All Tickers
  // ────────────────────────────────────────────
  public async fetchAllTickers(): Promise<DeltaTicker[]> {
    try {
      const res = await fetch(`${BASE_URL}/tickers`, {
        headers: { "Content-Type": "application/json", "User-Agent": "DeltaExchangeEngine/1.0" }
      });
      if (!res.ok) return [];
      const json: any = await res.json();
      const tickers: DeltaTicker[] = json?.result || [];
      for (const t of tickers) {
        if (t.symbol && (t.mark_price || t.close)) {
          const priceUSD = parseFloat(t.mark_price) || parseFloat(t.close) || 0;
          if (priceUSD > 0) {
            const priceINR = Number((priceUSD * this.usdInrRate).toFixed(2));
            const symUpper = t.symbol.toUpperCase().trim();
            const cleanTag = symUpper.replace("USDT", "").replace("USD", "").replace("_", "").replace("-", "").trim();
            const rec = {
              usd: priceUSD,
              inr: priceINR,
              volume: t.volume || 0,
              timestamp: Date.now()
            };
            this.lastPrices.set(symUpper, rec);
            this.lastPrices.set(`${cleanTag}USD`, rec);
            this.lastPrices.set(`${cleanTag}USDT`, rec);
            this.lastPrices.set(cleanTag, rec);
          }
        }
      }
      return tickers;
    } catch (e) {
      return [];
    }
  }

  private deltaFailureCount: number = 0;
  private deltaCooldownExpiry: number = 0;

  // ────────────────────────────────────────────
  // REST API: Fetch OHLCV Candles
  // ────────────────────────────────────────────
  public async fetchCandles(symbol: string, resolution: string = "1m", startTime?: number, endTime?: number): Promise<DeltaCandle[]> {
    const now = Math.floor(Date.now() / 1000);
    if (this.deltaCooldownExpiry > now) {
      return [];
    }

    try {
      if (this.products.size === 0) {
        await this.fetchProducts();
      }
      let product = this.products.get(symbol.toUpperCase());
      if (!product) {
        // Fallback: search by symbol or underlying
        const found = Array.from(this.products.values()).find(p => p.symbol?.toUpperCase() === symbol.toUpperCase() || p.underlying_asset?.symbol?.toUpperCase() === symbol.replace("USD", "").toUpperCase());
        if (!found) {
          return [];
        }
        product = found;
      }

      let defaultLookback = 86400 * 2; // 2 days default
      if (resolution === "4h" || resolution === "240") {
        defaultLookback = 86400 * 14; // 14 days for 4h
      } else if (resolution === "1h" || resolution === "60") {
        defaultLookback = 86400 * 5; // 5 days for 1h
      }
      const start = startTime || (now - defaultLookback);
      const end = endTime || now;

      const queryParams = `?symbol=${encodeURIComponent(product.symbol)}&resolution=${resolution}&start=${start}&end=${end}`;
      const res = await fetch(`${BASE_URL}/history/candles${queryParams}`, {
        headers: { "Content-Type": "application/json", "User-Agent": "DeltaExchangeEngine/1.0" }
      });
      if (!res.ok) {
        // Try alternate global endpoint fallback
        const altRes = await fetch(`https://api.delta.exchange/v2/history/candles${queryParams}`, {
          headers: { "Content-Type": "application/json", "User-Agent": "DeltaExchangeEngine/1.0" }
        });
        if (!altRes.ok) {
          this.deltaFailureCount++;
          if (this.deltaFailureCount >= 3) {
            this.deltaCooldownExpiry = now + 60;
            console.warn("[DeltaExchange] ⚠️ 3 consecutive candle fetch failures. Delta REST backoff cooldown active for 60s.");
          }
          return [];
        }
        this.deltaFailureCount = 0;
        const altJson: any = await altRes.json();
        return this.parseCandles(altJson?.result || []);
      }
      this.deltaFailureCount = 0;
      const json: any = await res.json();
      return this.parseCandles(json?.result || []);
    } catch (e) {
      this.deltaFailureCount++;
      if (this.deltaFailureCount >= 3) {
        this.deltaCooldownExpiry = now + 60;
        console.warn("[DeltaExchange] ⚠️ 3 consecutive candle fetch failures. Delta REST backoff cooldown active for 60s.");
      }
      return [];
    }
  }

  private parseCandles(raw: any[]): DeltaCandle[] {
    if (!Array.isArray(raw)) return [];
    const parsed = raw.map((c: any) => ({
      time: c.time || c.t || 0,
      open: parseFloat(c.open || c.o || "0"),
      high: parseFloat(c.high || c.h || "0"),
      low: parseFloat(c.low || c.l || "0"),
      close: parseFloat(c.close || c.c || "0"),
      volume: parseFloat(c.volume || c.v || "0")
    })).filter(c => c.close > 0);
    // ⏰ Ensure candles are strictly sorted in chronological order (oldest -> newest)
    parsed.sort((a, b) => a.time - b.time);
    return parsed;
  }

  // ────────────────────────────────────────────
  // REST API: Authenticated — Wallet Balance
  // ────────────────────────────────────────────
  public async fetchWalletBalance(): Promise<any> {
    try {
      const path = "/v2/wallet/balances";
      const headers = this.getAuthHeaders("GET", path);
      const res = await fetch(`${BASE_URL}/wallet/balances`, { headers });
      if (!res.ok) return null;
      const json: any = await res.json();
      return json?.result || json;
    } catch (e) {
      return null;
    }
  }

  // ────────────────────────────────────────────
  // WebSocket: Live Price Feed
  // ────────────────────────────────────────────
  public connectWebSocket(symbols?: string[]): void {
    if (this.ws && this.isConnected) {
      console.log("[DeltaExchange] WebSocket already connected, skipping...");
      return;
    }

    const subscribeSymbols = symbols || this.defaultSymbols;
    const WSClass = getWebSocketClass();
    if (!WSClass) {
      console.warn("[DeltaExchange] ⚠️ WebSocket class unavailable in current context.");
      return;
    }

    console.log(`[DeltaExchange] 🔌 Connecting WebSocket to ${WS_URL}...`);

    try {
      this.ws = new WSClass(WS_URL);
    } catch (e: any) {
      console.warn(`[DeltaExchange] ❌ WebSocket creation error: ${e?.message || e}`);
      this.scheduleReconnect(subscribeSymbols);
      return;
    }

    const onOpen = () => {
      this.isConnected = true;
      this.reconnectAttempts = 0;
      console.log("[DeltaExchange] 🟢 WebSocket connected successfully!");

      try {
        if (this.ws) {
          this.ws.send(JSON.stringify({ type: "enable_heartbeat" }));
          const subscribePayload = {
            type: "subscribe",
            payload: {
              channels: [{ name: "v2/ticker", symbols: subscribeSymbols }]
            }
          };
          this.ws.send(JSON.stringify(subscribePayload));
          console.log(`[DeltaExchange] 📡 Subscribed to tickers: ${subscribeSymbols.join(", ")}`);
        }
      } catch (e) {}

      if (this.heartbeatInterval) clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = setInterval(() => {
        if (this.ws && this.isConnected) {
          try {
            this.ws.send(JSON.stringify({ type: "ping" }));
          } catch (e) {}
        }
      }, 25000);
    };

    const onMessage = (event: any) => {
      try {
        const raw = typeof event === "string" ? event : (event?.data ? event.data.toString() : (event ? event.toString() : ""));
        if (raw) {
          const msg = JSON.parse(raw);
          this.handleWsMessage(msg);
        }
      } catch (e) {}
    };

    const onClose = () => {
      this.isConnected = false;
      console.log("[DeltaExchange] ⚠️ WebSocket closed.");
      this.scheduleReconnect(subscribeSymbols);
    };

    if (typeof this.ws.on === "function") {
      this.ws.on("open", onOpen);
      this.ws.on("message", onMessage);
      this.ws.on("close", onClose);
      this.ws.on("error", () => {});
    } else {
      this.ws.onopen = onOpen;
      this.ws.onmessage = onMessage;
      this.ws.onclose = onClose;
      this.ws.onerror = () => {};
    }
  }

  private handleWsMessage(msg: any): void {
    // Handle heartbeat
    if (msg.type === "heartbeat" || msg.type === "pong") return;

    // Handle subscription confirmation
    if (msg.type === "subscriptions") {
      console.log("[DeltaExchange] ✅ Subscription confirmed:", JSON.stringify(msg.payload?.channels?.map((c: any) => c.name) || []));
      return;
    }

    // Handle ticker updates
    if (msg.type === "v2/ticker" || msg.type === "ticker") {
      const symbol = msg.symbol || msg.payload?.symbol;
      const markPrice = parseFloat(msg.mark_price || msg.payload?.mark_price || "0");
      const closePrice = parseFloat(msg.close || msg.payload?.close || "0");
      const priceUSD = markPrice > 0 ? markPrice : closePrice;
      const volume = parseFloat(msg.volume || msg.payload?.volume || "0");

      if (symbol && priceUSD > 0) {
        const symUpper = symbol.toUpperCase().trim();
        const cleanTag = symUpper.replace("USDT", "").replace("USD", "").replace("_", "").replace("-", "").trim();
        const priceINR = Number((priceUSD * this.usdInrRate).toFixed(2));
        const record = {
          usd: priceUSD,
          inr: priceINR,
          volume,
          timestamp: Date.now()
        };
        this.lastPrices.set(symUpper, record);
        this.lastPrices.set(`${cleanTag}USD`, record);
        this.lastPrices.set(`${cleanTag}USDT`, record);
        this.lastPrices.set(cleanTag, record);

        // Notify all tick listeners
        for (const listener of this.tickListeners) {
          try {
            listener(symbol, priceINR, priceUSD, volume);
            listener(`${cleanTag}USD`, priceINR, priceUSD, volume);
          } catch (e) {}
        }
      }
    }
  }

  private scheduleReconnect(symbols: string[]): void {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.error("[DeltaExchange] ❌ Max reconnect attempts reached. Giving up WebSocket connection.");
      return;
    }

    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts), 30000); // Exponential backoff, max 30s
    this.reconnectAttempts++;
    console.log(`[DeltaExchange] 🔄 Reconnecting in ${delay / 1000}s (attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts})...`);
    this.reconnectTimer = setTimeout(() => {
      this.connectWebSocket(symbols);
    }, delay);
  }

  // ────────────────────────────────────────────
  // Tick Listener Management
  // ────────────────────────────────────────────
  public onTick(listener: TickListener): void {
    this.tickListeners.push(listener);
  }

  public removeTick(listener: TickListener): void {
    this.tickListeners = this.tickListeners.filter(l => l !== listener);
  }

  // ────────────────────────────────────────────
  // Price Accessors
  // ────────────────────────────────────────────
  public getLivePrice(symbol: string): { usd: number; inr: number; volume: number; timestamp: number } | null {
    if (!symbol) return null;
    const symUpper = symbol.toUpperCase().trim();
    const cleanTag = symUpper.replace("USDT", "").replace("USD", "").replace("_", "").replace("-", "").trim();
    return this.lastPrices.get(symUpper)
      || this.lastPrices.get(`${cleanTag}USD`)
      || this.lastPrices.get(`${cleanTag}USDT`)
      || this.lastPrices.get(cleanTag)
      || null;
  }

  public getAllPrices(): Map<string, { usd: number; inr: number; volume: number; timestamp: number }> {
    return this.lastPrices;
  }

  public isWsConnected(): boolean {
    return this.isConnected;
  }

  public roundToTickSize(price: number, tickSizeStr: string | number): string {
    const tickSize = typeof tickSizeStr === "string" ? parseFloat(tickSizeStr) : tickSizeStr;
    if (!tickSize || isNaN(tickSize) || tickSize <= 0) return price.toFixed(2);
    const rounded = Math.round(price / tickSize) * tickSize;
    const str = tickSizeStr.toString();
    const decimals = str.includes(".") ? str.split(".")[1].length : 0;
    return rounded.toFixed(decimals);
  }

  public async fetchOpenOrders(productId?: number): Promise<any[]> {
    const key = this.getApiKey();
    const secret = this.getApiSecret();
    if (!key || !secret) return [];
    try {
      const path = productId ? `/v2/orders?state=open&product_id=${productId}` : `/v2/orders?state=open`;
      const headers = this.getAuthHeaders("GET", path, "");
      const res = await fetch(`https://api.india.delta.exchange${path}`, {
        method: "GET",
        headers: { "Content-Type": "application/json", ...headers }
      });
      const data = await res.json();
      return (data && data.success && Array.isArray(data.result)) ? data.result : [];
    } catch (err) {
      console.error("[DeltaExchange] Error fetching open orders:", err);
      return [];
    }
  }

  public async placeOrder(
    symbol: string,
    side: "buy" | "sell",
    size: number,
    price?: number,
    stopLossPrice?: number,
    takeProfitPrice?: number
  ): Promise<any> {
    const key = this.getApiKey();
    const secret = this.getApiSecret();
    if (!key || !secret) {
      console.warn("[DeltaExchange] ⚠️ Cannot place live order: DELTA_EXCHANGE_API_KEY environment variables missing.");
      return { success: false, message: "Delta Exchange API Key missing." };
    }
    try {
      if (this.products.size === 0) {
        await this.fetchProducts();
      }
      const symUpper = (symbol || "").toUpperCase().trim();
      const cleanTag = symUpper.replace("USDT", "").replace("USD", "").replace("-", "").trim();
      let product = this.products.get(symUpper)
        || this.products.get(`${cleanTag}USD`)
        || this.products.get(`${cleanTag}USDT`)
        || Array.from(this.products.values()).find(p => p.symbol?.toUpperCase() === symUpper || p.symbol?.toUpperCase() === `${cleanTag}USD` || p.symbol?.toUpperCase() === `${cleanTag}USDT`);

      if (!product) {
        throw new Error(`Product not loaded for ${symbol}. Call fetchProducts() first.`);
      }
      const productId = product.id;
      const tickSize = (product as any)?.tick_size || "0.01";
      const contractsSize = Math.max(1, Math.round(size));

      const path = "/v2/orders";
      const bodyData: any = {
        product_id: productId,
        size: contractsSize,
        side: side.toLowerCase(),
        order_type: price ? "limit_order" : "market_order"
      };
      if (price) {
        bodyData.limit_price = this.roundToTickSize(price, tickSize);
      }
      if (stopLossPrice && !isNaN(stopLossPrice) && stopLossPrice > 0) {
        bodyData.bracket_stop_loss_price = this.roundToTickSize(stopLossPrice, tickSize);
        bodyData.bracket_stop_trigger_method = "last_traded_price";
      }
      if (takeProfitPrice && !isNaN(takeProfitPrice) && takeProfitPrice > 0) {
        bodyData.bracket_take_profit_price = this.roundToTickSize(takeProfitPrice, tickSize);
        bodyData.bracket_stop_trigger_method = "last_traded_price";
      }
      const bodyStr = JSON.stringify(bodyData);
      const headers = this.getAuthHeaders("POST", path, "", bodyStr);

      const response = await fetch(`https://api.india.delta.exchange${path}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...headers
        },
        body: bodyStr
      });
      const data = await response.json();
      if (data && data.error) {
        console.error(`[DeltaExchange] ❌ DELTA EXCHANGE ORDER REJECTED:`, JSON.stringify(data.error));
        // Learn margin mode from rejection context
        if (data.error?.code === "trading_not_allowed_on_current_margin_mode" && data.error?.context) {
          const ctx = data.error.context;
          if (ctx.current_margin_mode) this.cachedMarginMode = ctx.current_margin_mode;
          if (ctx.enabled_pf_asset_symbols && Array.isArray(ctx.enabled_pf_asset_symbols)) {
            this.cachedEnabledAssets = ctx.enabled_pf_asset_symbols;
            this.marginModeCheckedAt = Date.now();
            console.log(`[DeltaExchange] 📊 Learned Margin Mode from rejection: ${this.cachedMarginMode}, Enabled: [${this.cachedEnabledAssets.join(", ")}]`);
          }
        }
      } else {
        console.log(`[DeltaExchange] 🚀 Live Order Placed on Delta Exchange: ${side} ${contractsSize} contracts (${size} ${symbol}) [SL: ${stopLossPrice || "None"}, TP: ${takeProfitPrice || "None"}]`, data);
      }
      return data;
    } catch (err) {
      console.error("[DeltaExchange] Order placement error:", err);
      return { success: false, error: err };
    }
  }

  public async setBracketOrder(
    symbol: string,
    stopLossPrice?: number,
    takeProfitPrice?: number
  ): Promise<any> {
    const key = this.getApiKey();
    const secret = this.getApiSecret();
    if (!key || !secret) {
      return { success: false, message: "Delta Exchange API Key missing." };
    }
    try {
      if (this.products.size === 0) {
        await this.fetchProducts();
      }
      const symUpper = (symbol || "").toUpperCase().trim();
      const cleanTag = symUpper.replace("USDT", "").replace("USD", "").replace("-", "").trim();
      let product = this.products.get(symUpper)
        || this.products.get(`${cleanTag}USD`)
        || this.products.get(`${cleanTag}USDT`)
        || Array.from(this.products.values()).find(p => p.symbol?.toUpperCase() === symUpper || p.symbol?.toUpperCase() === `${cleanTag}USD` || p.symbol?.toUpperCase() === `${cleanTag}USDT`);

      if (!product) {
        throw new Error(`Product not loaded for ${symbol}. Call fetchProducts() first.`);
      }
      const productId = product.id;
      const tickSize = (product as any)?.tick_size || "0.01";
      const path = "/v2/orders/bracket";
      const bodyData: any = {
        product_id: productId,
        product_symbol: product?.symbol || symUpper,
        bracket_stop_trigger_method: "last_traded_price"
      };

      if (stopLossPrice && !isNaN(stopLossPrice) && stopLossPrice > 0) {
        bodyData.stop_loss_order = {
          order_type: "market_order",
          stop_price: this.roundToTickSize(stopLossPrice, tickSize)
        };
      }
      if (takeProfitPrice && !isNaN(takeProfitPrice) && takeProfitPrice > 0) {
        bodyData.take_profit_order = {
          order_type: "market_order",
          stop_price: this.roundToTickSize(takeProfitPrice, tickSize)
        };
      }

      const bodyStr = JSON.stringify(bodyData);
      const headers = this.getAuthHeaders("POST", path, "", bodyStr);

      const response = await fetch(`https://api.india.delta.exchange${path}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...headers
        },
        body: bodyStr
      });
      const data = await response.json();
      console.log(`[DeltaExchange] 🎯 Native Bracket Order set on ${symbol}: SL=$${stopLossPrice}, TP=$${takeProfitPrice}`, data);
      return data;
    } catch (err) {
      console.error("[DeltaExchange] Bracket order error:", err);
      return { success: false, error: err };
    }
  }

  public async updateBracketOrder(
    symbol: string,
    stopLossPrice?: number,
    takeProfitPrice?: number
  ): Promise<any> {
    const key = this.getApiKey();
    const secret = this.getApiSecret();
    if (!key || !secret) {
      return { success: false, message: "Delta Exchange API Key missing." };
    }
    try {
      if (this.products.size === 0) {
        await this.fetchProducts();
      }
      const symUpper = (symbol || "").toUpperCase().trim();
      const cleanTag = symUpper.replace("USDT", "").replace("USD", "").replace("-", "").trim();
      let product = this.products.get(symUpper)
        || this.products.get(`${cleanTag}USD`)
        || this.products.get(`${cleanTag}USDT`)
        || Array.from(this.products.values()).find(p => p.symbol?.toUpperCase() === symUpper || p.symbol?.toUpperCase() === `${cleanTag}USD` || p.symbol?.toUpperCase() === `${cleanTag}USDT`);

      if (!product) {
        throw new Error(`Product not loaded for ${symbol}. Call fetchProducts() first.`);
      }
      const productId = product.id;
      const tickSize = (product as any)?.tick_size || "0.01";

      // 1. Fetch current open conditional / bracket orders from Delta Exchange
      const listPath = `/v2/orders?state=open&product_id=${productId}`;
      const listHeaders = this.getAuthHeaders("GET", listPath, "");
      const listRes = await fetch(`https://api.india.delta.exchange${listPath}`, {
        method: "GET",
        headers: { "Content-Type": "application/json", ...listHeaders }
      });
      const listData = await listRes.json();
      const openOrders: any[] = (listData && listData.success && Array.isArray(listData.result)) ? listData.result : [];

      let slUpdated = false;
      let tpUpdated = false;

      // 2. Modify active Stop Loss Order if price changed
      if (stopLossPrice && !isNaN(stopLossPrice) && stopLossPrice > 0) {
        const slOrder = openOrders.find(o => o.stop_order_type === "stop_loss_order");
        if (slOrder && slOrder.id) {
          const modPath = "/v2/orders";
          const modBody = JSON.stringify({
            id: slOrder.id,
            product_id: productId,
            stop_price: this.roundToTickSize(stopLossPrice, tickSize)
          });
          const modHeaders = this.getAuthHeaders("PUT", modPath, "", modBody);
          const modRes = await fetch(`https://api.india.delta.exchange${modPath}`, {
            method: "PUT",
            headers: { "Content-Type": "application/json", ...modHeaders },
            body: modBody
          });
          const modData = await modRes.json();
          if (modData.success) {
            console.log(`[DeltaExchange] 🎯 LIVE EXCHANGE STOP-LOSS MODIFIED: ${symbol} SL updated to $${stopLossPrice} on Delta Exchange! (Order ID: ${slOrder.id})`);
            slUpdated = true;
          }
        }
      }

      // 3. Modify active Take Profit Order if price changed
      if (takeProfitPrice && !isNaN(takeProfitPrice) && takeProfitPrice > 0) {
        const tpOrder = openOrders.find(o => o.stop_order_type === "take_profit_order");
        if (tpOrder && tpOrder.id) {
          const modPath = "/v2/orders";
          const modBody = JSON.stringify({
            id: tpOrder.id,
            product_id: productId,
            stop_price: this.roundToTickSize(takeProfitPrice, tickSize)
          });
          const modHeaders = this.getAuthHeaders("PUT", modPath, "", modBody);
          const modRes = await fetch(`https://api.india.delta.exchange${modPath}`, {
            method: "PUT",
            headers: { "Content-Type": "application/json", ...modHeaders },
            body: modBody
          });
          const modData = await modRes.json();
          if (modData.success) {
            console.log(`[DeltaExchange] 🎯 LIVE EXCHANGE TAKE-PROFIT MODIFIED: ${symbol} TP updated to $${takeProfitPrice} on Delta Exchange! (Order ID: ${tpOrder.id})`);
            tpUpdated = true;
          }
        }
      }

      // 4. Fallback if no open bracket orders existed yet
      if (!slUpdated && !tpUpdated && openOrders.length === 0) {
        return await this.setBracketOrder(symbol, stopLossPrice, takeProfitPrice);
      }

      return { success: true, slUpdated, tpUpdated };
    } catch (err) {
      console.error("[DeltaExchange] Bracket order update error:", err);
      return { success: false, error: err };
    }
  }

  public async cancelBracketOrder(symbol: string): Promise<any> {
    const key = this.getApiKey();
    const secret = this.getApiSecret();
    if (!key || !secret) {
      return { success: false, message: "Delta Exchange API Key missing." };
    }
    try {
      if (this.products.size === 0) {
        await this.fetchProducts();
      }
      const symUpper = (symbol || "").toUpperCase().trim();
      const cleanTag = symUpper.replace("USDT", "").replace("USD", "").replace("-", "").trim();
      let product = this.products.get(symUpper)
        || this.products.get(`${cleanTag}USD`)
        || this.products.get(`${cleanTag}USDT`)
        || Array.from(this.products.values()).find(p => p.symbol?.toUpperCase() === symUpper || p.symbol?.toUpperCase() === `${cleanTag}USD` || p.symbol?.toUpperCase() === `${cleanTag}USDT`);

      if (!product) {
        throw new Error(`Product not loaded for ${symbol}. Call fetchProducts() first.`);
      }
      const productId = product.id;
      const path = "/v2/orders/bracket";
      const bodyData: any = {
        product_id: productId
      };
      const bodyStr = JSON.stringify(bodyData);
      const headers = this.getAuthHeaders("DELETE", path, "", bodyStr);

      const response = await fetch(`https://api.india.delta.exchange${path}`, {
        method: "DELETE",
        headers: {
          "Content-Type": "application/json",
          ...headers
        },
        body: bodyStr
      });
      return await response.json();
    } catch (e) {
      return { success: false, error: e };
    }
  }

  public async fetchLivePositions(): Promise<any[]> {
    const key = this.getApiKey();
    const secret = this.getApiSecret();
    if (!key || !secret) {
      return [];
    }
    try {
      const path = "/v2/positions/margined";
      const headers = this.getAuthHeaders("GET", path, "");
      const response = await fetch(`https://api.india.delta.exchange${path}`, {
        headers: {
          "Content-Type": "application/json",
          ...headers
        }
      });
      const data: any = await response.json();
      if (data?.success && Array.isArray(data?.result)) {
        return data.result.filter((p: any) => p.size !== 0);
      }
      return [];
    } catch (e) {
      console.warn("[DeltaExchange] Error fetching live positions:", e);
      return [];
    }
  }

  public getProductBySymbol(symbol: string): DeltaProduct | undefined {
    return this.products.get(symbol.toUpperCase());
  }

  public getAllProducts(): DeltaProduct[] {
    return Array.from(this.products.values());
  }

  public getDefaultSymbols(): string[] {
    return [...this.defaultSymbols];
  }

  // ────────────────────────────────────────────
  // Bootstrap: Initialize Everything
  // ────────────────────────────────────────────
  public async initialize(): Promise<void> {
    console.log("[DeltaExchange] 🚀 Initializing Delta Exchange Engine...");
    if (!this.apiKey && typeof process !== "undefined") {
      const envKey = process.env?.DELTA_EXCHANGE_API_KEY || process.env?.VITE_DELTA_EXCHANGE_API_KEY || "";
      const envSecret = process.env?.DELTA_EXCHANGE_API_SECRET || process.env?.VITE_DELTA_EXCHANGE_API_SECRET || "";
      if (envKey) {
        this.apiKey = envKey.trim();
        this.apiSecret = envSecret.trim();
        console.log(`[DeltaExchange] 🟢 Live API Credentials connected: ${this.apiKey.slice(0, 8)}...`);
      }
    }
    await this.fetchUsdInrRate();
    await this.fetchProducts();
    this.connectWebSocket();

    // Refresh USD/INR rate every 5 minutes
    setInterval(() => {
      this.fetchUsdInrRate().catch(() => {});
    }, 5 * 60 * 1000);

    // REST fallback ticker poll every 10 seconds (in case WS misses)
    setInterval(async () => {
      if (!this.isConnected) {
        // WS is down, use REST as fallback
        for (const sym of this.defaultSymbols) {
          const ticker = await this.fetchTicker(sym);
          if (ticker) {
            const priceUSD = parseFloat(ticker.mark_price || ticker.close || "0");
            const priceINR = Number((priceUSD * this.usdInrRate).toFixed(2));
            if (priceUSD > 0) {
              for (const listener of this.tickListeners) {
                try {
                  listener(sym, priceINR, priceUSD, ticker.volume || 0);
                } catch (e) {}
              }
            }
          }
        }
      }
    }, 10000);

    console.log("[DeltaExchange] ✅ Delta Exchange Engine initialized!");
  }

  public async getAccountSummary(): Promise<{ netEquityUSD: number; availableBalanceUSD: number; isLive: boolean }> {
    try {
      const balances = await this.fetchWalletBalance();
      const equity = balances?.meta?.net_equity ? parseFloat(balances.meta.net_equity) : 0;
      if (equity > 0) {
        return { netEquityUSD: equity, availableBalanceUSD: equity, isLive: Boolean(this.apiKey && this.apiKey.length > 5) };
      }
    } catch (e) {
      console.warn("[DeltaExchange] getAccountSummary fetch failed:", e);
    }
    return { netEquityUSD: 0, availableBalanceUSD: 0, isLive: Boolean(this.apiKey && this.apiKey.length > 5) };
  }

  // ────────────────────────────────────────────
  // MARGIN MODE MANAGEMENT
  // ────────────────────────────────────────────
  private cachedMarginMode: string = "";
  private cachedEnabledAssets: string[] = [];
  private marginModeCheckedAt: number = 0;

  /**
   * Fetch current margin mode from Delta Exchange.
   * Returns { margin_mode: "portfolio"|"isolated", enabled_pf_asset_symbols: string[] }
   */
  public async getMarginMode(): Promise<{ margin_mode: string; enabled_pf_asset_symbols: string[] }> {
    // Cache for 5 minutes to avoid spamming
    if (this.cachedMarginMode && this.cachedEnabledAssets.length > 0 && (Date.now() - this.marginModeCheckedAt < 300_000)) {
      return { margin_mode: this.cachedMarginMode, enabled_pf_asset_symbols: this.cachedEnabledAssets };
    }
    const key = this.getApiKey();
    const secret = this.getApiSecret();
    if (!key || !secret) {
      return { margin_mode: "isolated", enabled_pf_asset_symbols: [] };
    }
    try {
      // Try /v2/profile first
      const path = "/v2/profile";
      const headers = this.getAuthHeaders("GET", path, "");
      const res = await fetch(`https://api.india.delta.exchange${path}`, {
        method: "GET",
        headers
      });
      const data = await res.json();
      const profile = data?.result || data;
      const mode = profile?.margin_mode || "";
      const enabledAssets: string[] = profile?.enabled_pf_asset_symbols || profile?.pf_enabled_assets || [];
      
      if (mode) {
        this.cachedMarginMode = mode;
        if (enabledAssets.length > 0) {
          this.cachedEnabledAssets = enabledAssets;
        }
        this.marginModeCheckedAt = Date.now();
        console.log(`[DeltaExchange] 📊 Margin Mode: ${mode}, Enabled Assets: [${this.cachedEnabledAssets.join(", ")}]`);
      }
      
      // If we know it's portfolio mode but don't know which assets, 
      // default to BTC+ETH (the most common portfolio margin pair on Delta Exchange India)
      if (this.cachedMarginMode === "portfolio" && this.cachedEnabledAssets.length === 0) {
        this.cachedEnabledAssets = ["BTC", "ETH"];
        console.log(`[DeltaExchange] ⚠️ Portfolio mode detected, defaulting enabled assets to: [BTC, ETH]`);
      }
      
      return { margin_mode: this.cachedMarginMode || "isolated", enabled_pf_asset_symbols: this.cachedEnabledAssets };
    } catch (e) {
      console.error("[DeltaExchange] Error fetching margin mode:", e);
      return { margin_mode: this.cachedMarginMode || "isolated", enabled_pf_asset_symbols: this.cachedEnabledAssets };
    }
  }

  /**
   * Change margin mode to "isolated" or "portfolio".
   * REQUIRES: No open positions or pending orders on the account.
   */
  public async changeMarginMode(newMode: "isolated" | "portfolio"): Promise<{ success: boolean; message: string }> {
    const key = this.getApiKey();
    const secret = this.getApiSecret();
    if (!key || !secret) {
      return { success: false, message: "API credentials missing." };
    }
    try {
      const path = "/v2/users/margin_mode";
      const bodyData = { margin_mode: newMode };
      const bodyStr = JSON.stringify(bodyData);
      const headers = this.getAuthHeaders("PUT", path, "", bodyStr);
      const res = await fetch(`https://api.india.delta.exchange${path}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", ...headers },
        body: bodyStr
      });
      const data = await res.json();
      if (data?.error) {
        console.error(`[DeltaExchange] ❌ Margin mode change failed:`, JSON.stringify(data.error));
        return { success: false, message: JSON.stringify(data.error) };
      }
      this.cachedMarginMode = newMode;
      this.marginModeCheckedAt = Date.now();
      console.log(`[DeltaExchange] ✅ Margin mode changed to: ${newMode}`);
      return { success: true, message: `Margin mode changed to ${newMode}` };
    } catch (e) {
      console.error("[DeltaExchange] Margin mode change error:", e);
      return { success: false, message: String(e) };
    }
  }

  /**
   * Check if a specific coin symbol is tradeable under the current margin mode.
   * In portfolio mode, only enabled_pf_asset_symbols can trade.
   * In isolated mode, all coins can trade.
   */
  public isAssetTradeable(symbol: string): boolean {
    const coinTag = symbol.toUpperCase().replace("USDT", "").replace("USD", "").replace("-", "").trim();
    if (this.cachedMarginMode === "portfolio") {
      return this.cachedEnabledAssets.some(a => a.toUpperCase() === coinTag);
    }
    return true; // Isolated mode allows all
  }

  /**
   * Get the list of tradeable asset symbols (e.g. ["BTCUSD", "ETHUSD"]) based on current margin mode.
   */
  public getTradeableSymbols(allSymbols: string[]): string[] {
    if (this.cachedMarginMode !== "portfolio" || this.cachedEnabledAssets.length === 0) {
      return allSymbols; // isolated mode = all tradeable
    }
    return allSymbols.filter(sym => {
      const tag = sym.toUpperCase().replace("USDT", "").replace("USD", "").replace("-", "").trim();
      return this.cachedEnabledAssets.some(a => a.toUpperCase() === tag);
    });
  }

  public disconnectWebSocket(): void {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.ws) {
      try {
        this.ws.close();
      } catch (e) {}
      this.ws = null;
    }
    this.isConnected = false;
    console.log("[DeltaExchange] 🔴 WebSocket disconnected.");
  }
}

export const deltaExchangeEngine = new DeltaExchangeEngine();
