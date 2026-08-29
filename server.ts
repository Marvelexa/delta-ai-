import "dotenv/config";
import express from "express";
import path from "path";
import { pathToFileURL } from "url";
import { createServer as createViteServer } from "vite";
import AdmZip from "adm-zip";
import { WebSocketServer, WebSocket } from "ws";
import { brokerTickEngine } from "./lib/brokerTickEngine.js";
import { deltaAutoTraderEngine, CURATED_AUTO_TRADER_ASSETS, EXIT_MONITORING_INTERVAL_MS, NEW_ENTRY_SCAN_INTERVAL_MS } from "./lib/deltaAutoTraderEngine.js";
import { deltaExchangeEngine } from "./lib/deltaExchangeEngine.js";

import fs from "fs";
import { authEngine } from "./lib/authEngine.js";
import { getCitiesForLocation } from "./lib/cityDatabase.js";
import { ScraperEngine, LeadData } from "./lib/ScraperEngine.js";

// ... existing code ...
import dotenv from "dotenv";
import { GoogleGenAI } from "@google/genai";
import { websiteAnalyzer } from "./lib/websiteAnalyzer.js";
import { checkpointManager } from "./lib/checkpointManager.js";

dotenv.config();

// Force Playwright to use a local write-accessible directory for browser storage if not pre-defined (e.g., in Docker)
if (!process.env.PLAYWRIGHT_BROWSERS_PATH) {
  process.env.PLAYWRIGHT_BROWSERS_PATH = path.join(process.cwd(), ".playwright-browsers");
}

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

const ICON_LIBRARY: Record<string, string> = {
  coffee: `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-coffee"><path d="M10 2v2"/><path d="M14 2v2"/><path d="M16 8a1 1 0 0 1 1 1v8a4 4 0 0 1-4 4H6a4 4 0 0 1-4-4V9a1 1 0 0 1 1-1h13Z"/><path d="M18 8h1a4 4 0 0 1 0 8h-1"/></svg>`,
  utensils: `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-utensils"><path d="M3 2v7c0 1.1.9 2 2 2h4a2 2 0 0 0 2-2V2"/><path d="M7 2v20"/><path d="M21 15V2v0a5 5 0 0 0-5 5v6c0 1.1.9 2 2 2h3Z"/><path d="M19 15v7"/></svg>`,
  sparkles: `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-sparkles"><path d="m12 3-1.912 5.813a2 2 0 0 1-1.275 1.275L3 12l5.813 1.912a2 2 0 0 1 1.275 1.275L12 21l1.912-5.813a2 2 0 0 1 1.275-1.275L21 12l-5.813-1.912a2 2 0 0 1-1.275-1.275L12 3Z"/></svg>`,
  star: `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-star"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>`,
  shoppingbag: `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-shopping-bag"><path d="M6 2L3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z"/><line x1="3" y1="6" x2="21" y2="6"/><path d="M16 10a4 4 0 0 1-8 0"/></svg>`,
  zap: `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-zap"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>`,
  laptop: `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-laptop"><rect x="2" y="3" width="20" height="14" rx="2" ry="2"/><line x1="2" y1="20" x2="22" y2="20"/><line x1="12" y1="20" x2="12" y2="17"/></svg>`,
  activity: `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-activity"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>`,
  heart: `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-heart"><path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z"/></svg>`,
  dumbbell: `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-dumbbell"><path d="M14.4 14.4 9.6 9.6"/><path d="M18.657 21.485a2 2 0 1 1-2.829-2.828l-1.767-1.768a2 2 0 1 1-2.829-2.829l-1.768-1.767a2 2 0 1 1-2.828-2.829l-1.768-1.768a2 2 0 1 1-2.828-2.828l2.828-2.829a2 2 0 1 1 2.829 2.828l1.767 1.768a2 2 0 1 1 2.829 2.829l1.768 1.767a2 2 0 1 1 2.828 2.829l1.768 1.768a2 2 0 1 1 2.828 2.828l-2.828 2.829Z"/><path d="m21.5 2.5-19 19"/></svg>`,
  home: `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-home"><path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>`,
  dollarsign: `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-dollar-sign"><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>`,
  shield: `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-shield"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>`,
  scissors: `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-scissors"><circle cx="6" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><line x1="9.8" y1="8.2" x2="21" y2="19"/><line x1="9.8" y1="15.8" x2="21" y2="5"/></svg>`,
  graduationcap: `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-graduation-cap"><path d="M22 10v6M2 10l10-5 10 5-10 5z"/><path d="M6 12v5c0 2 2 3 6 3s6-1 6-3v-5"/></svg>`,
  plane: `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-plane"><path d="M17.8 19.2 16 11l3.5-3.5C21 6 21.5 4 21 3c-1-.5-3 0-4.5 1.5L13 8 4.8 6.2c-.5-.1-.9.1-1.1.5l-.3.5c-.2.5-.1 1 .3 1.3L9 12l-4 4H3l-1.7 3 2.7-.3 3.5 1.2.7-1.2-1-2.5 5.5-3.5 4.5 4.5c.3.3.8.4 1.3.2l.5-.3c.4-.2.6-.6.5-1.1Z"/></svg>`,
  scale: `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-scale"><path d="m16 16 3-8 3 8c-.2.2-2.7 1-6 0Z"/><path d="m2 16 3-8 3 8c-.2.2-2.7 1-6 0Z"/><path d="M7 21h10"/><path d="M12 3v18"/><path d="M3 7h18"/></svg>`,
  wrench: `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-wrench"><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/></svg>`,
  bed: `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-bed"><path d="M2 4v16"/><path d="M2 8h18a2 2 0 0 1 2 2v10"/><path d="M2 17h20"/><path d="M6 8v9"/></svg>`,
  users: `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-users"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>`,
  clock: `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-clock"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>`,
  thumbsup: `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-thumbs-up"><path d="M7 10v12"/><path d="M15 5.88 14 10h5.83a2 2 0 0 1 1.92 2.56l-2.33 8A2 2 0 0 1 17.5 22H4a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2h3l3.15-7.15a1 1 0 0 1 1.57.16l2.28 2.87Z"/></svg>`,
  award: `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-award"><circle cx="12" cy="8" r="7"/><polyline points="8.21 13.89 7 23 12 20 17 23 15.79 13.88"/></svg>`,
  checkcircle: `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-check-circle"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>`,
  smile: `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-smile"><circle cx="12" cy="12" r="10"/><path d="M8 14s1.5 2 4 2 4-2 4-2"/><line x1="9" y1="9" x2="9.01" y2="9"/><line x1="15" y1="9" x2="15.01" y2="9"/></svg>`
};

function getIconSvg(iconInput: string): string {
  if (!iconInput) {
    return ICON_LIBRARY.sparkles;
  }
  const clean = iconInput.trim();
  if (clean.startsWith("<svg") || clean.startsWith("<SVG")) {
    return clean;
  }
  const key = clean.toLowerCase().replace(/[^a-z0-9]/g, "");
  if (ICON_LIBRARY[key]) {
    return ICON_LIBRARY[key];
  }
  // Search for substrings
  for (const [libraryKey, svg] of Object.entries(ICON_LIBRARY)) {
    if (key.includes(libraryKey) || libraryKey.includes(key)) {
      return svg;
    }
  }
  // Fallbacks based on common terms
  if (key.includes("cup") || key.includes("mug") || key.includes("drink")) return ICON_LIBRARY.coffee;
  if (key.includes("food") || key.includes("plate") || key.includes("cook")) return ICON_LIBRARY.utensils;
  if (key.includes("clinic") || key.includes("doctor") || key.includes("medical") || key.includes("dentist")) return ICON_LIBRARY.activity;
  if (key.includes("health") || key.includes("love")) return ICON_LIBRARY.heart;
  if (key.includes("fit") || key.includes("train")) return ICON_LIBRARY.dumbbell;
  if (key.includes("shop") || key.includes("store") || key.includes("buy")) return ICON_LIBRARY.shoppingbag;
  if (key.includes("tech") || key.includes("ai") || key.includes("code") || key.includes("program")) return ICON_LIBRARY.laptop;
  if (key.includes("money") || key.includes("price") || key.includes("cost")) return ICON_LIBRARY.dollarsign;
  if (key.includes("tool") || key.includes("fix") || key.includes("car") || key.includes("repair")) return ICON_LIBRARY.wrench;
  if (key.includes("people") || key.includes("client")) return ICON_LIBRARY.users;
  if (key.includes("time") || key.includes("speed")) return ICON_LIBRARY.clock;
  if (key.includes("badge") || key.includes("quality")) return ICON_LIBRARY.award;
  if (key.includes("trust") || key.includes("secure")) return ICON_LIBRARY.shield;

  return ICON_LIBRARY.sparkles;
}

function isEcommerceNiche(categoryStr: string, finalNiche?: string): boolean {
  const cat = (categoryStr || "").toLowerCase();
  const niche = (finalNiche || "").toLowerCase();
  return (
    cat.includes("clothing") ||
    cat.includes("fashion") ||
    cat.includes("apparel") ||
    cat.includes("boutique") ||
    cat.includes("shop") ||
    cat.includes("store") ||
    niche === "retail"
  );
}

async function launchBrowser(options?: any) {
  const { chromium } = await import("playwright");
  const launchOptions = options || {
    headless: true,
    args: [
      "--disable-gpu",
      "--disable-dev-shm-usage",
      "--no-sandbox",
      "--disable-setuid-sandbox",
    ]
  };
  try {
    return await chromium.launch(launchOptions);
  } catch (err: any) {
    if (err.message && (err.message.includes("Executable doesn't exist") || err.message.includes("playwright install"))) {
      console.log("[Playwright Self-Healing] Chromium binary missing. Installing locally...");
      const { execSync } = await import("child_process");
      try {
        const nodePath = process.execPath;
        const playwrightCli = path.join(process.cwd(), "node_modules", "playwright", "cli.js");
        console.log(`[Playwright Self-Healing] Launching installer: "${nodePath}" "${playwrightCli}" install chromium`);
        execSync(`"${nodePath}" "${playwrightCli}" install chromium`, { 
          stdio: "inherit",
          env: { ...process.env, PLAYWRIGHT_BROWSERS_PATH: process.env.PLAYWRIGHT_BROWSERS_PATH || path.join(process.cwd(), ".playwright-browsers") }
        });
        console.log("[Playwright Self-Healing] Installation finished. Retrying launch...");
        return await chromium.launch(launchOptions);
      } catch (installErr: any) {
        console.error("[Playwright Self-Healing] Failed to install chromium:", installErr.message || installErr);
        throw err;
      }
    }
    throw err;
  }
}

async function extractWebsiteCatalog(url: string): Promise<string> {
  if (!url) return "No website provided.";
  console.log(`[Outreach Factory] Scopes scraping website catalog from: ${url}`);
  const browser = await launchBrowser({ headless: true });
  try {
    const context = await browser.newContext({
      viewport: { width: 1280, height: 800 },
      userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
    });
    const page = await context.newPage();
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 15000 });
    
    const pageData = await page.evaluate(() => {
      const headings = Array.from(document.querySelectorAll("h1, h2, h3, h4")).map(h => h.textContent?.trim()).filter(Boolean).slice(0, 15);
      const links = Array.from(document.querySelectorAll("a")).map(a => a.textContent?.trim()).filter(t => t && t.length > 3 && t.length < 30).slice(0, 20);
      const bodyText = document.body.innerText || "";
      
      const lines = bodyText.split("\n").map(l => l.trim()).filter(Boolean);
      const potentialProducts = lines.filter(l => {
        return (l.includes("₹") || l.includes("$") || l.includes("Rs") || l.includes("price") || l.includes("Price")) && l.length < 80;
      }).slice(0, 15);
      
      return {
        headings,
        links: Array.from(new Set(links)),
        potentialProducts
      };
    });
    
    await browser.close();
    
    return `
    Headings: ${pageData.headings.join(", ")}
    Links: ${pageData.links.join(", ")}
    Potential Products/Prices: ${pageData.potentialProducts.join("; ")}
    `.slice(0, 1000);
  } catch (error: any) {
    console.warn(`[Outreach Factory] Website scraping failed for ${url}:`, error.message || error);
    try { await browser.close(); } catch (e) {}
    return "Failed to scrape website catalog details.";
  }
}


async function tryOpenCode(contents: string, systemInstruction?: string, modelOverride?: string): Promise<{ text: string }> {
  const opencodeApiKey = process.env.OPENCODE_API_KEY;
  const opencodeBaseUrl = process.env.OPENCODE_API_BASE_URL || "https://opencode.ai/zen/v1";
  const opencodeModel = modelOverride || process.env.OPENCODE_MODEL_NAME || "nemotron-3-ultra-free";

  if (!opencodeApiKey) {
    throw new Error("OpenCode API key not configured");
  }

  console.log(`[OpenCode API] Attempting generation using model: ${opencodeModel} on ${opencodeBaseUrl}`);
  let retries = 1;
  let delay = 2000;
  while (retries > 0) {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 45000);
      const response = await fetch(`${opencodeBaseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${opencodeApiKey}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          model: opencodeModel,
          messages: [
            ...(systemInstruction ? [{ role: "system", content: systemInstruction }] : []),
            { role: "user", content: contents }
          ],
          max_tokens: 4000
        }),
        signal: controller.signal
      });
      clearTimeout(timeoutId);

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`OpenCode API error (status ${response.status}): ${errorText}`);
      }

      const data = (await response.json()) as any;
      const text = data?.choices?.[0]?.message?.content;
      if (text !== undefined && text !== null) {
        console.log(`[OpenCode API] Successfully generated content with model ${opencodeModel}.`);
        return { text };
      }
      throw new Error("Invalid response format from OpenCode API");
    } catch (err: any) {
      console.warn(`[OpenCode API] Attempt failed (retries remaining: ${retries - 1}):`, err.message || err);
      retries--;
      if (retries > 0) {
        await new Promise((resolve) => setTimeout(resolve, delay));
        delay *= 2;
      } else {
        throw err;
      }
    }
  }
  throw new Error("OpenCode API attempts exhausted");
}

async function tryNvidia(contents: string, systemInstruction?: string, modelOverride?: string): Promise<{ text: string }> {
  const nvidiaApiKey = process.env.NVIDIA_API_KEY || "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";
  const nvidiaBaseUrl = process.env.NVIDIA_API_BASE_URL || "https://integrate.api.nvidia.com/v1";
  const nvidiaModel = modelOverride || process.env.NVIDIA_MODEL_NAME || "minimaxai/minimax-m2.7";

  if (!nvidiaApiKey) {
    throw new Error("Nvidia API key not configured");
  }

  console.log(`[Nvidia API] Attempting generation using model: ${nvidiaModel} on ${nvidiaBaseUrl}`);
  let retries = 1;
  let delay = 2000;
  while (retries > 0) {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 35000);
      const response = await fetch(`${nvidiaBaseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${nvidiaApiKey}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          model: nvidiaModel,
          messages: [
            ...(systemInstruction ? [{ role: "system", content: systemInstruction }] : []),
            { role: "user", content: contents }
          ],
          temperature: 1,
          top_p: 0.95,
          max_tokens: 8192,
          stream: false
        }),
        signal: controller.signal
      });
      clearTimeout(timeoutId);

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Nvidia API error (status ${response.status}): ${errorText}`);
      }

      const data = (await response.json()) as any;
      const text = data?.choices?.[0]?.message?.content;
      if (text !== undefined && text !== null) {
        console.log(`[Nvidia API] Successfully generated content with model ${nvidiaModel}.`);
        return { text };
      }
      throw new Error("Invalid response format from Nvidia API");
    } catch (err: any) {
      console.warn(`[Nvidia API] Attempt failed (retries remaining: ${retries - 1}):`, err.message || err);
      retries--;
      if (retries > 0) {
        await new Promise((resolve) => setTimeout(resolve, delay));
        delay *= 2;
      } else {
        throw err;
      }
    }
  }
  throw new Error("Nvidia API attempts exhausted");
}

async function tryGemini(contents: string, systemInstruction?: string): Promise<{ text: string }> {
  const models = ["gemini-2.5-flash"];
  let lastError: any = null;

  for (const model of models) {
    let retries = 1;
    let delay = 2000;
    
    while (retries > 0) {
      try {
        console.log(`[Gemini SDK] Trying model: ${model} (${retries} attempts remaining)...`);
        const response = await ai.models.generateContent({
          model: model,
          contents: contents,
          config: systemInstruction ? { systemInstruction } : undefined
        });
        if (response && response.text) {
          console.log(`[Gemini SDK] Success with model: ${model}`);
          return { text: response.text };
        }
      } catch (err: any) {
        lastError = err;
        const errMsg = err.message || String(err);
        console.warn(`[Gemini SDK] Model ${model} attempt failed:`, errMsg);

        const status = err.status || (err.error && err.error.code) || err.code;
        const isTransient = status === 503 || status === 429 || errMsg.includes("503") || errMsg.includes("429") || errMsg.includes("demand");
        
        if (isTransient) {
          retries--;
          if (retries > 0) {
            let waitTime = delay;
            const match = errMsg.match(/Please retry in (\d+\.?\d*)s/);
            if (match) {
              const seconds = parseFloat(match[1]);
              waitTime = Math.ceil((seconds + 1.5) * 1000);
              console.log(`[Gemini SDK] Quota limit hit. Google requested ${seconds}s wait. Waiting for ${waitTime}ms...`);
            } else {
              if (status === 429 || errMsg.includes("429")) {
                waitTime = 20000;
              }
              console.log(`[Gemini SDK] Transient error detected. Waiting for ${waitTime}ms...`);
            }
            
            await new Promise((resolve) => setTimeout(resolve, waitTime));
            delay *= 2;
            continue;
          }
        }
        break;
      }
    }
  }
  throw lastError || new Error("Gemini AI Studio attempts exhausted");
}

async function generateContentWithFallback(
  contents: string,
  systemInstruction?: string,
  preferredProvider?: "opencode" | "nvidia" | "gemini",
  modelOverride?: string
): Promise<{ text: string }> {
  let order: Array<() => Promise<{ text: string }>> = [];
  
  if (preferredProvider === "nvidia") {
    order = [
      () => tryNvidia(contents, systemInstruction, modelOverride),
      () => tryOpenCode(contents, systemInstruction, modelOverride),
      () => tryOpenCode(contents, systemInstruction, "north-mini-code-free"),
      () => tryGemini(contents, systemInstruction)
    ];
  } else if (preferredProvider === "gemini") {
    order = [
      () => tryGemini(contents, systemInstruction),
      () => tryOpenCode(contents, systemInstruction, modelOverride),
      () => tryOpenCode(contents, systemInstruction, "north-mini-code-free"),
      () => tryNvidia(contents, systemInstruction, modelOverride)
    ];
  } else {
    order = [
      () => tryOpenCode(contents, systemInstruction, modelOverride),
      () => tryOpenCode(contents, systemInstruction, "north-mini-code-free"),
      () => tryNvidia(contents, systemInstruction, modelOverride),
      () => tryGemini(contents, systemInstruction)
    ];
  }

  let lastError: any = null;
  for (const fn of order) {
    try {
      return await fn();
    } catch (err: any) {
      lastError = err;
      console.warn(`[Fallback Manager] Provider failed:`, err.message || err);
    }
  }

  throw lastError || new Error("All configured AI providers failed.");
}

async function startServer() {
  const app = express();
  const PORT = process.env.PORT ? parseInt(process.env.PORT) : 3002;
  let outreachQueue = Promise.resolve();

  app.use(express.json());
  app.use(express.static(path.join(process.cwd(), "public")));
  
  // Serve React Templates
  app.use('/templates/cafe', express.static(path.join(process.cwd(), 'templates', 'Cafe-Demo', 'dist')));
  app.use('/templates/ecommerce', express.static(path.join(process.cwd(), 'templates', 'Ecommerce-Demo', 'out')));
  app.use('/_next', express.static(path.join(process.cwd(), 'templates', 'Ecommerce-Demo', 'out', '_next')));
  app.use('/templates/restaurant', express.static(path.join(process.cwd(), 'templates', 'Restaurant-Demo', 'dist')));

  // API Routes
  app.get("/api/health", (req, res) => {
    res.json({ status: "ok" });
  });

  // Dynamic SVG Fallback Generator
  app.get("/assets/fallback/:category.svg", (req, res) => {
    const { category } = req.params;
    const width = parseInt((req.query.w as string) || "800", 10);
    const height = parseInt((req.query.h as string) || "600", 10);
    const cleanCategory = category.replace(/-/g, ' ').toUpperCase();
    
    const svg = `
      <svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <linearGradient id="g" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stop-color="#1e293b" />
            <stop offset="100%" stop-color="#0f172a" />
          </linearGradient>
        </defs>
        <rect width="100%" height="100%" fill="url(#g)"/>
        <text x="50%" y="50%" font-family="system-ui, sans-serif" font-size="${Math.max(24, width/15)}" font-weight="bold" fill="#64748b" text-anchor="middle" dominant-baseline="middle">
          ${cleanCategory}
        </text>
      </svg>
    `;
    res.setHeader("Content-Type", "image/svg+xml");
    res.send(svg.trim());
  });

  const LEADS_FILE = path.join(process.cwd(), "synced_leads.json");
  let syncedLeads: any[] = [];
  try {
    if (fs.existsSync(LEADS_FILE)) {
      syncedLeads = JSON.parse(fs.readFileSync(LEADS_FILE, "utf8"));
      console.log(`[Server Setup] Loaded ${syncedLeads.length} leads from synced_leads.json`);
    }
  } catch (err) {
    console.error("[Server Setup] Error loading synced_leads.json:", err);
  }

  function saveSyncedLeads() {
    try {
      fs.writeFileSync(LEADS_FILE, JSON.stringify(syncedLeads, null, 2), "utf8");
    } catch (err) {
      console.error("[Server Error] Error saving synced_leads.json:", err);
    }
  }

  app.post("/api/leads/sync", (req, res) => {
    const { leads } = req.body;
    if (Array.isArray(leads)) {
      leads.forEach((newLead) => {
        const lead = {
          id: newLead.id || `lead-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
          name: newLead.name,
          category: newLead.category,
          phone: newLead.phone === "NO have yet" ? "" : (newLead.phone || ""),
          email: newLead.email === "NO have yet" ? "" : (newLead.email || ""),
          website: newLead.website === "NO have yet" ? "" : (newLead.website || ""),
          address: newLead.address || newLead.location || "",
          location: newLead.address || newLead.location || "",
          rating: parseFloat(newLead.rating) || 0,
          reviewsCount: parseInt(newLead.reviewsCount || newLead.reviews) || 0,
          mapsUrl: newLead.mapsUrl || "",
          photos: Array.isArray(newLead.photos) ? newLead.photos : [],
          score: parseInt(newLead.leadScore || newLead.score) || 50,
          siteStatus: (newLead.website && newLead.website !== "NO have yet") ? "present" : "missing",
          isMock: false
        };

        const index = syncedLeads.findIndex((l) => (l.mapsUrl && l.mapsUrl === lead.mapsUrl) || l.name === lead.name);
        if (index !== -1) {
          // Merge updates
          syncedLeads[index] = { 
            ...syncedLeads[index], 
            ...lead,
            // Keep existing fields if incoming is empty
            phone: lead.phone || syncedLeads[index].phone,
            website: lead.website || syncedLeads[index].website,
            email: lead.email || syncedLeads[index].email,
          };
          // Recalculate siteStatus
          syncedLeads[index].siteStatus = syncedLeads[index].website ? "present" : "missing";
        } else {
          syncedLeads.push(lead);
        }
      });
      saveSyncedLeads();
      return res.json({ success: true, count: syncedLeads.length });
    }
    res.status(400).json({ error: "Invalid payload format" });
  });

  app.get("/api/leads/sync", (req, res) => {
    res.json({ leads: syncedLeads });
  });

  app.post("/api/leads/sync/clear", (req, res) => {
    syncedLeads = [];
    saveSyncedLeads();
    res.json({ success: true });
  });

  app.post("/api/leads/sync/remove", (req, res) => {
    const { id } = req.body;
    if (id) {
      syncedLeads = syncedLeads.filter((l) => l.id !== id);
      saveSyncedLeads();
      return res.json({ success: true });
    }
    res.status(400).json({ error: "Missing lead ID" });
  });

  // ────────────────────────────────────────────
  // 24/7 Standing Autonomous Delta Auto-Trader Backend Engine
  // ────────────────────────────────────────────
  const DELTA_STATE_FILE = path.join(process.cwd(), ".delta_auto_trader_state.json");
  const PAPER_STATE_FILE = path.join(process.cwd(), ".paper_trading_state.json");

  // 🚀 Hydrate 24/7 Standing Autonomous State from disk immediately on server start
  try {
    if (fs.existsSync(DELTA_STATE_FILE)) {
      const raw = fs.readFileSync(DELTA_STATE_FILE, "utf-8");
      if (raw) {
        (deltaAutoTraderEngine as any).applyParsedState(JSON.parse(raw));
        console.log("[Server] 🚀 24/7 Delta Auto-Trader state hydrated from disk (.delta_auto_trader_state.json)");
      }
    }
  } catch (e) {
    console.warn("[Server] ⚠️ Could not hydrate delta state from disk:", e);
  }

  // ────────────────────────────────────────────
  // 🔐 Standalone Manual Institutional Authentication API
  // ────────────────────────────────────────────
  app.post("/api/auth/login", (req, res) => {
    try {
      const { username, pin, password, device } = req.body;
      const secret = pin || password || "";
      const result = authEngine.authenticate(username, secret, device);
      if (result.success) {
        return res.json({ success: true, token: result.token, user: result.user, message: result.message });
      }
      return res.status(401).json({ success: false, message: result.message });
    } catch (e: any) {
      res.status(500).json({ success: false, error: e.message });
    }
  });

  app.get("/api/auth/verify", (req, res) => {
    try {
      const authHeader = req.headers.authorization || "";
      const token = authHeader.startsWith("Bearer ") ? authHeader.substring(7) : (req.query.token as string || "");
      const result = authEngine.verifyToken(token);
      if (result.valid) {
        const sessionInfo = authEngine.getSessionInfo();
        return res.json({ success: true, authenticated: true, user: result.user, session: sessionInfo });
      }
      return res.status(401).json({ success: false, authenticated: false, message: "Session expired or invalid" });
    } catch (e: any) {
      res.status(500).json({ success: false, error: e.message });
    }
  });

  app.post("/api/auth/update-credentials", (req, res) => {
    try {
      const { currentSecret, newUsername, newSecret } = req.body;
      const result = authEngine.updateCredentials(currentSecret, newUsername, newSecret);
      if (result.success) {
        return res.json({ success: true, message: result.message });
      }
      return res.status(400).json({ success: false, message: result.message });
    } catch (e: any) {
      res.status(500).json({ success: false, error: e.message });
    }
  });

  app.get("/api/auth/session", (req, res) => {
    try {
      const sessionInfo = authEngine.getSessionInfo();
      return res.json({ success: true, session: sessionInfo });
    } catch (e: any) {
      res.status(500).json({ success: false, error: e.message });
    }
  });

  app.post("/api/auth/logout", (req, res) => {
    return res.json({ success: true, message: "Logged out successfully" });
  });

  // Real-Time Server State (Runs 24/7 in Cloud even when Chrome is closed / Mobile is sleeping)
  app.get("/api/autotrader/state", async (req, res) => {
    try {
      // NOTE: syncWithExchangePositions is NOT called here to prevent the
      // infinite sync→close→re-sync loop when frontend polls every 1.5s.
      // Sync happens independently via the 30s daemon interval below.
      const fullState = deltaAutoTraderEngine.getLiveFullState();
      return res.json({ success: true, state: fullState });
    } catch (e: any) {
      res.status(500).json({ success: false, error: e.message });
    }
  });

  app.post("/api/autotrader/state", (req, res) => {
    try {
      const state = req.body;
      if (state) {
        fs.writeFileSync(DELTA_STATE_FILE, JSON.stringify(state, null, 2), "utf-8");
        deltaAutoTraderEngine.applyParsedState(state);
        return res.json({ success: true, state: deltaAutoTraderEngine.getLiveFullState() });
      }
      res.status(400).json({ success: false, error: "Empty payload" });
    } catch (e: any) {
      res.status(500).json({ success: false, error: e.message });
    }
  });

  app.post("/api/autotrader/toggle", (req, res) => {
    try {
      const { isEnabled } = req.body;
      const newStatus = deltaAutoTraderEngine.toggleBot(isEnabled);
      const fullState = deltaAutoTraderEngine.getLiveFullState();
      try {
        fs.writeFileSync(DELTA_STATE_FILE, JSON.stringify(fullState, null, 2), "utf-8");
      } catch (e) {}
      return res.json({ success: true, isEnabled: newStatus, state: fullState });
    } catch (e: any) {
      res.status(500).json({ success: false, error: e.message });
    }
  });

  app.post("/api/autotrader/reset-queue", (req, res) => {
    try {
      deltaAutoTraderEngine.resetToFirstAsset();
      return res.json({ success: true, message: "Reset to Asset #1: BTC (Bitcoin) for 5-minute analysis.", state: deltaAutoTraderEngine.getLiveFullState() });
    } catch (e: any) {
      res.status(500).json({ success: false, error: e.message });
    }
  });

  app.post("/api/autotrader/close-all", async (req, res) => {
    try {
      const result = await deltaAutoTraderEngine.closeAllOpenPositions("MANUAL_EXIT");
      return res.json({ success: true, count: result.count, message: result.message, state: deltaAutoTraderEngine.getLiveFullState() });
    } catch (e: any) {
      res.status(500).json({ success: false, error: e.message });
    }
  });

  app.post("/api/autotrader/skip-cooldown", (req, res) => {
    try {
      deltaAutoTraderEngine.skipBatchCooldown();
      return res.json({ success: true, message: "10-Min AI Analysis timer skipped", state: deltaAutoTraderEngine.getLiveFullState() });
    } catch (e: any) {
      res.status(500).json({ success: false, error: e.message });
    }
  });

  app.post("/api/autotrader/skip-inspection", (req, res) => {
    try {
      const result = deltaAutoTraderEngine.skipCurrentAssetInspection();
      return res.json({ ...result, state: deltaAutoTraderEngine.getLiveFullState() });
    } catch (e: any) {
      res.status(500).json({ success: false, error: e.message });
    }
  });

  app.post("/api/autotrader/force", async (req, res) => {
    try {
      const forceDirection = req.body?.direction || req.body?.forceDirection;
      const specificSymbol = req.body?.symbol;
      const result = await deltaAutoTraderEngine.scanAndExecuteNextTrade(true, forceDirection, specificSymbol);
      return res.json({ ...result, state: deltaAutoTraderEngine.getLiveFullState() });
    } catch (e: any) {
      res.status(500).json({ success: false, error: e.message });
    }
  });

  app.post("/api/autotrader/scan", async (req, res) => {
    try {
      const result = await deltaAutoTraderEngine.scanAndExecuteNextTrade(false);
      return res.json({ ...result, state: deltaAutoTraderEngine.getLiveFullState() });
    } catch (e: any) {
      res.status(500).json({ success: false, error: e.message });
    }
  });

  app.post("/api/autotrader/reset", (req, res) => {
    try {
      deltaAutoTraderEngine.resetSystemCleanly();
      const fullState = deltaAutoTraderEngine.getLiveFullState();
      try {
        fs.writeFileSync(DELTA_STATE_FILE, JSON.stringify(fullState, null, 2), "utf-8");
      } catch (e) {}
      return res.json({ success: true, message: "🧹 System reset successfully.", state: fullState });
    } catch (e: any) {
      res.status(500).json({ success: false, error: e.message });
    }
  });

  app.post("/api/autotrader/settings", (req, res) => {
    try {
      const newSettings = req.body;
      if (newSettings) {
        if (newSettings.mode) {
          deltaAutoTraderEngine.toggleMode(newSettings.mode);
        }
        deltaAutoTraderEngine.updateSettings(newSettings);
        return res.json({ success: true, state: deltaAutoTraderEngine.getLiveFullState() });
      }
      res.status(400).json({ success: false, error: "Settings payload required" });
    } catch (e: any) {
      res.status(500).json({ success: false, error: e.message });
    }
  });

  app.post(["/api/autotrader/close", "/api/autotrader/close-position"], async (req, res) => {
    try {
      const { positionId, exitPrice, currentPrice, reason } = req.body;
      const price = exitPrice || currentPrice;
      const result = await deltaAutoTraderEngine.closePosition(positionId, price, reason || "MANUAL_EXIT");
      return res.json({ ...result, state: deltaAutoTraderEngine.getLiveFullState() });
    } catch (e: any) {
      res.status(500).json({ success: false, error: e.message });
    }
  });

  app.get("/api/autotrader/preview-lot", (req, res) => {
    try {
      const symbol = (req.query.symbol as string) || "BTCUSD";
      const price = Number(req.query.price) || deltaAutoTraderEngine.getLivePriceUSD(symbol);
      const slDist = Number(req.query.slDist) || (price * 0.015);
      const result = deltaAutoTraderEngine.calculateDynamicLotSize(symbol, price, slDist);
      return res.json({ success: true, preview: result });
    } catch (e: any) {
      res.status(500).json({ success: false, error: e.message });
    }
  });

  app.get("/api/autotrader/diagnostics", async (req, res) => {
    try {
      const diagnostics = await deltaAutoTraderEngine.getScanDiagnostics();
      return res.json({ success: true, diagnostics });
    } catch (e: any) {
      res.status(500).json({ success: false, error: e.message });
    }
  });

  // ============================================================================
  // 🤖 24/7 CLOUD AUTONOMOUS SWING DAEMON WITH INDEPENDENT MUTEX EXECUTION LOCKS
  // ============================================================================
  let isExitMonitoringLocked = false;
  let isEntryScanLocked = false;

  // 🔄 Independent Position Sync Daemon (every 30s — safe, rate-limited, NOT on frontend hot path)
  setInterval(async () => {
    try {
      if (deltaAutoTraderEngine.getLiveFullState().settings.mode === "LIVE") {
        await deltaAutoTraderEngine.syncWithExchangePositions();
      }
    } catch (e) {}
  }, 30000);

  // ⚡ 0. High-Frequency Real-Time Market Ticker Stream & Live P&L Updater (every 2.5s)
  try {
    deltaExchangeEngine.connectWebSocket();
    // Hook direct realtime streaming ticks for sub-second P&L updates
    brokerTickEngine.on("tick", (tick: any) => {
      if (tick && tick.symbol && tick.price > 0) {
        const cleanSym = tick.symbol.toUpperCase().replace("-", "").trim();
        deltaAutoTraderEngine.updateLivePriceAndCheckExits(cleanSym, tick.price);
      }
    });
  } catch (e) {}

  setInterval(async () => {
    try {
      // Fetch live market mark prices from Delta Exchange
      await deltaExchangeEngine.fetchAllTickers();

      const fullState = deltaAutoTraderEngine.getLiveFullState();
      if (fullState.openPositions.length > 0) {
        for (const pos of fullState.openPositions) {
          const cleanTag = pos.symbol.toUpperCase().replace("USDT", "").replace("USD", "").replace("-", "").trim();
          const currentPrice = deltaAutoTraderEngine.getLivePriceUSD(pos.symbol)
            || deltaExchangeEngine.getLivePrice(pos.symbol)?.usd
            || brokerTickEngine.getLastKnownPrice(pos.symbol)
            || brokerTickEngine.getLastKnownPrice(`${cleanTag}-USD`)
            || brokerTickEngine.getLastKnownPrice(`${cleanTag}USD`);
          if (currentPrice > 0) {
            deltaAutoTraderEngine.updateLivePriceAndCheckExits(pos.symbol, currentPrice);
          }
        }
      }
    } catch (e) {
      // Quiet ticker catch
    }
  }, 2500);

  // 1. Exit & Trailing Stop Monitoring Daemon (every 30s for v3 swing horizon)
  setInterval(async () => {
    if (isExitMonitoringLocked) return;
    isExitMonitoringLocked = true;
    try {
      const fullState = deltaAutoTraderEngine.getLiveFullState();
      if (fullState.settings.isEnabled && fullState.openPositions.length > 0) {
        const trackedSymbols = CURATED_AUTO_TRADER_ASSETS.map(a => a.symbol);
        for (const sym of trackedSymbols) {
          const cleanTag = sym.toUpperCase().replace("USDT", "").replace("USD", "").replace("-", "").trim();
          const currentPrice = deltaAutoTraderEngine.getLivePriceUSD(sym)
            || deltaExchangeEngine.getLivePrice(sym)?.usd
            || brokerTickEngine.getLastKnownPrice(sym)
            || brokerTickEngine.getLastKnownPrice(`${cleanTag}-USD`)
            || brokerTickEngine.getLastKnownPrice(`${cleanTag}USD`);
          if (currentPrice > 0) {
            deltaAutoTraderEngine.updateLivePriceAndCheckExits(sym, currentPrice);
          }
        }
      }
    } catch (e) {
      console.warn("[DeltaDaemon] ⚠️ Exit monitoring tick error:", e);
    } finally {
      isExitMonitoringLocked = false;
    }
  }, EXIT_MONITORING_INTERVAL_MS);

  // 2. 24/7 New Entry Scanning Daemon (evaluates 5-min queue every 10s continuously)
  setInterval(async () => {
    if (isEntryScanLocked) return;
    isEntryScanLocked = true;
    try {
      const fullState = deltaAutoTraderEngine.getLiveFullState();
      if (fullState.settings.isEnabled) {
        const res = await deltaAutoTraderEngine.scanAndExecuteNextTrade();
        if (res && res.executed) {
          console.log(`[DeltaDaemon] 🚀 AUTONOMOUS TRADE PLACED: ${res.message}`);
        }
      }
    } catch (e) {
      console.warn("[DeltaDaemon] ⚠️ Entry scan tick error:", e);
    } finally {
      isEntryScanLocked = false;
    }
  }, NEW_ENTRY_SCAN_INTERVAL_MS);

  app.get("/api/paper-trading/state", (req, res) => {
    try {
      if (fs.existsSync(PAPER_STATE_FILE)) {
        const raw = fs.readFileSync(PAPER_STATE_FILE, "utf-8");
        return res.json({ success: true, state: JSON.parse(raw) });
      }
      res.json({ success: true, state: null });
    } catch (e: any) {
      res.status(500).json({ success: false, error: e.message });
    }
  });

  app.post("/api/paper-trading/state", (req, res) => {
    try {
      const state = req.body;
      if (state) {
        fs.writeFileSync(PAPER_STATE_FILE, JSON.stringify(state, null, 2), "utf-8");
        return res.json({ success: true });
      }
      res.status(400).json({ success: false, error: "Empty payload" });
    } catch (e: any) {
      res.status(500).json({ success: false, error: e.message });
    }
  });

  // WhatsApp CRM Integration Endpoints & Helpers
  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_KEY = process.env.SUPABASE_KEY;
  const isSupabaseConfigured = !!(SUPABASE_URL && SUPABASE_KEY);

  async function querySupabase(endpoint: string, options: any = {}) {
    if (!isSupabaseConfigured) {
      throw new Error("Supabase is not configured. Add SUPABASE_URL and SUPABASE_KEY to your .env file.");
    }
    const url = `${SUPABASE_URL}/rest/v1/${endpoint}`;
    const headers: any = {
      'apikey': SUPABASE_KEY!,
      'Authorization': `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json',
      ...options.headers
    };
    const response = await fetch(url, {
      ...options,
      headers
    });
    if (!response.ok) {
      const errorText = await response.text();
      console.error(`[Supabase Error] ${endpoint} response code: ${response.status}`, errorText);
      throw new Error(`Supabase query failed: ${errorText}`);
    }
    const text = await response.text();
    if (!text || text.trim() === "") {
      return null;
    }
    try {
      return JSON.parse(text);
    } catch (e) {
      return text;
    }
  }

  async function resolveActiveUserAndAccount() {
    try {
      const configs = await querySupabase('whatsapp_config?limit=1');
      if (configs && configs.length > 0) {
        return { userId: configs[0].user_id, accountId: configs[0].account_id };
      }
    } catch (e) {
      console.error("[Supabase Resolve] Failed to query whatsapp_config:", e);
    }
    try {
      const profiles = await querySupabase('profiles?limit=1');
      if (profiles && profiles.length > 0) {
        return { userId: profiles[0].user_id, accountId: profiles[0].account_id || profiles[0].id };
      }
    } catch (e) {
      console.error("[Supabase Resolve] Failed to query profiles:", e);
    }
    return {
      userId: '270652b8-273a-41e2-a776-e26deba200e0',
      accountId: '11f506c5-0e78-43ea-9216-650017e8df0f'
    };
  }

  async function logMessageToCRM(contactId: string, userId: string, accountId: string, messageText: string, videoUrl: string | null = null) {
    let conversationId = null;
    try {
      const convs = await querySupabase(`conversations?account_id=eq.${accountId}&contact_id=eq.${contactId}&limit=1`);
      if (convs && convs.length > 0) {
        conversationId = convs[0].id;
        await querySupabase(`conversations?id=eq.${conversationId}`, {
          method: 'PATCH',
          body: JSON.stringify({
            last_message_text: messageText,
            last_message_at: new Date().toISOString(),
            updated_at: new Date().toISOString()
          })
        });
      } else {
        const insertedConv = await querySupabase('conversations', {
          method: 'POST',
          headers: { 'Prefer': 'return=representation' },
          body: JSON.stringify({
            user_id: userId,
            account_id: accountId,
            contact_id: contactId,
            status: 'open',
            last_message_text: messageText,
            last_message_at: new Date().toISOString()
          })
        });
        if (insertedConv && insertedConv.length > 0) {
          conversationId = insertedConv[0].id;
        }
      }

      if (conversationId) {
        await querySupabase('messages', {
          method: 'POST',
          body: JSON.stringify({
            conversation_id: conversationId,
            sender_type: 'bot',
            content_type: 'text',
            content_text: messageText,
            media_url: videoUrl || null,
            status: 'sent'
          })
        });
        console.log(`[Supabase CRM] Logged message under conversation: ${conversationId}`);
      }
    } catch (err) {
      console.error("[Supabase CRM Message Log Error]", err);
    }
  }

  async function syncLeadToSupabase(lead: any) {
    if (!isSupabaseConfigured) return null;
    const { userId, accountId } = await resolveActiveUserAndAccount();

    const rawPhone = lead.phone || "";
    const cleanPhone = rawPhone === "NO have yet" ? "" : rawPhone;
    const phoneNormalized = cleanPhone.replace(/\D/g, "");

    let contactId = null;

    if (phoneNormalized) {
      try {
        const contacts = await querySupabase(`contacts?account_id=eq.${accountId}&phone_normalized=eq.${phoneNormalized}&limit=1`);
        if (contacts && contacts.length > 0) {
          contactId = contacts[0].id;
          await querySupabase(`contacts?id=eq.${contactId}`, {
            method: 'PATCH',
            body: JSON.stringify({
              name: lead.name || null,
              email: (lead.email && lead.email !== "NO have yet") ? lead.email : null,
              company: lead.category || null,
              updated_at: new Date().toISOString()
            })
          });
          console.log(`[Supabase Sync] Updated contact by phone: ${lead.name} (${contactId})`);
        }
      } catch (e) {
        console.error("[Supabase Sync] Error checking/updating contact by phone:", e);
      }
    }

    if (!contactId && lead.name) {
      try {
        const contacts = await querySupabase(`contacts?account_id=eq.${accountId}&name=eq.${encodeURIComponent(lead.name)}&limit=1`);
        if (contacts && contacts.length > 0) {
          contactId = contacts[0].id;
          await querySupabase(`contacts?id=eq.${contactId}`, {
            method: 'PATCH',
            body: JSON.stringify({
              phone: cleanPhone || contacts[0].phone || "",
              email: (lead.email && lead.email !== "NO have yet") ? lead.email : (contacts[0].email || null),
              company: lead.category || contacts[0].company || null,
              updated_at: new Date().toISOString()
            })
          });
          console.log(`[Supabase Sync] Updated contact by name: ${lead.name} (${contactId})`);
        }
      } catch (e) {
        console.error("[Supabase Sync] Error checking/updating contact by name:", e);
      }
    }

    if (!contactId) {
      try {
        const inserted = await querySupabase('contacts', {
          method: 'POST',
          headers: { 'Prefer': 'return=representation' },
          body: JSON.stringify({
            user_id: userId,
            account_id: accountId,
            phone: cleanPhone || "",
            name: lead.name || null,
            email: (lead.email && lead.email !== "NO have yet") ? lead.email : null,
            company: lead.category || null
          })
        });
        if (inserted && inserted.length > 0) {
          contactId = inserted[0].id;
          console.log(`[Supabase Sync] Inserted contact: ${lead.name} (${contactId})`);
        }
      } catch (e) {
        console.error("[Supabase Sync] Error inserting contact:", e);
        throw e;
      }
    }

    if (!contactId) {
      throw new Error("Failed to create or resolve contact ID in Supabase.");
    }

    try {
      const noteLines = [];
      if (lead.website && lead.website !== "NO have yet") noteLines.push(`Website: ${lead.website}`);
      if (lead.rating) noteLines.push(`Google Rating: ${lead.rating} ★`);
      if (lead.reviewsCount || lead.reviews) noteLines.push(`Reviews: ${lead.reviewsCount || lead.reviews}`);
      if (lead.address || lead.location) noteLines.push(`Address: ${lead.address || lead.location}`);
      if (lead.leadScore || lead.score) noteLines.push(`Lead Score: ${lead.leadScore || lead.score}/100`);

      if (noteLines.length > 0) {
        const noteText = `Scraped Business Details:\n${noteLines.join('\n')}`;
        await querySupabase('contact_notes', {
          method: 'POST',
          body: JSON.stringify({
            contact_id: contactId,
            user_id: userId,
            account_id: accountId,
            note_text: noteText
          })
        });
      }
    } catch (e) {
      console.error("[Supabase Sync] Error inserting contact note:", e);
    }

    if (lead.outreachMessage) {
      try {
        await logMessageToCRM(contactId, userId, accountId, lead.outreachMessage, lead.videoUrl || null);
      } catch (e) {
        console.error("[Supabase Sync] Error logging outreach message:", e);
      }
    }

    return contactId;
  }

  app.get("/api/crm/config-status", (req, res) => {
    res.json({ configured: isSupabaseConfigured, url: SUPABASE_URL || null });
  });

  app.post("/api/crm/sync-leads", async (req, res) => {
    const { leads } = req.body;
    if (!isSupabaseConfigured) {
      return res.status(400).json({ error: "WhatsApp CRM is not configured in .env" });
    }
    if (!Array.isArray(leads)) {
      return res.status(400).json({ error: "Leads array is required" });
    }
    try {
      let count = 0;
      for (const lead of leads) {
        await syncLeadToSupabase(lead);
        count++;
      }
      res.json({ success: true, count });
    } catch (error: any) {
      console.error("[Supabase Sync Endpoint Error]", error);
      res.status(500).json({ error: error.message || "Failed to sync leads to Supabase" });
    }
  });


  function calculateLeadScore(lead: LeadData): number {
    let score = 50; // Base score
    if (!lead.website || lead.siteStatus === 'missing') score += 25; // No website
    else if (lead.websiteOpportunityScore === 80) score += 10; // Old/broken website
    if (lead.rating && lead.rating >= 4.0) score += 15; // Reputable business
    if (lead.reviewsCount && lead.reviewsCount > 50) score += 15; // High volume
    if (lead.phone) score += 5; // Contactable
    return Math.min(100, score);
  }

  app.post("/api/leads/discover", async (req, res) => {
    try {
      const { category, location, maxLeads, resumeId } = req.body;
      
      if (!category && !resumeId) {
        return res.status(400).json({ error: "Category or resumeId is required" });
      }

      let targetCities: string[] = [];
      let currentCityIndex = 0;
      let jobId = resumeId || `job_${Date.now()}`;
      let allExtractedLeads: LeadData[] = [];
      
      if (resumeId) {
        const cp = checkpointManager.getCheckpoint(resumeId);
        if (!cp) {
          return res.status(404).json({ error: "Checkpoint not found" });
        }
        targetCities = cp.cities;
        currentCityIndex = cp.currentCityIndex;
        console.log(`[Discovery] Resuming job ${resumeId} from city index ${currentCityIndex}`);
        checkpointManager.updateProgress(jobId, { status: 'running' });
      } else {
        if (!location) return res.status(400).json({ error: "Location is required for new jobs" });
        targetCities = getCitiesForLocation(location);
        console.log(`[Discovery] Expanding location ${location} into ${targetCities.length} cities.`);
        checkpointManager.saveCheckpoint({
          id: jobId,
          country: location,
          category,
          maxLeads: maxLeads || 0,
          currentCityIndex: 0,
          cities: targetCities,
          leadsCollected: 0,
          duplicateCount: 0,
          failedCities: [],
          status: 'running',
          lastUpdated: new Date().toISOString()
        });
      }

      // We'll process asynchronously if there are many cities, but for simplicity here we return the final result.
      // In a real production app, we would return jobId immediately and have the client poll /api/scrape/status/:id
      // but to keep compatibility with existing frontend, we'll await it (though it might timeout).

      const engine = new ScraperEngine();
      await engine.init();
      
      const maxCitiesToProcess = Math.min(targetCities.length, 3);
      
      for (let i = currentCityIndex; i < targetCities.length && i < currentCityIndex + maxCitiesToProcess; i++) {
        const cp = checkpointManager.getCheckpoint(jobId);
        if (cp && cp.status === 'stopped') {
           console.log(`[Discovery] Job ${jobId} was stopped.`);
           break;
        }

        const city = targetCities[i];
        const searchQuery = `${category} in ${city}`;
        try {
          const leads = await engine.scrapeCity(searchQuery, city, category, jobId);
          allExtractedLeads.push(...leads);
          
          checkpointManager.updateProgress(jobId, { 
            currentCityIndex: i + 1,
            leadsCollected: allExtractedLeads.length
          });
        } catch (e: any) {
          console.error(`[Discovery] Failed to scrape city ${city}:`, e);
          const cpNow = checkpointManager.getCheckpoint(jobId);
          if (cpNow) {
            checkpointManager.updateProgress(jobId, {
              failedCities: [...cpNow.failedCities, city],
              currentCityIndex: i + 1
            });
          }
        }
        
        if (maxLeads && allExtractedLeads.length >= parseInt(maxLeads)) {
           break;
        }
      }
      
      await engine.close();
      const debugLogs = engine.getLogs();

      checkpointManager.updateProgress(jobId, { status: 'completed' });

      // Deduplication
      const uniqueLeads = new Map<string, LeadData>();
      allExtractedLeads.forEach(lead => {
         const dedupKey = lead.mapsUrl || `${lead.name}-${lead.location}`;
         if (!uniqueLeads.has(dedupKey)) {
             uniqueLeads.set(dedupKey, lead);
         }
      });

      // Website Analysis & Scoring
      let validLeads = Array.from(uniqueLeads.values()).filter(lead => {
         const hasRequired = lead.name && lead.location && lead.mapsUrl;
         if (!hasRequired) return false;
         return true;
      });

      console.log(`[Discovery] Starting website analysis for ${validLeads.length} leads...`);
      for (let lead of validLeads) {
         if (lead.website) {
            try {
              const analysis = await websiteAnalyzer.analyze(lead.website);
              lead.websiteOpportunityScore = analysis.opportunityScore;
            } catch (e) {
              lead.websiteOpportunityScore = 80;
            }
         } else {
            lead.websiteOpportunityScore = 100; // No website
         }
         
         lead.score = calculateLeadScore(lead);
         lead.siteStatus = lead.website ? 'present' : 'missing';
      }

      validLeads.sort((a, b) => (b.score || 0) - (a.score || 0));

      if (validLeads.length === 0) {
        return res.json({ 
          status: "NO_RESULTS_FOUND",
          results: [],
          debug: { jobId, citiesScanned: targetCities.slice(currentCityIndex, currentCityIndex + maxCitiesToProcess), logs: debugLogs }
        });
      }

      res.json({ status: "SUCCESS", jobId, results: validLeads, debug: { logs: debugLogs } });
    } catch(err) {
      console.error(err);
      res.status(500).json({ error: "Failed to scrape leads" });
    }
  });

  app.get("/api/scrape/status/:id", (req, res) => {
    const cp = checkpointManager.getCheckpoint(req.params.id);
    if (!cp) return res.status(404).json({ error: "Job not found" });
    res.json(cp);
  });

  app.post("/api/scrape/stop/:id", (req, res) => {
    const cp = checkpointManager.getCheckpoint(req.params.id);
    if (!cp) return res.status(404).json({ error: "Job not found" });
    checkpointManager.updateProgress(req.params.id, { status: 'stopped' });
    res.json({ success: true, message: "Job stopped" });
  });

  app.post("/api/leads/discover/github", async (req, res) => {
    try {
      const { keyword, token, limit = 15 } = req.body;
      if (!keyword) {
        return res.status(400).json({ error: "Keyword is required" });
      }

      // Calculate date 30 days ago to keep leads fresh
      const dateLimit = new Date();
      dateLimit.setDate(dateLimit.getDate() - 30);
      const dateString = dateLimit.toISOString().split('T')[0]; // YYYY-MM-DD

      // Build GitHub search query with hiring keywords & age limit
      const cleanKeyword = keyword.replace(/["']/g, "").trim();
      const hasHiringIntent = /looking for|need|hiring|freelance|job|developer|website|contract/i.test(cleanKeyword);
      
      let query = "";
      if (keyword.includes("is:")) {
        query = keyword;
      } else if (hasHiringIntent) {
        query = `${cleanKeyword} is:issue state:open created:>=${dateString}`;
      } else {
        query = `"${cleanKeyword}" ("looking for" OR "hiring" OR "need" OR "freelance" OR "developer") is:issue state:open created:>=${dateString}`;
      }

      // Query 60 items from GitHub to filter down to high-quality results
      const searchUrl = `https://api.github.com/search/issues?q=${encodeURIComponent(query)}&sort=created&order=desc&per_page=60`;

      const headers: Record<string, string> = {
        'User-Agent': 'Freelance-Goldmine-Lead-Finder',
        'Accept': 'application/vnd.github.v3+json',
      };
      const resolvedToken = (token && token.trim()) || process.env.GITHUB_TOKEN;
      if (resolvedToken && resolvedToken.trim()) {
        headers['Authorization'] = `token ${resolvedToken.trim()}`;
      }

      console.log(`[GitHub Discovery] Fetching query: "${query}"`);
      const response = await fetch(searchUrl, { headers });
      if (!response.ok) {
        const errorText = await response.text();
        return res.status(response.status).json({ error: `GitHub API error: ${errorText || response.statusText}` });
      }

      const searchData = await response.json();
      const items = searchData.items || [];

      // High-precision regex definitions
      const buyingRegex = /\b(looking for a developer|looking for a designer|looking for someone to build|looking for web developer|need a website|need a developer|hiring|hire|freelancer|job offer|freelance)\b/i;
      const excludeRegex = /\b(good first issue|help wanted|prs welcome|pull request welcome|hacktoberfest|contribute|contribution|contributor|open-source|open source)\b/i;
      const sellerRegex = /\b(web development company|website design services|web design services|seo services|digital marketing agency|ppc services|web development agency|software development company|we offer|our services|we specialize in|leading agency|professional website design|dedicated developers|boost your business|top-tier|marketing campaigns|services in|ein filing|tax services|incorporation services)\b/i;

      // First Pass: Filter out non-hiring posts, open-source noise, and seller promotions
      const filteredItems = items.filter((item: any) => {
        const titleText = item.title || "";
        const bodyText = item.body || "";
        const combinedText = `${titleText} \n ${bodyText}`;
        
        const hasOS = excludeRegex.test(combinedText);
        const hasHiring = buyingRegex.test(combinedText);
        const isSeller = sellerRegex.test(combinedText);

        return hasHiring && !hasOS && !isSeller;
      }).slice(0, limit);

      console.log(`[GitHub Discovery] Pre-filtered ${items.length} items down to ${filteredItems.length} high-quality leads.`);

      // Second Pass: Extract details in parallel for kept items only
      const rawLeads = await Promise.all(filteredItems.map(async (item: any) => {
        // Regex email extraction from body
        const emailRegex = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
        const bodyText = item.body || "";
        const titleText = item.title || "";
        const combinedText = `${titleText} \n ${bodyText}`;
        const foundEmails = combinedText.match(emailRegex);
        let email = foundEmails ? foundEmails[0] : null;

        // Extract potential website/references from body
        const urlRegex = /https?:\/\/[^\s$.?#].[^\s]*/gi;
        const foundUrls = bodyText.match(urlRegex);
        let website = "";
        if (foundUrls) {
          const externalUrl = foundUrls.find((u: string) => !u.includes("github.com") && !u.includes("githubusercontent.com"));
          if (externalUrl) {
            website = externalUrl.replace(/^[a-zA-Z]+:\/\//, ""); // remove protocol
          }
        }

        let repoStars = 0;
        let userEmail = null;
        let userRealName = null;
        let isIrrelevant = false;

        // Fetch additional info if possible
        try {
          if (item.repository_url) {
            const repoRes = await fetch(item.repository_url, { headers });
            if (repoRes.ok) {
              const repoData = await repoRes.json();
              repoStars = repoData.stargazers_count || 0;
              // Filter out large popular repositories which are not client jobs
              if (repoStars > 150) {
                isIrrelevant = true;
              }
            }
          }
          
          if (item.user && item.user.url && !email) {
            const userRes = await fetch(item.user.url, { headers });
            if (userRes.ok) {
              const userData = await userRes.json();
              userEmail = userData.email;
              userRealName = userData.name;
            }
          }
        } catch (e) {
          // Fail silently on extra fetches
        }

        if (isIrrelevant) return null;

        const finalEmail = email || userEmail || "No public email";
        const finalName = userRealName ? `${userRealName} (${item.user.login})` : item.user.login;
        const repoName = item.repository_url.split('/repos/')[1] || "GitHub";

        return {
          id: String(item.id),
          name: `${finalName} | Repo: ${repoName}`,
          title: item.title,
          rating: repoStars > 0 ? `⭐ ${repoStars}` : "GitHub Issue",
          address: item.html_url,
          website: website || item.user.html_url,
          phone: "GitHub Gigs",
          email: finalEmail,
          niche: keyword,
          reviewsCount: item.comments || 0,
          description: bodyText.substring(0, 500) + (bodyText.length > 500 ? "..." : "")
        };
      }));

      const leads = rawLeads.filter(Boolean);
      res.json({ status: "SUCCESS", results: leads });
    } catch (err) {
      console.error("[GitHub Lead Discovery] Error:", err);
      res.status(500).json({ error: String(err) });
    }
  });

  app.post("/api/leads/discover/github/test", async (req, res) => {
    try {
      const { token } = req.body;
      const resolvedToken = (token && token.trim()) || process.env.GITHUB_TOKEN;
      if (!resolvedToken || !resolvedToken.trim()) {
        return res.json({ success: false, error: "No token provided and GITHUB_TOKEN environment variable is not configured." });
      }

      const headers: Record<string, string> = {
        'User-Agent': 'Freelance-Goldmine-Token-Tester',
        'Accept': 'application/vnd.github.v3+json',
        'Authorization': `token ${resolvedToken.trim()}`
      };

      const response = await fetch('https://api.github.com/user', { headers });
      if (!response.ok) {
        return res.json({ success: false, error: `GitHub API returned error: ${response.status} ${response.statusText}` });
      }

      const userData = await response.json();
      const rateLimitLimit = response.headers.get('x-ratelimit-limit') || '5000';
      const rateLimitRemaining = response.headers.get('x-ratelimit-remaining') || '4999';

      res.json({
        success: true,
        username: userData.login,
        rateLimitLimit,
        rateLimitRemaining
      });
    } catch (err) {
      console.error("[GitHub Token Test] Error:", err);
      res.json({ success: false, error: String(err) });
    }
  });

  app.post("/api/leads/summarize", async (req, res) => {
    try {
      const { text } = req.body;
      if (!text || !text.trim()) {
        return res.json({ success: true, summary: "No description available to summarize." });
      }

      const prompt = `You are a B2B sales assistant. Summarize the following project request or issue in exactly 1 or 2 concise sentences, focusing on:
1. What the client wants to build/fix.
2. The key technology stack (if mentioned).
3. Any mention of budget or urgency.
Keep it extremely concise, professional, and straight to the point. No introductory text.

Text:
${text}`;

      const aiResponse = await generateContentWithFallback(prompt, "You are a helpful B2B assistant.");
      res.json({ success: true, summary: aiResponse.text.trim() });
    } catch (err) {
      console.error("[Lead Summarizer] Error:", err);
      res.json({ success: false, error: String(err) });
    }
  });

  app.post("/api/leads/discover/freelancer", async (req, res) => {
    try {
      const { keyword, limit = 15 } = req.body;
      if (!keyword) return res.status(400).json({ error: "Keyword is required" });
      
      const cleanKeyword = keyword.replace(/["']/g, "").trim();
      // Request 60 items so we can filter down to low bid counts
      const url = `https://www.freelancer.com/api/projects/0.1/projects/active?query=${encodeURIComponent(cleanKeyword)}&job_details=true&limit=60`;
      
      console.log(`[Freelancer Discovery] Fetching query: "${cleanKeyword}"`);
      const response = await fetch(url, {
        headers: { 'User-Agent': 'Freelance-Goldmine-Lead-Finder', 'Accept': 'application/json' }
      });
      
      if (!response.ok) {
        return res.status(response.status).json({ error: `Freelancer API error: ${response.statusText}` });
      }
      
      const data = await response.json();
      const projects = (data.result && data.result.projects) || [];
      
      const spamRegex = /\b(copy paste|data entry|work from home|earn money|typing job|survey|captcha entry|make money)\b/i;
      
      // Filter: Keep only projects with <= 15 bids to stay ahead, and exclude spam
      const filteredProjects = projects.filter((proj: any) => {
        const bidCount = (proj.bid_stats && proj.bid_stats.bid_count) || 0;
        const titleText = proj.title || "";
        const descText = proj.description || "";
        const combinedText = `${titleText} \n ${descText}`;
        
        return bidCount <= 15 && !spamRegex.test(combinedText);
      }).slice(0, limit);
      
      const leads = filteredProjects.map((proj: any) => {
        const minBudget = proj.budget.minimum || 0;
        const maxBudget = proj.budget.maximum || 0;
        const currency = (proj.currency && proj.currency.code) || "USD";
        const budgetStr = minBudget > 0 ? `${minBudget}-${maxBudget} ${currency}` : "Hourly/Contract";
        
        return {
          id: `freelancer-${proj.id}`,
          name: `Freelancer Project | ID: ${proj.id}`,
          title: proj.title,
          rating: `💰 Budget: ${budgetStr}`,
          address: `https://www.freelancer.com/projects/${proj.seo_url}`,
          website: `https://www.freelancer.com/projects/${proj.seo_url}`,
          phone: "Freelancer.com Gigs",
          email: "No public email",
          niche: keyword,
          reviewsCount: proj.bid_stats ? proj.bid_stats.bid_count : 0,
          description: proj.description || "No description available."
        };
      });
      
      res.json({ status: "SUCCESS", results: leads });
    } catch (err) {
      console.error("[Freelancer Lead Discovery] Error:", err);
      res.status(500).json({ error: String(err) });
    }
  });

  app.post("/api/leads/discover/upwork", async (req, res) => {
    try {
      const { keyword } = req.body;
      if (!keyword) return res.status(400).json({ error: "Keyword is required" });
      
      const cleanKeyword = keyword.replace(/["']/g, "").trim();
      const query = `site:upwork.com/jobs "${cleanKeyword}"`;
      
      const engine = new ScraperEngine();
      await engine.init();
      const rawResults = await engine.scrapeGoogleDork(query);
      await engine.close();
      
      const leads = rawResults.map((result, i) => ({
        id: `upwork-${Date.now()}-${i}`,
        name: "Upwork Job Opportunity",
        title: result.title.replace(" - Upwork", "").replace(" | Upwork", "").trim(),
        rating: "Upwork Gig",
        address: result.url,
        website: result.url,
        phone: "Upwork Job Board",
        email: "No public email",
        niche: keyword,
        reviewsCount: 0,
        description: result.snippet || "View details on Upwork."
      }));
      
      res.json({ status: "SUCCESS", results: leads });
    } catch (err) {
      console.error("[Upwork Lead Discovery] Error:", err);
      res.status(500).json({ error: String(err) });
    }
  });

  app.post("/api/leads/discover/linkedin", async (req, res) => {
    try {
      const { keyword } = req.body;
      if (!keyword) return res.status(400).json({ error: "Keyword is required" });
      
      const cleanKeyword = keyword.replace(/["']/g, "").trim();
      const query = `site:linkedin.com/jobs "${cleanKeyword}"`;
      
      const engine = new ScraperEngine();
      await engine.init();
      const rawResults = await engine.scrapeGoogleDork(query);
      await engine.close();
      
      const spamRegex = /\b(copy paste|data entry|work from home|earn money|typing job|survey|captcha entry|make money)\b/i;
      
      const filteredResults = rawResults.filter(result => {
        const combinedText = `${result.title} \n ${result.snippet || ""}`;
        return !spamRegex.test(combinedText);
      });
      
      const leads = filteredResults.map((result, i) => {
        const emailRegex = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
        const foundEmails = result.snippet.match(emailRegex);
        const email = foundEmails ? foundEmails[0] : "No public email";
        
        return {
          id: `linkedin-${Date.now()}-${i}`,
          name: "LinkedIn Job Opportunity",
          title: result.title.replace(" - LinkedIn", "").replace(" | LinkedIn", "").trim(),
          rating: "LinkedIn Job",
          address: result.url,
          website: result.url,
          phone: "LinkedIn Jobs",
          email: email,
          niche: keyword,
          reviewsCount: 0,
          description: result.snippet || "View job details on LinkedIn."
        };
      });
      
      res.json({ status: "SUCCESS", results: leads });
    } catch (err) {
      console.error("[LinkedIn Lead Discovery] Error:", err);
      res.status(500).json({ error: String(err) });
    }
  });

  app.post("/api/leads/discover/twitter", async (req, res) => {
    try {
      const { keyword } = req.body;
      if (!keyword) return res.status(400).json({ error: "Keyword is required" });
      
      const cleanKeyword = keyword.replace(/["']/g, "").trim();
      const query = `site:x.com "hiring" "${cleanKeyword}"`;
      
      const engine = new ScraperEngine();
      await engine.init();
      const rawResults = await engine.scrapeGoogleDork(query);
      await engine.close();
      
      const spamRegex = /\b(copy paste|data entry|work from home|earn money|typing job|survey|captcha entry|make money)\b/i;
      
      const filteredResults = rawResults.filter(result => {
        const combinedText = `${result.title} \n ${result.snippet || ""}`;
        return !spamRegex.test(combinedText);
      });
      
      const leads = filteredResults.map((result, i) => {
        const emailRegex = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
        const foundEmails = result.snippet.match(emailRegex);
        const email = foundEmails ? foundEmails[0] : "No public email";
        
        return {
          id: `twitter-${Date.now()}-${i}`,
          name: "Twitter/X Post Lead",
          title: result.title.replace("on X:", "").replace("on Twitter:", "").trim(),
          rating: "Twitter/X Gig",
          address: result.url,
          website: result.url,
          phone: "Twitter/X Gigs",
          email: email,
          niche: keyword,
          reviewsCount: 0,
          description: result.snippet || "View details on Twitter/X."
        };
      });
      
      res.json({ status: "SUCCESS", results: leads });
    } catch (err) {
      console.error("[Twitter Lead Discovery] Error:", err);
      res.status(500).json({ error: String(err) });
    }
  });

  app.post("/api/website/generate", async (req, res) => {
    // Generate website structure using Gemini
    try {
      const response = await generateContentWithFallback(
        `Create a luxury React landing page structure for ${req.body.niche}.`,
        undefined,
        "gemini",
        "gemini-2.5-flash"
      );
      res.json({ success: true, websiteData: response.text });
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

interface ColorPalette {
  accent: string;
  secondary: string;
  darkAccent: string;
  bg?: string;
  bgAlt?: string;
}

interface ImageSet {
  hero: string;
  grid1: string;
  grid2: string;
}

interface NicheConfig {
  nicheName: string;
  themeStyle: "cream" | "clean-light" | "dark-tech";
  defaultHeroCtaPrimary: string;
  defaultHeroCtaSecondary: string;
  defaultHeaderCta: string;
  defaultTitle1: string;
  defaultTitleAccent: string;
  defaultSubtitle: string;
  contactHeading: string;
  contactSubtitle: string;
  colorPalettes: ColorPalette[];
  imageSets: ImageSet[];
}

const nicheConfigs: Record<string, NicheConfig> = {
  cafe: {
    nicheName: "cafe",
    themeStyle: "cream",
    defaultHeroCtaPrimary: "Book Table",
    defaultHeroCtaSecondary: "Read Reviews",
    defaultHeaderCta: "Book Table",
    defaultTitle1: "Delhi's Cozy Favorite",
    defaultTitleAccent: "5.0 ★ Google Rating",
    defaultSubtitle: "Welcome to [BUSINESS_NAME]. Discover why guests consistently rate us five stars for our cozy ambiance, premium artisanal coffee, and fresh pastries.",
    contactHeading: "Book a Table Today",
    contactSubtitle: "Have questions, special requests, or want to secure your reservation? Drop us a message.",
    colorPalettes: [
      { accent: "#B08968", secondary: "#7E8A73", darkAccent: "#4E342E", bg: "#FDFBF7", bgAlt: "#F5EFEB" },
      { accent: "#3F5E4D", secondary: "#D3A27F", darkAccent: "#1E3326", bg: "#FAF8F5", bgAlt: "#ECE8E1" },
      { accent: "#C77D58", secondary: "#8E7D73", darkAccent: "#5D3A26", bg: "#FDF9F4", bgAlt: "#F4EAE0" },
      { accent: "#7A4342", secondary: "#C59B6D", darkAccent: "#3B1B1C", bg: "#FDFBF8", bgAlt: "#F5EEEC" }
    ],
    imageSets: [
      { hero: "https://images.unsplash.com/photo-1507133750040-4a8f57021571?auto=format&fit=crop&q=80&w=600", grid1: "https://images.unsplash.com/photo-1495474472287-4d71bcdd2085?auto=format&fit=crop&q=80&w=600", grid2: "https://images.unsplash.com/photo-1554118811-1e0d58224f24?auto=format&fit=crop&q=80&w=600" },
      { hero: "https://images.unsplash.com/photo-1501339847302-ac426a4a7cbb?auto=format&fit=crop&q=80&w=600", grid1: "https://images.unsplash.com/photo-1497935586351-b67a49e012bf?auto=format&fit=crop&q=80&w=600", grid2: "https://images.unsplash.com/photo-1447078806655-40579c2520d6?auto=format&fit=crop&q=80&w=600" },
      { hero: "https://images.unsplash.com/photo-1511920170033-f8396924c348?auto=format&fit=crop&q=80&w=600", grid1: "https://images.unsplash.com/photo-1498804103079-a6351b050096?auto=format&fit=crop&q=80&w=600", grid2: "https://images.unsplash.com/photo-1509042239860-f550ce710b93?auto=format&fit=crop&q=80&w=600" },
      { hero: "https://images.unsplash.com/photo-1453614512568-c4024d13c247?auto=format&fit=crop&q=80&w=600", grid1: "https://images.unsplash.com/photo-1514432324607-a09d9b4aefdd?auto=format&fit=crop&q=80&w=600", grid2: "https://images.unsplash.com/photo-1517256064527-09c53b2d0bc6?auto=format&fit=crop&q=80&w=600" }
    ]
  },
  restaurant: {
    nicheName: "restaurant",
    themeStyle: "cream",
    defaultHeroCtaPrimary: "Book Table",
    defaultHeroCtaSecondary: "View Menu",
    defaultHeaderCta: "Book Table",
    defaultTitle1: "A Culinary Favorite",
    defaultTitleAccent: "5.0 ★ Google Rating",
    defaultSubtitle: "Savor the extraordinary at [BUSINESS_NAME]. See why food lovers consistently give us five stars for flavor, presentation, and friendly service.",
    contactHeading: "Reserve Your Table",
    contactSubtitle: "Have questions, special requests, or want to secure your reservation? Drop us a message.",
    colorPalettes: [
      { accent: "#C5A880", secondary: "#1e3a8a", darkAccent: "#0f172a", bg: "#FAF8F5", bgAlt: "#F2ECE6" },
      { accent: "#A85B55", secondary: "#4A5D4E", darkAccent: "#5E2E2A", bg: "#FDFBF7", bgAlt: "#ECE4E2" },
      { accent: "#7A4342", secondary: "#D3A27F", darkAccent: "#3B1B1C", bg: "#FCFAF8", bgAlt: "#F5EEEC" },
      { accent: "#1C1C1C", secondary: "#B3925D", darkAccent: "#0A0A0A", bg: "#FDFBF7", bgAlt: "#ECE8E1" }
    ],
    imageSets: [
      { hero: "https://images.unsplash.com/photo-1517248135467-4c7edcad34c4?auto=format&fit=crop&q=80&w=600", grid1: "https://images.unsplash.com/photo-1504674900247-0877df9cc836?auto=format&fit=crop&q=80&w=600", grid2: "https://images.unsplash.com/photo-1555396273-367ea4eb4db5?auto=format&fit=crop&q=80&w=600" },
      { hero: "https://images.unsplash.com/photo-1550966871-3ed3cdb5ed0c?auto=format&fit=crop&q=80&w=600", grid1: "https://images.unsplash.com/photo-1565299624946-b28f40a0ae38?auto=format&fit=crop&q=80&w=600", grid2: "https://images.unsplash.com/photo-1414235077428-338989a2e8c0?auto=format&fit=crop&q=80&w=600" },
      { hero: "https://images.unsplash.com/photo-1514933651103-005eec06c04b?auto=format&fit=crop&q=80&w=600", grid1: "https://images.unsplash.com/photo-1544025162-d76694265947?auto=format&fit=crop&q=80&w=600", grid2: "https://images.unsplash.com/photo-1579871494447-9811cf80d66c?auto=format&fit=crop&q=80&w=600" },
      { hero: "https://images.unsplash.com/photo-1552566626-52f8b828add9?auto=format&fit=crop&q=80&w=600", grid1: "https://images.unsplash.com/photo-1560684352-8497838a2229?auto=format&fit=crop&q=80&w=600", grid2: "https://images.unsplash.com/photo-1546069901-ba9599a7e63c?auto=format&fit=crop&q=80&w=600" }
    ]
  },
  clinic: {
    nicheName: "clinic",
    themeStyle: "clean-light",
    defaultHeroCtaPrimary: "Book Appointment",
    defaultHeroCtaSecondary: "Meet the Team",
    defaultHeaderCta: "Book Now",
    defaultTitle1: "Compassionate Family Care",
    defaultTitleAccent: "5.0 ★ Patient Rating",
    defaultSubtitle: "Discover why patients and clients rate us five stars for exceptional care, warm support, and outstanding professional results.",
    contactHeading: "Book an Appointment",
    contactSubtitle: "Need medical care or want to schedule a checkup? Get in touch with our team today.",
    colorPalettes: [
      { accent: "#0284c7", secondary: "#0d9488", darkAccent: "#0369a1" },
      { accent: "#4f46e5", secondary: "#06b6d4", darkAccent: "#3730a3" },
      { accent: "#0d9488", secondary: "#475569", darkAccent: "#115e59" },
      { accent: "#059669", secondary: "#0284c7", darkAccent: "#064e3b" }
    ],
    imageSets: [
      { hero: "https://images.unsplash.com/photo-1629909613654-28e377c37b09?auto=format&fit=crop&q=80&w=600", grid1: "https://images.unsplash.com/photo-1584515979956-d9f6e5d09982?auto=format&fit=crop&q=80&w=600", grid2: "https://images.unsplash.com/photo-1576091160550-2173dba999ef?auto=format&fit=crop&q=80&w=600" },
      { hero: "https://images.unsplash.com/photo-1606811971618-4486d14f3f99?auto=format&fit=crop&q=80&w=600", grid1: "https://images.unsplash.com/photo-148488278462e-19088439242b?auto=format&fit=crop&q=80&w=600", grid2: "https://images.unsplash.com/photo-1504813184591-015578a059cc?auto=format&fit=crop&q=80&w=600" },
      { hero: "https://images.unsplash.com/photo-1519494026892-80bbd2d6fd0d?auto=format&fit=crop&q=80&w=600", grid1: "https://images.unsplash.com/photo-1581098426820-2399a4a3fb3e?auto=format&fit=crop&q=80&w=600", grid2: "https://images.unsplash.com/photo-1551076805-e18690237571?auto=format&fit=crop&q=80&w=600" },
      { hero: "https://images.unsplash.com/photo-1579684389782-64d84b5e902a?auto=format&fit=crop&q=80&w=600", grid1: "https://images.unsplash.com/photo-1512678080530-7760d81faba6?auto=format&fit=crop&q=80&w=600", grid2: "https://images.unsplash.com/photo-1581594693702-fbdc51b2763b?auto=format&fit=crop&q=80&w=600" }
    ]
  },
  beauty: {
    nicheName: "beauty",
    themeStyle: "cream",
    defaultHeroCtaPrimary: "Book Session",
    defaultHeroCtaSecondary: "View Services",
    defaultHeaderCta: "Book Appointment",
    defaultTitle1: "Unwind in Pure Luxury",
    defaultTitleAccent: "4.9 ★ Guest Rating",
    defaultSubtitle: "Rediscover your glow at [BUSINESS_NAME]. Experience premium wellness treatments, expert styling, and highly customized services designed to pamper you.",
    contactHeading: "Schedule a Session",
    contactSubtitle: "Have questions about our collections, sizing, or orders? We'd love to hear from you.",
    colorPalettes: [
      { accent: "#E8B4B8", secondary: "#D8A48F", darkAccent: "#831843", bg: "#FAF6F0", bgAlt: "#F3E9DF" },
      { accent: "#D4A373", secondary: "#5E8A75", darkAccent: "#283618", bg: "#FDFBF7", bgAlt: "#EAE6E1" },
      { accent: "#C59B6D", secondary: "#7A4342", darkAccent: "#3B1B1C", bg: "#FDFBF8", bgAlt: "#F5EEEC" },
      { accent: "#C77D58", secondary: "#8E7D73", darkAccent: "#5D3A26", bg: "#FDF9F4", bgAlt: "#F4EAE0" }
    ],
    imageSets: [
      { hero: "https://images.unsplash.com/photo-1522337360788-8b13dee7a37e?auto=format&fit=crop&q=80&w=600", grid1: "https://images.unsplash.com/photo-1560750588-73207b1ef5b8?auto=format&fit=crop&q=80&w=600", grid2: "https://images.unsplash.com/photo-1512290923902-8a9f81dc236c?auto=format&fit=crop&q=80&w=600" },
      { hero: "https://images.unsplash.com/photo-1540555700478-4be289fbecef?auto=format&fit=crop&q=80&w=600", grid1: "https://images.unsplash.com/photo-1512290923902-8a9f81dc236c?auto=format&fit=crop&q=80&w=600", grid2: "https://images.unsplash.com/photo-1522337360788-8b13dee7a37e?auto=format&fit=crop&q=80&w=600" },
      { hero: "https://images.unsplash.com/photo-1560750588-73207b1ef5b8?auto=format&fit=crop&q=80&w=600", grid1: "https://images.unsplash.com/photo-1522337360788-8b13dee7a37e?auto=format&fit=crop&q=80&w=600", grid2: "https://images.unsplash.com/photo-1512290923902-8a9f81dc236c?auto=format&fit=crop&q=80&w=600" },
      { hero: "https://images.unsplash.com/photo-1512290923902-8a9f81dc236c?auto=format&fit=crop&q=80&w=600", grid1: "https://images.unsplash.com/photo-1560750588-73207b1ef5b8?auto=format&fit=crop&q=80&w=600", grid2: "https://images.unsplash.com/photo-1522337360788-8b13dee7a37e?auto=format&fit=crop&q=80&w=600" }
    ]
  },
  gym: {
    nicheName: "gym",
    themeStyle: "dark-tech",
    defaultHeroCtaPrimary: "Start Training",
    defaultHeroCtaSecondary: "Read Reviews",
    defaultHeaderCta: "Join Now",
    defaultTitle1: "Delhi's Top-Rated Gym",
    defaultTitleAccent: "5.0 ★ Rating",
    defaultSubtitle: "See what members say about our expert coaches, top-tier equipment, and supportive community. Real reviews from real results at [BUSINESS_NAME].",
    contactHeading: "Start Your Journey Today",
    contactSubtitle: "Ready to hit your fitness goals? Drop us a message to secure your trial pass.",
    colorPalettes: [
      { accent: "#ef4444", secondary: "#9ca3af", darkAccent: "#7f1d1d", bg: "#0d0d0d", bgAlt: "#171717" },
      { accent: "#f59e0b", secondary: "#ffffff", darkAccent: "#78350f", bg: "#08080a", bgAlt: "#141419" },
      { accent: "#10b981", secondary: "#64748b", darkAccent: "#064e3b", bg: "#05080c", bgAlt: "#0f141f" },
      { accent: "#ec4899", secondary: "#8b5cf6", darkAccent: "#831843", bg: "#05030a", bgAlt: "#110d22" }
    ],
    imageSets: [
      { hero: "https://images.unsplash.com/photo-1517838277536-f5f99be501cd?auto=format&fit=crop&q=80&w=600", grid1: "https://images.unsplash.com/photo-1534438327276-14e5300c3a48?auto=format&fit=crop&q=80&w=600", grid2: "https://images.unsplash.com/photo-1541534741688-6078c6bfb5c5?auto=format&fit=crop&q=80&w=600" },
      { hero: "https://images.unsplash.com/photo-1518310383802-640c2de311b2?auto=format&fit=crop&q=80&w=600", grid1: "https://images.unsplash.com/photo-1571019613454-1cb2f99b2d8b?auto=format&fit=crop&q=80&w=600", grid2: "https://images.unsplash.com/photo-1599058917212-d750089bc07e?auto=format&fit=crop&q=80&w=600" },
      { hero: "https://images.unsplash.com/photo-1583454110551-21f2fa2afe61?auto=format&fit=crop&q=80&w=600", grid1: "https://images.unsplash.com/photo-1518611012118-696072aa579a?auto=format&fit=crop&q=80&w=600", grid2: "https://images.unsplash.com/photo-1548690312-e3b507d8c110?auto=format&fit=crop&q=80&w=600" },
      { hero: "https://images.unsplash.com/photo-1593079831268-3381b0db4a77?auto=format&fit=crop&q=80&w=600", grid1: "https://images.unsplash.com/photo-1574680096145-d05b474e2155?auto=format&fit=crop&q=80&w=600", grid2: "https://images.unsplash.com/photo-1594381898411-846e7d193883?auto=format&fit=crop&q=80&w=600" }
    ]
  },
  hotel: {
    nicheName: "hotel",
    themeStyle: "cream",
    defaultHeroCtaPrimary: "Book Stay",
    defaultHeroCtaSecondary: "Read Reviews",
    defaultHeaderCta: "Book Stay",
    defaultTitle1: "Voted Best Retreat",
    defaultTitleAccent: "4.9 ★ Guest Rating",
    defaultSubtitle: "Read why guests rate our luxury rooms, impeccable service, and immersive amenities five stars. Your dream escape at [BUSINESS_NAME] is highly recommended.",
    contactHeading: "Reserve Your Stay",
    contactSubtitle: "Planning your next getaway? Connect with us to secure your luxury rooms.",
    colorPalettes: [
      { accent: "#C5A880", secondary: "#5D7A8C", darkAccent: "#1e3a8a", bg: "#FDFBF7", bgAlt: "#EAE5DF" },
      { accent: "#4A5D4E", secondary: "#CBB089", darkAccent: "#202D23", bg: "#FAF9F6", bgAlt: "#EBEBE4" },
      { accent: "#A85B55", secondary: "#557A95", darkAccent: "#5E2E2A", bg: "#FAF6F5", bgAlt: "#ECE4E2" },
      { accent: "#1C1C1C", secondary: "#B3925D", darkAccent: "#0A0A0A", bg: "#FCFAF8", bgAlt: "#F2ECE6" }
    ],
    imageSets: [
      { hero: "https://images.unsplash.com/photo-1566073771259-6a8506099945?auto=format&fit=crop&q=80&w=600", grid1: "https://images.unsplash.com/photo-1520250497591-112f2f40a3f4?auto=format&fit=crop&q=80&w=600", grid2: "https://images.unsplash.com/photo-1582719508461-905c673771fd?auto=format&fit=crop&q=80&w=600" },
      { hero: "https://images.unsplash.com/photo-1540555700478-4be289fbecef?auto=format&fit=crop&q=80&w=600", grid1: "https://images.unsplash.com/photo-1517840901100-8179e982acb7?auto=format&fit=crop&q=80&w=600", grid2: "https://images.unsplash.com/photo-1590490360182-c33d57733427?auto=format&fit=crop&q=80&w=600" },
      { hero: "https://images.unsplash.com/photo-1445019980597-93fa8acb246c?auto=format&fit=crop&q=80&w=600", grid1: "https://images.unsplash.com/photo-1546964124-0cce460f38ef?auto=format&fit=crop&q=80&w=600", grid2: "https://images.unsplash.com/photo-1551882547-ff40c63fe5fa?auto=format&fit=crop&q=80&w=600" },
      { hero: "https://images.unsplash.com/photo-1571896349842-33c89424de2d?auto=format&fit=crop&q=80&w=600", grid1: "https://images.unsplash.com/photo-1498503182468-3b51cbb6cb24?auto=format&fit=crop&q=80&w=600", grid2: "https://images.unsplash.com/photo-1584132967334-10e028bd69f7?auto=format&fit=crop&q=80&w=600" }
    ]
  },
  retail: {
    nicheName: "retail",
    themeStyle: "clean-light",
    defaultHeroCtaPrimary: "Shop Collection",
    defaultHeroCtaSecondary: "Read Reviews",
    defaultHeaderCta: "Shop Now",
    defaultTitle1: "Loved by Style Enthusiasts",
    defaultTitleAccent: "4.9 ★ Community Rating",
    defaultSubtitle: "Explore verified testimonials from our happy customers. Premium handcrafted quality and timeless elegance backed by real feedback at [BUSINESS_NAME].",
    contactHeading: "Get in Touch",
    contactSubtitle: "Have questions about our collections, sizing, or orders? We'd love to hear from you.",
    colorPalettes: [
      { accent: "#059669", secondary: "#3b82f6", darkAccent: "#064e3b" },
      { accent: "#db2777", secondary: "#1e293b", darkAccent: "#9d174d" },
      { accent: "#d97706", secondary: "#0f172a", darkAccent: "#78350f" },
      { accent: "#4f46e5", secondary: "#ea580c", darkAccent: "#3730a3" }
    ],
    imageSets: [
      { hero: "https://images.unsplash.com/photo-1441986300917-64674bd600d8?auto=format&fit=crop&q=80&w=600", grid1: "https://images.unsplash.com/photo-1479064555552-3ef4979f8908?auto=format&fit=crop&q=80&w=600", grid2: "https://images.unsplash.com/photo-1441984969893-c534e9749e47?auto=format&fit=crop&q=80&w=600" },
      { hero: "https://images.unsplash.com/photo-1483985988355-763728e1935b?auto=format&fit=crop&q=80&w=600", grid1: "https://images.unsplash.com/photo-1486406146926-c627a92ad1ab?auto=format&fit=crop&q=80&w=600", grid2: "https://images.unsplash.com/photo-1523381210434-271e8be1f52b?auto=format&fit=crop&q=80&w=600" },
      { hero: "https://images.unsplash.com/photo-1555529669-e69e7aa0ba9a?auto=format&fit=crop&q=80&w=600", grid1: "https://images.unsplash.com/photo-1540959733332-eab4deabeeaf?auto=format&fit=crop&q=80&w=600", grid2: "https://images.unsplash.com/photo-1556742049-0cfed4f6a45d?auto=format&fit=crop&q=80&w=600" },
      { hero: "https://images.unsplash.com/photo-1513885045260-6b31b6be3f4b?auto=format&fit=crop&q=80&w=600", grid1: "https://images.unsplash.com/photo-1469334031218-e382a71b716b?auto=format&fit=crop&q=80&w=600", grid2: "https://images.unsplash.com/photo-1490481651871-ab68de25d43d?auto=format&fit=crop&q=80&w=600" }
    ]
  },
  professional: {
    nicheName: "professional",
    themeStyle: "clean-light",
    defaultHeroCtaPrimary: "Book Consultation",
    defaultHeroCtaSecondary: "Client Testimonials",
    defaultHeaderCta: "Contact Us",
    defaultTitle1: "Trusted Advisory Services",
    defaultTitleAccent: "5.0 ★ Client Rating",
    defaultSubtitle: "Welcome to [BUSINESS_NAME]. Read real, verified reviews from businesses and individuals who rely on our counsel, strategic planning, and exceptional execution.",
    contactHeading: "Request Consultation",
    contactSubtitle: "Ready to discuss your options? Reach out to our specialist team for a consultation.",
    colorPalettes: [
      { accent: "#b45309", secondary: "#1e293b", darkAccent: "#7c2d12" },
      { accent: "#2563eb", secondary: "#1e293b", darkAccent: "#1e3a8a" },
      { accent: "#0d9488", secondary: "#475569", darkAccent: "#115e59" },
      { accent: "#4f46e5", secondary: "#0f172a", darkAccent: "#3730a3" }
    ],
    imageSets: [
      { hero: "https://images.unsplash.com/photo-1454165804606-c3d57bc86b40?auto=format&fit=crop&q=80&w=600", grid1: "https://images.unsplash.com/photo-1589829545856-d10d557cf95f?auto=format&fit=crop&q=80&w=600", grid2: "https://images.unsplash.com/photo-1450133064473-71024230f91b?auto=format&fit=crop&q=80&w=600" },
      { hero: "https://images.unsplash.com/photo-1521791136368-1a9b79741631?auto=format&fit=crop&q=80&w=600", grid1: "https://images.unsplash.com/photo-1507679799987-c73779587ccf?auto=format&fit=crop&q=80&w=600", grid2: "https://images.unsplash.com/photo-1573497019940-1c28c88b4f3e?auto=format&fit=crop&q=80&w=600" },
      { hero: "https://images.unsplash.com/photo-1486406146926-c627a92ad1ab?auto=format&fit=crop&q=80&w=600", grid1: "https://images.unsplash.com/photo-1560179707-f14e90ef3623?auto=format&fit=crop&q=80&w=600", grid2: "https://images.unsplash.com/photo-1557804506-669a67965ba0?auto=format&fit=crop&q=80&w=600" },
      { hero: "https://images.unsplash.com/photo-1427504494785-3a9ca7044f45?auto=format&fit=crop&q=80&w=600", grid1: "https://images.unsplash.com/photo-1523050854058-8df90110c9f1?auto=format&fit=crop&q=80&w=600", grid2: "https://images.unsplash.com/photo-1524178232363-1fb2b075b655?auto=format&fit=crop&q=80&w=600" }
    ]
  },
  trades: {
    nicheName: "trades",
    themeStyle: "clean-light",
    defaultHeroCtaPrimary: "Request Quote",
    defaultHeroCtaSecondary: "View Our Work",
    defaultHeaderCta: "Get Estimate",
    defaultTitle1: "Masterful Quality Craftsmanship",
    defaultTitleAccent: "4.9 ★ Community Rating",
    defaultSubtitle: "Welcome to [BUSINESS_NAME]. Discover why homeowners and contractors rate us five stars for reliable service, master craft, and prompt turnaround.",
    contactHeading: "Request an Estimate",
    contactSubtitle: "Need help with a project or repair? Get in touch for a detailed estimate.",
    colorPalettes: [
      { accent: "#ea580c", secondary: "#475569", darkAccent: "#7c2d12" },
      { accent: "#d97706", secondary: "#1e293b", darkAccent: "#78350f" },
      { accent: "#2563eb", secondary: "#475569", darkAccent: "#1e3a8a" },
      { accent: "#059669", secondary: "#1e293b", darkAccent: "#064e3b" }
    ],
    imageSets: [
      { hero: "https://images.unsplash.com/photo-1504307651254-35680f356dfd?auto=format&fit=crop&q=80&w=600", grid1: "https://images.unsplash.com/photo-1621905251189-08b45d6a269e?auto=format&fit=crop&q=80&w=600", grid2: "https://images.unsplash.com/photo-1581094288338-2314dddb7ecc?auto=format&fit=crop&q=80&w=600" },
      { hero: "https://images.unsplash.com/photo-1541535881962-e668f2244a26?auto=format&fit=crop&q=80&w=600", grid1: "https://images.unsplash.com/photo-1508962914676-134849a727f0?auto=format&fit=crop&q=80&w=600", grid2: "https://images.unsplash.com/photo-1534224039826-c7a0dea0e66a?auto=format&fit=crop&q=80&w=600" },
      { hero: "https://images.unsplash.com/photo-1564013799919-ab600027ffc6?auto=format&fit=crop&q=80&w=600", grid1: "https://images.unsplash.com/photo-1600585154340-be6161a56a0c?auto=format&fit=crop&q=80&w=600", grid2: "https://images.unsplash.com/photo-1582268611958-ebfd161ef9cf?auto=format&fit=crop&q=80&w=600" },
      { hero: "https://images.unsplash.com/photo-1581092921461-eab62e97a780?auto=format&fit=crop&q=80&w=600", grid1: "https://images.unsplash.com/photo-1581092160607-ee22621dd758?auto=format&fit=crop&q=80&w=600", grid2: "https://images.unsplash.com/photo-1581093458791-9f3c3900df4b?auto=format&fit=crop&q=80&w=600" }
    ]
  },
  automotive: {
    nicheName: "automotive",
    themeStyle: "dark-tech",
    defaultHeroCtaPrimary: "Book Service",
    defaultHeroCtaSecondary: "Read Reviews",
    defaultHeaderCta: "Schedule Service",
    defaultTitle1: "Precision Automotive Care",
    defaultTitleAccent: "5.0 ★ Star Rating",
    defaultSubtitle: "Welcome to [BUSINESS_NAME]. See why drivers trust our certified mechanics for speedy diagnostics, high-quality repairs, and honest rates.",
    contactHeading: "Schedule a Service",
    contactSubtitle: "Need a repair, maintenance check, or diagnostics? Drop us a line today.",
    colorPalettes: [
      { accent: "#ef4444", secondary: "#6b7280", darkAccent: "#7f1d1d", bg: "#0a0a0a", bgAlt: "#141414" },
      { accent: "#f59e0b", secondary: "#9ca3af", darkAccent: "#78350f", bg: "#0d0d0d", bgAlt: "#171717" },
      { accent: "#2563eb", secondary: "#ffffff", darkAccent: "#1e3a8a", bg: "#070b14", bgAlt: "#0f1524" },
      { accent: "#10b981", secondary: "#9ca3af", darkAccent: "#064e3b", bg: "#09090b", bgAlt: "#18181b" }
    ],
    imageSets: [
      { hero: "https://images.unsplash.com/photo-1486006920555-c77dce18193b?auto=format&fit=crop&q=80&w=600", grid1: "https://images.unsplash.com/photo-1517524206127-48bbd363f3d7?auto=format&fit=crop&q=80&w=600", grid2: "https://images.unsplash.com/photo-1619642751034-765dfdf7c58e?auto=format&fit=crop&q=80&w=600" },
      { hero: "https://images.unsplash.com/photo-1507136566006-cfc505b114fc?auto=format&fit=crop&q=80&w=600", grid1: "https://images.unsplash.com/photo-1568605114967-8130f3a36994?auto=format&fit=crop&q=80&w=600", grid2: "https://images.unsplash.com/photo-1517524206127-48bbd363f3d7?auto=format&fit=crop&q=80&w=600" },
      { hero: "https://images.unsplash.com/photo-1617788138017-80ad40651399?auto=format&fit=crop&q=80&w=600", grid1: "https://images.unsplash.com/photo-1507136566006-cfc505b114fc?auto=format&fit=crop&q=80&w=600", grid2: "https://images.unsplash.com/photo-1619642751034-765dfdf7c58e?auto=format&fit=crop&q=80&w=600" },
      { hero: "https://images.unsplash.com/photo-1552519507-da3b142c6e3d?auto=format&fit=crop&q=80&w=600", grid1: "https://images.unsplash.com/photo-1605559424843-9e4c228bf1c2?auto=format&fit=crop&q=80&w=600", grid2: "https://images.unsplash.com/photo-1511919884226-fd3cad34687c?auto=format&fit=crop&q=80&w=600" }
    ]
  },
  tech: {
    nicheName: "tech",
    themeStyle: "dark-tech",
    defaultHeroCtaPrimary: "Get Started",
    defaultHeroCtaSecondary: "Watch Demo",
    defaultHeaderCta: "Try Free",
    defaultTitle1: "Highly Recommended Platform",
    defaultTitleAccent: "4.9 ★ Community Rating",
    defaultSubtitle: "Welcome to [BUSINESS_NAME]. Discover why companies rate us five stars for exceptional technology, seamless integrations, and world-class developer tools.",
    contactHeading: "Start Your Journey Today",
    contactSubtitle: "Ready to accelerate your operations? Reach out to get started.",
    colorPalettes: [
      { accent: "#8b5cf6", secondary: "#ec4899", darkAccent: "#4c1d95", bg: "#05020c", bgAlt: "#0c0817" },
      { accent: "#2563eb", secondary: "#06b6d4", darkAccent: "#1e3a8a", bg: "#030712", bgAlt: "#0b1329" },
      { accent: "#8b5cf6", secondary: "#3b82f6", darkAccent: "#4c1d95", bg: "#040814", bgAlt: "#0b1126" },
      { accent: "#ec4899", secondary: "#8b5cf6", darkAccent: "#831843", bg: "#05030a", bgAlt: "#110d22" }
    ],
    imageSets: [
      { hero: "https://images.unsplash.com/photo-1531403009284-440f080d1e12?auto=format&fit=crop&q=80&w=600", grid1: "https://images.unsplash.com/photo-1486312338219-ce68d2c6f44d?auto=format&fit=crop&q=80&w=600", grid2: "https://images.unsplash.com/photo-1522071820081-009f0129c71c?auto=format&fit=crop&q=80&w=600" },
      { hero: "https://images.unsplash.com/photo-1518770660439-4636190af475?auto=format&fit=crop&q=80&w=600", grid1: "https://images.unsplash.com/photo-1550751827-4bd374c3f58b?auto=format&fit=crop&q=80&w=600", grid2: "https://images.unsplash.com/photo-1526374965328-7f61d4dc18c5?auto=format&fit=crop&q=80&w=600" },
      { hero: "https://images.unsplash.com/photo-1498050108023-c5249f4df085?auto=format&fit=crop&q=80&w=600", grid1: "https://images.unsplash.com/photo-1555066931-4365d14bab8c?auto=format&fit=crop&q=80&w=600", grid2: "https://images.unsplash.com/photo-1461749280684-dccba630e2f6?auto=format&fit=crop&q=80&w=600" },
      { hero: "https://images.unsplash.com/photo-1504384308090-c894fdcc538d?auto=format&fit=crop&q=80&w=600", grid1: "https://images.unsplash.com/photo-1517694712202-14dd9538aa97?auto=format&fit=crop&q=80&w=600", grid2: "https://images.unsplash.com/photo-1527689368864-3a821dbccc34?auto=format&fit=crop&q=80&w=600" }
    ]
  }
};

function getNicheConfig(name: string, category: string, detectedNiche?: string): NicheConfig {
  const catNorm = ((category || "") + " " + (name || "") + " " + (detectedNiche || "")).toLowerCase();
  
  if (catNorm.includes("cafe") || catNorm.includes("coffee") || catNorm.includes("bake") || catNorm.includes("tea") || catNorm.includes("espresso") || catNorm.includes("roastery") || catNorm.includes("donut") || catNorm.includes("patisserie") || catNorm.includes("bakery")) {
    return nicheConfigs.cafe;
  }
  if (catNorm.includes("restaurant") || catNorm.includes("food") || catNorm.includes("diner") || catNorm.includes("bistro") || catNorm.includes("grill") || catNorm.includes("pizzeria") || catNorm.includes("sushi") || catNorm.includes("steakhouse") || catNorm.includes("dining") || catNorm.includes("luxury restaurant")) {
    return nicheConfigs.restaurant;
  }
  if (catNorm.includes("clinic") || catNorm.includes("dentist") || catNorm.includes("health") || catNorm.includes("care") || catNorm.includes("hospital") || catNorm.includes("doctor") || catNorm.includes("medical") || catNorm.includes("smile") || catNorm.includes("physio") || catNorm.includes("therapy") || catNorm.includes("chiro") || catNorm.includes("healthcare")) {
    return nicheConfigs.clinic;
  }
  if (catNorm.includes("beauty") || catNorm.includes("spa") || catNorm.includes("salon") || catNorm.includes("cosmetic") || catNorm.includes("hair") || catNorm.includes("nail") || catNorm.includes("massage") || catNorm.includes("wellness")) {
    return nicheConfigs.beauty;
  }
  if (catNorm.includes("gym") || catNorm.includes("fitness") || catNorm.includes("workout") || catNorm.includes("train") || catNorm.includes("crossfit") || catNorm.includes("yoga") || catNorm.includes("pilates") || catNorm.includes("boxing") || catNorm.includes("studio")) {
    return nicheConfigs.gym;
  }
  if (catNorm.includes("hotel") || catNorm.includes("resort") || catNorm.includes("stay") || catNorm.includes("motel") || catNorm.includes("inn") || catNorm.includes("lodging") || catNorm.includes("hostel") || catNorm.includes("travel")) {
    return nicheConfigs.hotel;
  }
  if (catNorm.includes("shop") || catNorm.includes("store") || catNorm.includes("boutique") || catNorm.includes("ecommerce") || catNorm.includes("retail") || catNorm.includes("florist") || catNorm.includes("flower") || catNorm.includes("jewelry") || catNorm.includes("clothing") || catNorm.includes("supermarket") || catNorm.includes("luxury ecommerce")) {
    return nicheConfigs.retail;
  }
  if (catNorm.includes("law") || catNorm.includes("legal") || catNorm.includes("firm") || catNorm.includes("attorney") || catNorm.includes("consult") || catNorm.includes("finance") || catNorm.includes("wealth") || catNorm.includes("invest") || catNorm.includes("advisor") || catNorm.includes("bank") || catNorm.includes("real estate") || catNorm.includes("property") || catNorm.includes("agency") || catNorm.includes("law firm") || catNorm.includes("crypto")) {
    return nicheConfigs.professional;
  }
  if (catNorm.includes("construct") || catNorm.includes("build") || catNorm.includes("electric") || catNorm.includes("plumb") || catNorm.includes("carpentry") || catNorm.includes("handyman") || catNorm.includes("repair") || catNorm.includes("roofing") || catNorm.includes("painting") || catNorm.includes("construction")) {
    if (catNorm.includes("auto") || catNorm.includes("car") || catNorm.includes("garage") || catNorm.includes("vehicle") || catNorm.includes("tire") || catNorm.includes("mechanic")) {
      return nicheConfigs.automotive;
    }
    return nicheConfigs.trades;
  }
  if (catNorm.includes("auto") || catNorm.includes("car") || catNorm.includes("garage") || catNorm.includes("vehicle") || catNorm.includes("tire") || catNorm.includes("mechanic") || catNorm.includes("detail")) {
    return nicheConfigs.automotive;
  }
  return nicheConfigs.tech;
}

const safeMoveVideo = async (src: string, dest: string, retries = 5, delay = 500) => {
  for (let i = 0; i < retries; i++) {
    try {
      if (fs.existsSync(dest)) {
        fs.unlinkSync(dest);
      }
      fs.renameSync(src, dest);
      console.log(`[Video Sync] Successfully moved video from ${src} to ${dest}`);
      return;
    } catch (e: any) {
      console.warn(`[Video Sync] Attempt ${i + 1} failed to rename video: ${e.message}. Retrying in ${delay}ms...`);
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
  // Fallback to copy and unlink
  try {
    fs.copyFileSync(src, dest);
    fs.unlinkSync(src);
    console.log(`[Video Sync] Fallback copy/delete succeeded for video.`);
  } catch (err: any) {
    console.error(`[Video Sync] Fallback copy failed:`, err);
    throw new Error(`Failed to finalize video file: ${err.message}`);
  }
};

  async function processOutreach(req: any, res: any) {
    const { leadId, name, category, rating, reviewsCount, phone, photos, location, address, mapsUrl } = req.body;
    let leadPhotos: string[] = Array.isArray(photos) ? photos.slice(0, 5) : [];
    const leadLocation = location || address || "";
    
    if (!leadId || !name) {
      return res.status(400).json({ error: "Lead ID and name are required" });
    }

    const sanitizeId = (id: string): string => {
      let decoded = id;
      try {
        decoded = decodeURIComponent(id);
      } catch (e) {}
      return decoded
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "");
    };

    const sanitizedId = sanitizeId(leadId);
    let rawVideoPath = "";

    try {
      console.log(`[Outreach Factory] Generating assets for: ${name} (${category}) (Sanitized ID: ${sanitizedId})`);

      // Map category to template type
      const catNorm = ((category || "") + " " + (name || "")).toLowerCase();
      let templateType = "cafe"; // default fallback
      if (catNorm.includes("clothing") || catNorm.includes("boutique") || catNorm.includes("store") || catNorm.includes("shop") || catNorm.includes("ecommerce") || catNorm.includes("retail") || catNorm.includes("wear") ||
          catNorm.includes("saree") || catNorm.includes("sari") || catNorm.includes("sadi") || catNorm.includes("vastra") || catNorm.includes("lehenga") || catNorm.includes("ethnic") || catNorm.includes("kurti") ||
          catNorm.includes("ladies") || catNorm.includes("traditional") || catNorm.includes("fashion") || catNorm.includes("suit") || catNorm.includes("matching") || catNorm.includes("tailor") || catNorm.includes("hosiery") ||
          catNorm.includes("textile") || catNorm.includes("garment") || catNorm.includes("handloom") || catNorm.includes("readymade") || catNorm.includes("drape") || catNorm.includes("salwar") || catNorm.includes("apparel") ||
          catNorm.includes("jewellery") || catNorm.includes("jewelry") || catNorm.includes("ornament") || catNorm.includes("gold") || catNorm.includes("silver") || catNorm.includes("diamond") || catNorm.includes("collection")) {
        templateType = "ecommerce";
      } else if (catNorm.includes("restaurant") || catNorm.includes("food") || catNorm.includes("diner") || catNorm.includes("bistro") || catNorm.includes("grill") || catNorm.includes("pizzeria") || catNorm.includes("sushi") || catNorm.includes("steakhouse") || catNorm.includes("dining") || catNorm.includes("eats")) {
        templateType = "restaurant";
      } else if (catNorm.includes("cafe") || catNorm.includes("coffee") || catNorm.includes("bake") || catNorm.includes("tea") || catNorm.includes("espresso") || catNorm.includes("roastery") || catNorm.includes("donut") || catNorm.includes("patisserie") || catNorm.includes("bakery")) {
        templateType = "cafe";
      }

      if (leadPhotos.length < 5) {
        console.log(`[Outreach Factory] Lead ${name} has ${leadPhotos.length} photo(s). Fetching full gallery from Google Maps...`);
        try {
          const fetchedPhotos = await ScraperEngine.fetchPhotosForBusiness(name, leadLocation, mapsUrl, category);
          if (fetchedPhotos && fetchedPhotos.length > 0) {
            const combined = [...leadPhotos, ...fetchedPhotos];
            const uniquePhotos = Array.from(new Set(combined));
            leadPhotos = uniquePhotos.slice(0, 12);
            console.log(`[Outreach Factory] Successfully enriched ${leadPhotos.length} gallery photos for ${name}`);
          }
        } catch (e) {
          console.error(`[Outreach Factory] Failed to fetch gallery photos for ${name}`, e);
        }
      }

      const videosDir = path.join(process.cwd(), "public", "videos");
      if (!fs.existsSync(videosDir)) fs.mkdirSync(videosDir, { recursive: true });

      // 2. Playwright Video Recording with Auto-Scroll
      let recordingStart = Date.now();
      const browser = await launchBrowser();
      rawVideoPath = "";
      try {
        const context = await browser.newContext({
          viewport: { width: 1280, height: 720 },
          recordVideo: {
            dir: videosDir,
            size: { width: 1280, height: 720 }
          }
        });
        try {
          const page = await context.newPage();
          page.setDefaultTimeout(90000);
          recordingStart = Date.now(); // Reset recording start to exact moment page is created
          
          const photosParam = leadPhotos.length > 0 ? `&photos=${encodeURIComponent(JSON.stringify(leadPhotos))}` : '';
          const targetUrl = `http://localhost:${PORT}/templates/${templateType}?name=${encodeURIComponent(name)}&category=${encodeURIComponent(category || "")}&phone=${encodeURIComponent(phone || "")}${photosParam}`;
          console.log(`[Outreach Playwright] Navigating to: ${targetUrl}`);
          await page.goto(targetUrl, { waitUntil: "load", timeout: 60000 });
          
          // Wait for the cinematic loading screen to fully animate and disappear
          // The Nexvora-style loader takes ~3-4s (progress fill + 1.4s fade-out)
          try {
            await page.waitForFunction(() => {
              // Wait until body overflow is unset (preloader finished and hidden/removed)
              return document.body.style.overflow !== "hidden";
            }, { timeout: 15000 });
            console.log(`[Outreach Playwright] Loading screen animation completed`);
          } catch (e) {
            console.log(`[Outreach Playwright] Loading screen timeout, continuing...`);
          }
          await page.waitForTimeout(800); // Extra settle time after loader disappears

          // Set scroll duration to 12 seconds for a faster, more engaging scroll speed
          let scrollDownDuration = 12000;

          // Get total scrollable height
          const totalScrollable = await page.evaluate(() => document.documentElement.scrollHeight - window.innerHeight);
          console.log(`[Outreach Playwright] Scroll Down Duration: ${scrollDownDuration}ms | Scrollable height: ${totalScrollable}px`);

          // 2. Smooth scroll down using mouse.wheel (bypasses any JS/CSS scroll blocking)
          {
            const steps = Math.ceil(scrollDownDuration / 50); // one wheel tick every 50ms
            const pixelsPerStep = totalScrollable / steps;
            for (let i = 0; i < steps; i++) {
              await page.mouse.wheel(0, pixelsPerStep);
              await page.waitForTimeout(50);
            }
          }

          // 3. Hold at the bottom for 0.6 seconds
          await page.waitForTimeout(600);

          // 4. Smooth scroll back to top using mouse.wheel (negative delta)
          {
            const scrollUpDuration = 1000;
            const currentY = await page.evaluate(() => window.scrollY);
            const steps = Math.ceil(scrollUpDuration / 50);
            const pixelsPerStep = currentY / steps;
            for (let i = 0; i < steps; i++) {
              await page.mouse.wheel(0, -pixelsPerStep);
              await page.waitForTimeout(50);
            }
          }

          // 5. Final wait to ensure total video duration is exactly 30.0 seconds
          const finalElapsed = Date.now() - recordingStart;
          const finalWait = 30000 - finalElapsed;
          if (finalWait > 0) {
            await page.waitForTimeout(finalWait);
          }

          // Close page to finalize video recording
          const video = page.video();
          if (video) {
            rawVideoPath = await video.path();
          }
        } finally {
          // If rawVideoPath is not set, try to grab it from context before closing
          if (!rawVideoPath) {
            try {
              const pages = context.pages();
              if (pages.length > 0 && pages[0].video()) {
                rawVideoPath = await pages[0].video()!.path();
              }
            } catch (e) {}
          }
          await context.close();
        }
      } finally {
        await browser.close();
      }

      console.log(`[Outreach Factory] Playwright finished. Raw video path: ${rawVideoPath}`);

      if (!rawVideoPath || !fs.existsSync(rawVideoPath)) {
        throw new Error("Failed to capture video in Playwright.");
      }

      // Save as webm (natively supported by Playwright)
      const finalWebmPath = path.join(videosDir, `${sanitizedId}.webm`);
      await safeMoveVideo(rawVideoPath, finalWebmPath);

      // Convert to mp4 for WhatsApp compatibility using ffmpeg
      const finalMp4Path = path.join(videosDir, `${sanitizedId}.mp4`);
      console.log(`[Outreach Factory] Converting webm to mp4 for WhatsApp compatibility using ffmpeg...`);
      
      let ffmpegSuccessful = false;
      const child_process = await import("child_process");
      const { execSync } = child_process;

      // 1. Try with ffmpeg-static
      try {
        const ffmpegStaticMod = await import("ffmpeg-static");
        const ffmpegStatic = ffmpegStaticMod.default || ffmpegStaticMod;
        if (ffmpegStatic && fs.existsSync(ffmpegStatic as string)) {
          console.log(`[Outreach Factory] Trying ffmpeg-static at ${ffmpegStatic}...`);
          execSync(`"${ffmpegStatic}" -y -i "${finalWebmPath}" -c:v libx264 -profile:v high -level:v 4.0 -pix_fmt yuv420p -c:a aac -b:a 128k "${finalMp4Path}"`);
          console.log(`[Outreach Factory] ffmpeg-static conversion successful: ${finalMp4Path}`);
          ffmpegSuccessful = true;
        }
      } catch (err: any) {
        console.warn(`[Outreach Factory] ffmpeg-static failed (permissions or format error):`, err.message || err);
      }

      // 2. Fallback to global ffmpeg
      if (!ffmpegSuccessful) {
        try {
          console.log(`[Outreach Factory] Falling back to global system ffmpeg...`);
          execSync(`ffmpeg -y -i "${finalWebmPath}" -c:v libx264 -profile:v high -level:v 4.0 -pix_fmt yuv420p -c:a aac -b:a 128k "${finalMp4Path}"`);
          console.log(`[Outreach Factory] Global system ffmpeg conversion successful: ${finalMp4Path}`);
          ffmpegSuccessful = true;
        } catch (globalErr: any) {
          console.error(`[Outreach Factory] Global ffmpeg conversion also failed. No mp4 generated:`, globalErr.message || globalErr);
        }
      }

      const digitsOnly = phone ? String(phone).replace(/[^0-9]/g, "") : "";
      let isIndia = false;
      if (digitsOnly) {
        let tempPhone = digitsOnly;
        if (tempPhone.startsWith("0091")) tempPhone = tempPhone.substring(2);
        if (tempPhone.startsWith("910") && tempPhone.length === 13) tempPhone = "91" + tempPhone.substring(3);
        if (tempPhone.startsWith("0") && tempPhone.length === 11) tempPhone = tempPhone.substring(1);
        if (tempPhone.length === 10) tempPhone = "91" + tempPhone;
        
        if (tempPhone.startsWith("91") && tempPhone.length === 12) {
          isIndia = true;
        }
      }

      const isClothing = (catNorm.includes("saree") || 
                          catNorm.includes("sari") || 
                          catNorm.includes("sadi") || 
                          catNorm.includes("vastra") || 
                          catNorm.includes("lehenga") || 
                          catNorm.includes("ethnic") || 
                          catNorm.includes("kurti") ||
                          catNorm.includes("clothing") ||
                          catNorm.includes("fashion") ||
                          catNorm.includes("boutique") ||
                          catNorm.includes("wear") ||
                          catNorm.includes("collection") ||
                          catNorm.includes("apparel") ||
                          catNorm.includes("garment") ||
                          catNorm.includes("salwar") ||
                          catNorm.includes("kurta"));

      let pitchTemplateSuffix = "";
      if (isIndia) {
        if (isClothing) {
          pitchTemplateSuffix = "make it live in 1 week with complete premium features and all integrations for just ₹20,000!";
        } else {
          pitchTemplateSuffix = "make it live in 2 days for just ₹5,000!";
        }
      } else {
        if (isClothing) {
          pitchTemplateSuffix = "make it live in 1 week with complete premium features and all integrations for just $500!";
        } else {
          pitchTemplateSuffix = "make it live in 2 days for just $200!";
        }
      }

      // 3. Craft Personalized Sales Pitch (AI Disabled to save time/tokens)
      // We use their exact Meta template text so it shows up correctly in the CRM UI fallback.
      let messageText = `Hi ${name}!\n\nI found your business online and made this quick 20-second website preview for you.\n\nWe can build a website like this for just $99.\n\nTap an option below if you'd like to know more.`;

      let finalVideoUrl = `/videos/${sanitizedId}.mp4`;
      
      // Attempt to upload to Supabase storage to get a public URL for WhatsApp
      if (ffmpegSuccessful && isSupabaseConfigured) {
        try {
          const fsModule = await import("fs");
          const fileBuffer = fsModule.readFileSync(finalMp4Path);
          const fileName = `outreach-${sanitizedId}-${Date.now()}.mp4`;
          const uploadUrl = `${SUPABASE_URL}/storage/v1/object/chat-media/${fileName}`;
          
          console.log(`[Outreach Factory] Uploading video to Supabase Storage at ${uploadUrl}...`);
          
          const uploadRes = await fetch(uploadUrl, {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${SUPABASE_KEY}`,
              'Content-Type': 'video/mp4'
            },
            body: fileBuffer
          });
          
          if (uploadRes.ok) {
            finalVideoUrl = `${SUPABASE_URL}/storage/v1/object/public/chat-media/${fileName}`;
            console.log(`[Outreach Factory] Successfully uploaded video to Supabase. Public URL: ${finalVideoUrl}`);
          } else {
            const errData = await uploadRes.json().catch(() => ({}));
            console.error(`[Outreach Factory] Failed to upload to Supabase:`, uploadRes.status, errData);
          }
        } catch (uploadErr) {
          console.error(`[Outreach Factory] Error uploading to Supabase:`, uploadErr);
        }
      }

      res.json({
        success: true,
        videoUrl: finalVideoUrl,
        websiteUrl: `/templates/${templateType}?name=${encodeURIComponent(name)}&category=${encodeURIComponent(category || "")}&phone=${encodeURIComponent(phone || "")}${leadPhotos.length > 0 ? '&photos=' + encodeURIComponent(JSON.stringify(leadPhotos)) : ''}`,
        message: messageText
      });

    } catch (error: any) {
      console.error("[Outreach Error]", error);
      // Clean up the orphaned temporary video file if it was created
      if (rawVideoPath && fs.existsSync(rawVideoPath)) {
        try {
          fs.unlinkSync(rawVideoPath);
          console.log(`[Video Cleanup] Deleted temporary video file after failure: ${rawVideoPath}`);
        } catch (cleanupErr) {
          console.error(`[Video Cleanup] Failed to delete temporary video:`, cleanupErr);
        }
      }
      res.status(500).json({ error: error.message || "Outreach assets generation failed" });
    }
  }

  app.post("/api/leads/generate-outreach", (req, res) => {
    outreachQueue = outreachQueue.then(async () => {
      try {
        await processOutreach(req, res);
      } catch (err) {
        console.error("[Queue Error]", err);
      }
    });
  });

  app.post("/api/leads/download-videos-zip", async (req, res) => {
    const { videos } = req.body;
    if (!videos || !Array.isArray(videos)) {
      return res.status(400).json({ error: "Videos array is required" });
    }
    try {
      const zip = new AdmZip();
      let addedAny = false;

      for (const v of videos) {
        if (v.url) {
          const relativePath = v.url.startsWith("/") ? v.url.substring(1) : v.url;
          const filePath = path.join(process.cwd(), "public", relativePath);
          if (fs.existsSync(filePath)) {
            const cleanName = v.name ? v.name.replace(/[^a-zA-Z0-9]+/g, "-").toLowerCase() : "video";
            const ext = path.extname(filePath) || ".mp4";
            zip.addLocalFile(filePath, undefined, `${cleanName}${ext}`);
            addedAny = true;
          }
        }
      }

      if (!addedAny) {
        return res.status(400).json({ error: "No video files found on server to zip." });
      }

      const zipBuffer = zip.toBuffer();
      res.setHeader("Content-Type", "application/zip");
      res.setHeader("Content-Disposition", `attachment; filename=outreach_videos_${Date.now()}.zip`);
      res.send(zipBuffer);
    } catch (error: any) {
      console.error("[Zip Error]", error);
      res.status(500).json({ error: error.message || "Failed to generate zip archive" });
    }
  });

  app.post("/api/whatsapp/create_chat", async (req, res) => {
    const { phone, name } = req.body;
    if (!phone) {
      return res.status(400).json({ error: "Phone number is required" });
    }
    try {
      if (!isSupabaseConfigured) {
        return res.status(500).json({ error: "Supabase is not configured in CRM" });
      }

      const { userId, accountId } = await resolveActiveUserAndAccount();
      const contactId = await syncLeadToSupabase({ name: name || phone, phone });

      if (!contactId) {
        return res.status(500).json({ error: "Failed to create contact in Supabase" });
      }

      // Check if conversation already has messages. If not, log initial message.
      const convs = await querySupabase(`conversations?account_id=eq.${accountId}&contact_id=eq.${contactId}&limit=1`);
      let conversationId = convs && convs.length > 0 ? convs[0].id : null;

      let hasMessages = false;
      if (conversationId) {
        const msgs = await querySupabase(`messages?conversation_id=eq.${conversationId}&limit=1`);
        if (msgs && msgs.length > 0) {
          hasMessages = true;
        }
      }

      if (!hasMessages) {
        await logMessageToCRM(contactId, userId, accountId, "Chat initialized manually.");
      }

      res.json({ success: true, contactId, conversationId });
    } catch (error: any) {
      console.error("[WhatsApp Create Chat Error]", error);
      res.status(500).json({ error: error.message || "Failed to create chat" });
    }
  });

  app.post("/api/whatsapp/send", async (req, res) => {
    const { phone, message, videoUrl, apiKey, apiUrl, name } = req.body;
    if (!phone || !message) {
      return res.status(400).json({ error: "Phone number and message are required" });
    }
    try {
      const { sendWhatsAppViaCRM } = await import("./lib/crm");
      const result = await sendWhatsAppViaCRM(phone, name, message, videoUrl, apiKey, apiUrl);
      if (!result.success) {
        return res.status(500).json({ error: result.error || "Failed to send WhatsApp message" });
      }

      // If Supabase CRM is configured, sync contact name and log message to database
      if (isSupabaseConfigured) {
        try {
          const contactId = await syncLeadToSupabase({ name: name || phone, phone, videoUrl });
          if (contactId) {
            // We NO LONGER call logMessageToCRM here because the CRM API (/api/v1/messages) 
            // automatically inserts the message record into Supabase upon successful send!
            // Calling it here causes duplicate (and incorrectly typed 'text') messages in the UI.
            const { userId, accountId } = await resolveActiveUserAndAccount();
            // await logMessageToCRM(contactId, userId, accountId, message, videoUrl);
          }
        } catch (dbErr) {
          console.error("[Supabase CRM Sync Error]", dbErr);
        }
      }

      res.json({ success: true, messageId: result.messageId });
    } catch (error: any) {
      console.error("[WhatsApp Send Error]", error);
      res.status(500).json({ error: error.message || "Failed to send WhatsApp message" });
    }
  });

  // ==========================================
  // STOCK RESEARCH & ANALYST ENGINE API ROUTES
  // ==========================================
  app.get("/api/stock/list", async (_req, res) => {
    try {
      const { stockResearchEngine } = await import("./lib/stockEngine.js");
      const stocks = stockResearchEngine.getKnownStocks();
      res.json({ success: true, stocks });
    } catch (error: any) {
      res.status(500).json({ error: error.message || "Failed to fetch stock list" });
    }
  });

  const normalizeTicker = (raw: string) => {
    let t = decodeURIComponent(raw || "").toUpperCase().trim();
    if (t.includes("NSEI") || t === "NIFTY" || t === "NIFTY50") return "^NSEI";
    if (t.includes("BSESN") || t === "SENSEX") return "^BSESN";
    if (t === "BANKNIFTY" || t === "NIFTYBANK") return "^NSEBANK";

    const usTickers = ["AAPL", "NVDA", "TSLA", "MSFT", "GOOGL", "AMZN", "META", "AMD", "NFLX"];
    const isCrypto = t.includes("BTC") || t.includes("ETH") || t.includes("SOL") || t.includes("XRP") || t.includes("DOGE") || t.includes("BNB") || t.includes("ADA") || t.includes("AVAX") || t.includes("DOT") || t.includes("LINK") || t.endsWith("USD") || t.endsWith("USDT");
    if (usTickers.includes(t) || isCrypto) return t;

    if (!t.endsWith(".NS") && !t.endsWith(".BO") && !t.startsWith("^")) {
      return `${t}.NS`;
    }
    return t;
  };

  app.get("/api/stock/:ticker/live-quote", async (req, res) => {
    const ticker = normalizeTicker(req.params.ticker);
    if (!ticker) return res.status(400).json({ error: "Ticker is required" });
    try {
      const { stockResearchEngine } = await import("./lib/stockEngine.js");
      const quote = await stockResearchEngine.fetchRealTimeQuote(ticker);
      res.json({ success: true, ticker, quote });
    } catch (error: any) {
      console.error("[Stock Live Quote Error]", error);
      res.status(500).json({ error: error.message || "Failed to fetch live quote" });
    }
  });

  // Live candle data from brokerTickEngine (real market data)
  app.get("/api/stock/:ticker/live-candles", (req, res) => {
    const ticker = normalizeTicker(req.params.ticker);
    const timeframe = (req.query.timeframe as string) || "5m";
    if (!ticker) return res.status(400).json({ error: "Ticker is required" });

    // Resolve internal symbol key (e.g. "RELIANCE.NS" -> "RELIANCE")
    const cleanSymbol = ticker.replace(".NS", "").replace(".BO", "").replace("^", "").toUpperCase();
    
    const candles = brokerTickEngine.getHistoricalCandles(cleanSymbol, timeframe);
    const lastPrice = brokerTickEngine.getLastKnownPrice(cleanSymbol);
    const status = brokerTickEngine.getStatus();

    res.json({
      success: true,
      ticker,
      timeframe,
      candles,
      lastRealPrice: lastPrice,
      feedStatus: status,
      source: "TRADINGVIEW_SCANNER_REAL_FEED"
    });
  });

  // 👼 ANGEL ONE SMARTAPI BACKEND ENDPOINTS
  app.post("/api/broker/angelone/login", async (req, res) => {
    try {
      const apiKey = req.body?.apiKey || process.env.ANGEL_ONE_API_KEY || "2q2aiOnl";
      const clientCode = req.body?.clientCode || process.env.ANGEL_ONE_CLIENT_CODE || "S1309208";
      const mpin = req.body?.mpin || process.env.ANGEL_ONE_MPIN || "0500";
      const totpSecret = req.body?.totpSecret || process.env.ANGEL_ONE_TOTP_SECRET || "WUAZT3HMARBH2BJ3NFKI5XYI2I";

      const { angelOneSmartApiEngine } = await import("./lib/angelOneSmartApiEngine.js");
      const result = await angelOneSmartApiEngine.generateSession({ apiKey, clientCode, mpin, totpSecret });
      res.json(result);
    } catch (e: any) {
      res.status(500).json({ success: false, message: e.message });
    }
  });

  app.get("/api/broker/angelone/token/:symbol", async (req, res) => {
    try {
      const symbol = req.params.symbol;
      const exchange = (req.query.exchange as string) || "NSE";
      const { angelOneSmartApiEngine } = await import("./lib/angelOneSmartApiEngine.js");
      const token = angelOneSmartApiEngine.getToken(symbol, exchange);
      res.json({ success: true, symbol, exchange, token });
    } catch (e: any) {
      res.status(500).json({ success: false, message: e.message });
    }
  });

  app.get("/api/broker/angelone/candles", async (req, res) => {
    try {
      const symbol = (req.query.symbol as string) || "RELIANCE";
      const cleanSym = symbol.toUpperCase().replace(".NS", "").replace(".BO", "").replace("^", "").trim();
      const isCrypto = cleanSym.includes("BTC") || cleanSym.includes("ETH") || cleanSym.includes("SOL") || cleanSym.includes("XRP") || cleanSym.includes("DOGE") || cleanSym.includes("BNB") || cleanSym.includes("ADA") || cleanSym.includes("AVAX") || cleanSym.includes("DOT") || cleanSym.includes("LINK") || cleanSym.endsWith("USD") || cleanSym.endsWith("USDT");
      const isUsStock = ["AAPL", "NVDA", "TSLA", "MSFT", "AMZN", "GOOGL", "META"].includes(cleanSym);
      const isCommodity = cleanSym.includes("CRUDE") || cleanSym.includes("GOLD") || cleanSym.includes("SILVER") || cleanSym.includes("NATURAL") || cleanSym.includes("COPPER") || cleanSym.includes("CL=") || cleanSym.includes("GC=") || cleanSym.includes("SI=") || cleanSym.includes("NG=");
      const exchange = (req.query.exchange as string) || (isCrypto ? "CRYPTO" : (isUsStock ? "NASDAQ" : (isCommodity ? "MCX" : "NSE")));
      const interval = (req.query.interval as any) || "FIVE_MINUTE";
      const { angelOneSmartApiEngine } = await import("./lib/angelOneSmartApiEngine.js");
      const { stockResearchEngine } = await import("./lib/stockEngine.js");

      let candles: any[] = [];

      // A. Real 100% Authentic Crypto & US Stock Candles (Bitstamp/Yahoo/Coinbase)
      if (isCrypto || isUsStock) {
        try {
          const tfMap: Record<string, { range: string; interval: string }> = {
            "ONE_MINUTE": { range: "1d", interval: "1m" },
            "1m": { range: "1d", interval: "1m" },
            "FIVE_MINUTE": { range: "2d", interval: "5m" },
            "5m": { range: "2d", interval: "5m" },
            "FIFTEEN_MINUTE": { range: "7d", interval: "15m" },
            "15m": { range: "7d", interval: "15m" },
            "ONE_HOUR": { range: "30d", interval: "60m" },
            "1H": { range: "30d", interval: "60m" },
            "ONE_DAY": { range: "1y", interval: "1d" },
            "1D": { range: "1y", interval: "1d" }
          };
          const cfg = tfMap[interval] || { range: "2d", interval: "5m" };
          const baseSym = cleanSym.replace("USDT", "").replace("USD", "");
          const pair = isUsStock ? cleanSym : `${baseSym}-USD`;

          const yUrl = `https://query2.finance.yahoo.com/v8/finance/chart/${pair}?range=${cfg.range}&interval=${cfg.interval}`;
          const yRes = await fetch(yUrl, {
            headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36" }
          });
          if (yRes.ok) {
            const json = await yRes.json();
            const result = json?.chart?.result?.[0];
            const timestamps = result?.timestamp;
            const quote = result?.indicators?.quote?.[0];
            if (Array.isArray(timestamps) && quote) {
              const parsed: any[] = [];
              for (let i = 0; i < timestamps.length; i++) {
                const o = quote.open[i];
                const h = quote.high[i];
                const l = quote.low[i];
                const c = quote.close[i];
                const v = quote.volume[i];
                if (o != null && h != null && l != null && c != null) {
                  const openVal = Number(o.toFixed(2));
                  const closeVal = Number(c.toFixed(2));
                  const highVal = Number(Math.max(h, openVal, closeVal).toFixed(2));
                  const lowVal = Number(Math.min(l, openVal, closeVal).toFixed(2));

                  parsed.push({
                    time: new Date(timestamps[i] * 1000).toISOString().split('T')[0],
                    timeSec: timestamps[i],
                    open: openVal,
                    high: highVal,
                    low: lowVal,
                    close: closeVal,
                    volume: Number((v || 100).toFixed(2))
                  });
                }
              }
              if (parsed.length > 0) {
                candles = parsed.sort((a, b) => a.timeSec - b.timeSec);
              }
            }
          }
        } catch (yErr) {
          console.warn("[Candles API] Crypto/US Candles Fetch Error:", yErr);
        }
      } else {
        // B. Angel One SmartAPI Candles for NSE / MCX / BSE
        const token = angelOneSmartApiEngine.getToken(symbol, exchange);
        candles = await angelOneSmartApiEngine.fetchCandles(token, exchange, interval);
      }

      if (!candles || candles.length === 0) {
        // Fallback to real exchange history generator (NIFTY = 23,869.6, RELIANCE = 1,272.2)
        candles = await stockResearchEngine.generateOHLCVHistory(symbol, 30);
      }

      res.setHeader("Content-Type", "application/json");
      res.json({ success: true, symbol, exchange, interval, candles });
    } catch (e: any) {
      res.setHeader("Content-Type", "application/json");
      res.status(500).json({ success: false, message: e.message });
    }
  });

  app.get("/api/broker/angelone/expiries", async (req, res) => {
    try {
      const symbol = (req.query.symbol as string) || "CRUDEOIL";
      const { angelOneSmartApiEngine } = await import("./lib/angelOneSmartApiEngine.js");
      const contracts = angelOneSmartApiEngine.getExpiryContracts(symbol);
      res.setHeader("Content-Type", "application/json");
      res.json({ success: true, symbol, contracts });
    } catch (e: any) {
      res.setHeader("Content-Type", "application/json");
      res.status(500).json({ success: false, message: e.message });
    }
  });

  // Zero-Latency Server-Sent Events (SSE) Realtime Tick Streaming Endpoint
  app.get("/api/broker/ticks/stream", async (req, res) => {
    const rawSymbol = String(req.query.symbol || "^NSEI");
    
    const canonicalize = (s: string) => {
      const u = (s || "").toUpperCase().replace(".NS", "").replace(".BO", "").replace("^", "").trim();
      if (u === "NIFTY" || u === "NIFTY50" || u === "NSEI" || u === "NIFTY-50") return "NIFTY50";
      if (u === "BANKNIFTY" || u === "NSEBANK" || u === "NIFTYBANK") return "BANKNIFTY";
      if (u === "SENSEX" || u === "BSESN") return "SENSEX";
      return u;
    };

    const reqCanonical = canonicalize(rawSymbol);

    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");

    const { brokerTickEngine } = await import("./lib/brokerTickEngine.js");

    const onTick = (tick: any) => {
      if (!tick || !tick.symbol) return;
      const tickCanonical = canonicalize(tick.symbol);
      if (tickCanonical === reqCanonical) {
        try {
          res.write(`data: ${JSON.stringify({ type: "tick", ...tick })}\n\n`);
        } catch (e) {}
      }
    };

    brokerTickEngine.on("tick", onTick);

    // Keepalive ping every 5 seconds
    const keepAlive = setInterval(() => {
      try {
        res.write(`: ping\n\n`);
      } catch (e) {}
    }, 5000);

    req.on("close", () => {
      clearInterval(keepAlive);
      brokerTickEngine.off("tick", onTick);
    });
  });

  app.post("/api/broker/angelone/market-quote", async (req, res) => {
    try {
      const { mode, exchangeTokens } = req.body;
      const { angelOneSmartApiEngine } = await import("./lib/angelOneSmartApiEngine.js");
      const result = await angelOneSmartApiEngine.getMarketQuote(mode || "FULL", exchangeTokens);
      res.json(result);
    } catch (e: any) {
      res.status(500).json({ success: false, message: e.message });
    }
  });

  app.post("/api/broker/angelone/order", async (req, res) => {
    try {
      const { payload, isManualApproved } = req.body;
      const { angelOneSmartApiEngine } = await import("./lib/angelOneSmartApiEngine.js");
      const result = await angelOneSmartApiEngine.placeOrder(payload, isManualApproved);
      res.json(result);
    } catch (e: any) {
      res.status(500).json({ success: false, message: e.message });
    }
  });

  // ────────── DELTA EXCHANGE CRYPTO API ROUTES ──────────
  app.get("/api/broker/delta/status", async (req, res) => {
    try {
      const { deltaExchangeEngine } = await import("./lib/deltaExchangeEngine.js");
      res.json({
        success: true,
        wsConnected: deltaExchangeEngine.isWsConnected(),
        usdInrRate: deltaExchangeEngine.getUsdInrRate(),
        trackedSymbolsCount: deltaExchangeEngine.getAllPrices().size,
        productsCount: deltaExchangeEngine.getAllProducts().length
      });
    } catch (e: any) {
      res.status(500).json({ success: false, message: e.message });
    }
  });

  app.get("/api/broker/delta/products", async (req, res) => {
    try {
      const { deltaExchangeEngine } = await import("./lib/deltaExchangeEngine.js");
      const products = deltaExchangeEngine.getAllProducts();
      res.json({ success: true, count: products.length, products });
    } catch (e: any) {
      res.status(500).json({ success: false, message: e.message });
    }
  });

  app.get("/api/broker/delta/ticker/:symbol", async (req, res) => {
    try {
      const { symbol } = req.params;
      const { deltaExchangeEngine } = await import("./lib/deltaExchangeEngine.js");
      const priceData = deltaExchangeEngine.getLivePrice(symbol);
      const ticker = await deltaExchangeEngine.fetchTicker(symbol);
      res.json({
        success: true,
        symbol: symbol.toUpperCase(),
        cachedPrice: priceData,
        ticker
      });
    } catch (e: any) {
      res.status(500).json({ success: false, message: e.message });
    }
  });

  app.get("/api/broker/delta/candles", async (req, res) => {
    try {
      const symbol = (req.query.symbol as string) || "BTCUSD";
      const resolution = (req.query.resolution as string) || "1m";
      const { deltaExchangeEngine } = await import("./lib/deltaExchangeEngine.js");
      const candles = await deltaExchangeEngine.fetchCandles(symbol, resolution);
      res.json({ success: true, symbol, resolution, count: candles.length, candles });
    } catch (e: any) {
      res.status(500).json({ success: false, message: e.message });
    }
  });

  app.get("/api/broker/delta/wallet", async (req, res) => {
    try {
      const { deltaExchangeEngine } = await import("./lib/deltaExchangeEngine.js");
      const balances = await deltaExchangeEngine.fetchWalletBalance();
      res.json({ success: true, balances });
    } catch (e: any) {
      res.status(500).json({ success: false, message: e.message });
    }
  });

  app.post("/api/broker/delta/auto-trader/run", async (req, res) => {
    try {
      const { symbol } = req.body || {};
      const { autonomousCryptoTrader } = await import("./scripts/autonomousCryptoTrader.js");
      const sessionResult = await autonomousCryptoTrader.runAutonomousTradeSession(symbol || "BTCUSD");
      res.json({ success: true, sessionResult });
    } catch (e: any) {
      res.status(500).json({ success: false, message: e.message });
    }
  });


  app.get("/api/stock/:ticker/recommendation", async (req, res) => {
    const ticker = normalizeTicker(req.params.ticker);
    if (!ticker) return res.status(400).json({ error: "Ticker is required" });
    try {
      const { stockResearchEngine } = await import("./lib/stockEngine.js");
      const force = req.query.force !== "false";
      const category = (req.query.category as any) || "SWING_TRADER";
      const recommendation = await stockResearchEngine.analyzeStock(ticker, force, category).catch(async () => {
        return await stockResearchEngine.analyzeStock(ticker, false, category);
      });
      res.json({ success: true, recommendation });
    } catch (error: any) {
      console.error("[Stock API Error]", error);
      res.status(200).json({
        success: true,
        recommendation: {
          ticker,
          companyName: ticker,
          currentPrice: 1000,
          recommendation: "HOLD",
          confidenceScore: 75,
          targetPrice1: 1050,
          targetPrice2: 1100,
          stopLossPrice: 950,
          riskRewardRatio: 2.0,
          analysisDate: new Date().toISOString().split("T")[0],
          technicalSummary: "Fallback analysis active. Monitoring live exchange ticks.",
          keyNewsItems: [],
          fundamentalMetrics: { peRatio: 20, pbRatio: 2.5, debtToEquity: 0.5, roePct: 15 }
        }
      });
    }
  });

  // ─── Autonomous Decision Engine — One-Click Analysis Pipeline ───
  app.post("/api/stock/:ticker/autonomous-analysis", async (req, res) => {
    const ticker = normalizeTicker(req.params.ticker);
    if (!ticker) return res.status(400).json({ error: "Ticker is required" });
    try {
      const { autonomousDecisionEngine } = await import("./lib/autonomousDecisionEngine.js");
      const tradingCategory = req.body?.tradingCategory || "SWING_TRADER";
      console.log(`[API] 🧠 Autonomous analysis triggered for ${ticker} (${tradingCategory})`);
      const result = await autonomousDecisionEngine.analyze(ticker, tradingCategory);
      res.json({ success: true, result });
    } catch (error: any) {
      console.error("[Autonomous Decision Engine Error]", error);
      res.status(500).json({ error: error.message || "Decision engine failed" });
    }
  });

  app.get("/api/stock/:ticker/price-history", async (req, res) => {
    const ticker = normalizeTicker(req.params.ticker);
    const days = Number(req.query.days) || 90;
    if (!ticker) return res.status(400).json({ error: "Ticker is required" });
    try {
      const { stockResearchEngine } = await import("./lib/stockEngine.js");
      const history = await stockResearchEngine.generateOHLCVHistory(ticker, days);
      res.json({ success: true, ticker, history });
    } catch (error: any) {
      console.error("[Stock Price History Error]", error);
      res.status(500).json({ error: error.message || "Failed to fetch price history" });
    }
  });

  app.get("/api/stock/chart", async (req, res) => {
    const symbol = String(req.query.symbol || "^NSEI").toUpperCase().trim();
    const range = String(req.query.range || "3mo");
    const interval = String(req.query.interval || "1d");

    const targetUrl = `https://query2.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=${range}&interval=${interval}`;

    try {
      const response = await fetch(targetUrl, {
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
        }
      });

      if (response.ok) {
        const json = await response.json();
        return res.json({ success: true, json, isReal: true });
      }
      return res.status(response.status).json({ error: "Failed to fetch from Yahoo Finance" });
    } catch (err: any) {
      return res.status(500).json({ error: err.message || "Proxy error" });
    }
  });

  app.get("/api/stock/search", async (req, res) => {
    const query = String(req.query.q || "");
    try {
      const { stockResearchEngine } = await import("./lib/stockEngine.js");
      const results = await stockResearchEngine.searchTickers(query);
      res.json({ success: true, results });
    } catch (error: any) {
      res.status(500).json({ error: error.message || "Search failed" });
    }
  });

  app.post("/api/stock/:ticker/chat", async (req, res) => {
    const { ticker } = req.params;
    const { message, recommendation } = req.body;
    if (!message) return res.status(400).json({ error: "Message is required" });
    try {
      const { stockResearchEngine } = await import("./lib/stockEngine.js");
      const rec = recommendation || await stockResearchEngine.analyzeStock(ticker);
      const reply = await stockResearchEngine.chatWithAnalyst(ticker, message, rec);
      res.json({ success: true, reply });
    } catch (error: any) {
      console.error("[Stock Chat Error]", error);
      res.status(500).json({ error: error.message || "Failed to process chat" });
    }
  });

  // Defensive URI Sanitization Middleware to prevent decodeURI malformed crashes in Vite
  app.use((req, res, next) => {
    try {
      if (req.url) {
        decodeURI(req.url);
      }
    } catch (e) {
      req.url = req.url.replace(/%(?![0-9A-Fa-f]{2})/g, "%25");
    }
    next();
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        watch: {
          ignored: [
            '**/.delta_auto_trader_state.json',
            '**/.paper_trading_state.json',
            '**/*.json',
            '**/*.log',
            '**/scratch/**',
            '**/.system_generated/**',
            '**/tests/**',
            '**/public/**',
            '**/.whatsapp_session/**',
            '**/*.md',
            '**/dist/**'
          ]
        }
      },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    // Support React Router SPA fallback
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  const portNumber = Number(process.env.PORT) || PORT || 3002;
  const server = app.listen(portNumber, "0.0.0.0", () => {
    console.log(`Server running on http://0.0.0.0:${portNumber}`);
  });

  // FASTAPI / EXPRESS WEBSOCKET ENDPOINT (/ws/candles?symbol=RELIANCE&timeframe=5m)
  const wss = new WebSocketServer({ noServer: true });

  server.on("upgrade", (request, socket, head) => {
    const pathname = request.url?.split("?")[0];
    if (pathname === "/ws/candles") {
      wss.handleUpgrade(request, socket, head, (ws) => {
        wss.emit("connection", ws, request);
      });
    }
  });

  wss.on("connection", (ws: WebSocket, req) => {
    const urlParams = new URLSearchParams(req.url?.split("?")[1] || "");
    const symbol = (urlParams.get("symbol") || "^NSEI").toUpperCase();
    const timeframe = urlParams.get("timeframe") || "5m";

    console.log(`[WebSocket Server] 🔌 Client connected for symbol: ${symbol} (${timeframe})`);

    // 1. Send last ~100 historical candles first so chart is never empty on load
    const history = brokerTickEngine.getHistoricalCandles(symbol, timeframe);
    ws.send(JSON.stringify({
      type: "HISTORICAL_BACKFILL",
      symbol,
      timeframe,
      bars: history
    }));

    // 2. Stream live tick/candle updates in real time
    const onCandleUpdate = (data: any) => {
      if (data.symbol === symbol && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(data));
      }
    };

    brokerTickEngine.on("candle_update", onCandleUpdate);

    ws.on("close", () => {
      console.log(`[WebSocket Server] ❌ Client disconnected for symbol: ${symbol}`);
      brokerTickEngine.off("candle_update", onCandleUpdate);
    });
  });
}

process.on("uncaughtException", (err) => {
  console.error("[Server Process] ⚠️ Uncaught Exception caught (preventing crash):", err?.message || err);
});

process.on("unhandledRejection", (reason) => {
  console.error("[Server Process] ⚠️ Unhandled Rejection caught (preventing crash):", reason);
});

startServer();
