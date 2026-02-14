import { createMcpHandler } from "mcp-handler";
import { z } from "zod";
import { getCustomer } from "@/lib/google-ads-client";

const handler = createMcpHandler(
  (server) => {

    // ==========================================
    // ACCOUNT & MCC
    // ==========================================

    server.registerTool("list_accounts", {
      title: "List Google Ads Accounts",
      description: "Listet alle Google Ads Konten im MCC auf.",
      inputSchema: {},
    }, async () => {
      try {
        const customer = getCustomer(process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID!);
        const results = await customer.query(`
          SELECT customer_client.id, customer_client.descriptive_name,
            customer_client.status, customer_client.manager,
            customer_client.currency_code, customer_client.time_zone
          FROM customer_client WHERE customer_client.status = 'ENABLED'
        `);
        return { content: [{ type: "text" as const, text: JSON.stringify(results.map((r: any) => ({
          id: r.customer_client.id, name: r.customer_client.descriptive_name,
          status: r.customer_client.status, isManager: r.customer_client.manager,
          currency: r.customer_client.currency_code, timezone: r.customer_client.time_zone,
        })), null, 2) }] };
      } catch (e: any) { const msg = e.message || e.errors?.[0]?.message || e.details?.[0]?.errors?.[0]?.message || (typeof e === "object" ? JSON.stringify(e) : String(e)); return { content: [{ type: "text" as const, text: `Fehler: ${msg}` }] }; }
    });

    server.registerTool("get_account_info", {
      title: "Get Account Info",
      description: "Zeigt Details zu einem Google Ads Konto.",
      inputSchema: { customer_id: z.string().describe("Google Ads Customer ID (ohne Bindestriche)") },
    }, async ({ customer_id }) => {
      try {
        const customer = getCustomer(customer_id);
        const results = await customer.query(`
          SELECT customer.id, customer.descriptive_name, customer.currency_code,
            customer.time_zone, customer.auto_tagging_enabled,
            customer.optimization_score, customer.status
          FROM customer LIMIT 1
        `);
        return { content: [{ type: "text" as const, text: JSON.stringify(results, null, 2) }] };
      } catch (e: any) { const msg = e.message || e.errors?.[0]?.message || e.details?.[0]?.errors?.[0]?.message || (typeof e === "object" ? JSON.stringify(e) : String(e)); return { content: [{ type: "text" as const, text: `Fehler: ${msg}` }] }; }
    });

    // ==========================================
    // KAMPAGNEN
    // ==========================================

    server.registerTool("get_campaign_performance", {
      title: "Get Campaign Performance",
      description: "Zeigt Kampagnen-Performance für ein Konto.",
      inputSchema: {
        customer_id: z.string().describe("Google Ads Customer ID"),
        date_range: z.enum(["LAST_7_DAYS","LAST_14_DAYS","LAST_30_DAYS","THIS_MONTH","LAST_MONTH","LAST_90_DAYS"]).default("LAST_30_DAYS"),
      },
    }, async ({ customer_id, date_range }) => {
      try {
        const customer = getCustomer(customer_id);
        const results = await customer.query(`
          SELECT campaign.id, campaign.name, campaign.status, campaign.advertising_channel_type,
            metrics.impressions, metrics.clicks, metrics.cost_micros, metrics.conversions,
            metrics.conversions_value, metrics.ctr, metrics.average_cpc, metrics.cost_per_conversion
          FROM campaign WHERE segments.date DURING ${date_range} AND campaign.status != 'REMOVED'
          ORDER BY metrics.cost_micros DESC
        `);
        return { content: [{ type: "text" as const, text: JSON.stringify(results.map((r: any) => ({
          id: r.campaign.id, name: r.campaign.name, status: r.campaign.status, type: r.campaign.advertising_channel_type,
          impressions: r.metrics.impressions, clicks: r.metrics.clicks,
          cost: (r.metrics.cost_micros / 1e6).toFixed(2) + " €", conversions: r.metrics.conversions,
          convValue: r.metrics.conversions_value, ctr: (r.metrics.ctr * 100).toFixed(2) + "%",
          avgCpc: (r.metrics.average_cpc / 1e6).toFixed(2) + " €",
          costPerConv: r.metrics.cost_per_conversion ? (r.metrics.cost_per_conversion / 1e6).toFixed(2) + " €" : "N/A",
        })), null, 2) }] };
      } catch (e: any) { const msg = e.message || e.errors?.[0]?.message || e.details?.[0]?.errors?.[0]?.message || (typeof e === "object" ? JSON.stringify(e) : String(e)); return { content: [{ type: "text" as const, text: `Fehler: ${msg}` }] }; }
    });

    server.registerTool("set_campaign_status", {
      title: "Set Campaign Status",
      description: "Ändert den Status einer Kampagne (ENABLED, PAUSED).",
      inputSchema: {
        customer_id: z.string(), campaign_id: z.string(),
        status: z.enum(["ENABLED", "PAUSED"]),
      },
    }, async ({ customer_id, campaign_id, status }) => {
      try {
        const customer = getCustomer(customer_id);
        await customer.mutateResources([{
          entity: "campaign", operation: "update",
          resource: { resource_name: `customers/${customer_id}/campaigns/${campaign_id}`, status: status === "ENABLED" ? 2 : 3 },
          update_mask: { paths: ["status"] },
        }] as any);
        return { content: [{ type: "text" as const, text: `Kampagne ${campaign_id} → ${status}` }] };
      } catch (e: any) { const msg = e.message || e.errors?.[0]?.message || e.details?.[0]?.errors?.[0]?.message || (typeof e === "object" ? JSON.stringify(e) : String(e)); return { content: [{ type: "text" as const, text: `Fehler: ${msg}` }] }; }
    });

    server.registerTool("create_campaign_budget", {
      title: "Create Campaign Budget",
      description: "Erstellt ein Budget-Objekt für Kampagnen.",
      inputSchema: {
        customer_id: z.string(), budget_name: z.string(),
        amount_micros: z.number().describe("Budget in Micros (z.B. 10000000 = 10€/Tag)"),
        delivery_method: z.enum(["STANDARD", "ACCELERATED"]).default("STANDARD"),
      },
    }, async ({ customer_id, budget_name, amount_micros, delivery_method }) => {
      try {
        const customer = getCustomer(customer_id);
        const result = await customer.mutateResources([{
          entity: "campaign_budget", operation: "create",
          resource: { name: budget_name, amount_micros, delivery_method: delivery_method === "STANDARD" ? 2 : 3 },
        }] as any);
        return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
      } catch (e: any) { const msg = e.message || e.errors?.[0]?.message || e.details?.[0]?.errors?.[0]?.message || (typeof e === "object" ? JSON.stringify(e) : String(e)); return { content: [{ type: "text" as const, text: `Fehler: ${msg}` }] }; }
    });

    server.registerTool("update_campaign_budget", {
      title: "Update Campaign Budget",
      description: "Ändert das Tagesbudget einer Kampagne.",
      inputSchema: {
        customer_id: z.string(), budget_id: z.string(),
        new_amount_micros: z.number().describe("Neues Budget in Micros"),
      },
    }, async ({ customer_id, budget_id, new_amount_micros }) => {
      try {
        const customer = getCustomer(customer_id);
        await customer.mutateResources([{
          entity: "campaign_budget", operation: "update",
          resource: { resource_name: `customers/${customer_id}/campaignBudgets/${budget_id}`, amount_micros: new_amount_micros },
          update_mask: { paths: ["amount_micros"] },
        }] as any);
        return { content: [{ type: "text" as const, text: `Budget ${budget_id} → ${(new_amount_micros / 1e6).toFixed(2)} €/Tag` }] };
      } catch (e: any) { const msg = e.message || e.errors?.[0]?.message || e.details?.[0]?.errors?.[0]?.message || (typeof e === "object" ? JSON.stringify(e) : String(e)); return { content: [{ type: "text" as const, text: `Fehler: ${msg}` }] }; }
    });

    server.registerTool("create_campaign", {
      title: "Create Campaign",
      description: "Erstellt eine neue Kampagne (Search, Display, etc.).",
      inputSchema: {
        customer_id: z.string(), name: z.string(),
        channel_type: z.enum(["SEARCH", "DISPLAY", "SHOPPING", "VIDEO", "PERFORMANCE_MAX"]),
        budget_id: z.string().describe("Budget Resource ID"),
        bidding_strategy: z.enum(["MANUAL_CPC", "MAXIMIZE_CLICKS", "MAXIMIZE_CONVERSIONS", "MAXIMIZE_CONVERSION_VALUE", "TARGET_CPA", "TARGET_ROAS", "TARGET_IMPRESSION_SHARE"]).default("MAXIMIZE_CLICKS"),
        target_cpa_micros: z.number().optional().describe("Target CPA in Micros (nur bei TARGET_CPA)"),
        target_roas: z.number().optional().describe("Target ROAS (z.B. 4.0 = 400%, nur bei TARGET_ROAS)"),
        status: z.enum(["ENABLED", "PAUSED"]).default("PAUSED"),
      },
    }, async ({ customer_id, name, channel_type, budget_id, bidding_strategy, target_cpa_micros, target_roas, status }) => {
      try {
        const channelMap: any = { SEARCH: 2, DISPLAY: 3, SHOPPING: 4, VIDEO: 6, PERFORMANCE_MAX: 13 };
        // Handle budget_id: strip full resource name if provided
        const budgetIdClean = budget_id.includes("/") ? budget_id.split("/").pop()! : budget_id;
        const campaign: any = {
          name,
          advertising_channel_type: channelMap[channel_type],
          status: status === "ENABLED" ? 2 : 3,
          campaign_budget: `customers/${customer_id}/campaignBudgets/${budgetIdClean}`,
        };
        // EU Political Advertising declaration (required for EU accounts since DSA)
        // Enum: 3 = DOES_NOT_CONTAIN_EU_POLITICAL_ADVERTISING
        campaign.contains_eu_political_advertising = 3;
        // Network settings required for Search/Display
        if (channel_type === "SEARCH") {
          campaign.network_settings = {
            target_google_search: true,
            target_search_network: true,
            target_content_network: false,
          };
        } else if (channel_type === "DISPLAY") {
          campaign.network_settings = {
            target_google_search: false,
            target_search_network: false,
            target_content_network: true,
          };
        }
        // Bidding strategy (Google Ads API v23 field names)
        if (bidding_strategy === "MANUAL_CPC") {
          campaign.manual_cpc = { enhanced_cpc_enabled: false };
        } else if (bidding_strategy === "MAXIMIZE_CLICKS") {
          // v23: "maximize_clicks" = "target_spend" in proto
          campaign.target_spend = { cpc_bid_ceiling_micros: 10000000 };
        } else if (bidding_strategy === "MAXIMIZE_CONVERSIONS") {
          campaign.maximize_conversions = { target_cpa_micros: target_cpa_micros || 0 };
        } else if (bidding_strategy === "MAXIMIZE_CONVERSION_VALUE") {
          campaign.maximize_conversion_value = { target_roas: target_roas || 0 };
        } else if (bidding_strategy === "TARGET_CPA") {
          campaign.target_cpa = { target_cpa_micros: target_cpa_micros || 1000000 };
        } else if (bidding_strategy === "TARGET_ROAS") {
          campaign.target_roas = { target_roas: target_roas || 4.0 };
        } else if (bidding_strategy === "TARGET_IMPRESSION_SHARE") {
          campaign.target_impression_share = { location: 2, location_fraction_micros: 500000, cpc_bid_ceiling_micros: 5000000 };
        }

        const customer = getCustomer(customer_id);
        const result = await customer.mutateResources([{ entity: "campaign", operation: "create", resource: campaign }] as any);
        return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
      } catch (e: any) {
        // Extract full error details from Google Ads API
        const details = e.errors?.map((err: any) => {
          const code = err.error_code ? JSON.stringify(err.error_code) : '';
          const loc = err.location?.field_path_elements?.map((f: any) => f.field_name).join('.') || '';
          return `${code} ${err.message || ''} ${loc ? `(field: ${loc})` : ''}`.trim();
        }).join('; ');
        const msg = details || e.message || (typeof e === 'object' ? JSON.stringify(e, null, 2) : String(e));
        return { content: [{ type: "text" as const, text: `Fehler: ${msg}` }] };
      }
    });

    // ==========================================
    // AD GROUPS
    // ==========================================

    server.registerTool("list_ad_groups", {
      title: "List Ad Groups",
      description: "Listet Ad Groups eines Kontos/Kampagne auf.",
      inputSchema: {
        customer_id: z.string(),
        campaign_id: z.string().optional().describe("Optional: nur Ad Groups dieser Kampagne"),
        date_range: z.enum(["LAST_7_DAYS","LAST_30_DAYS","LAST_90_DAYS"]).default("LAST_30_DAYS"),
      },
    }, async ({ customer_id, campaign_id, date_range }) => {
      try {
        const customer = getCustomer(customer_id);
        let q = `SELECT ad_group.id, ad_group.name, ad_group.status, campaign.name,
          metrics.impressions, metrics.clicks, metrics.cost_micros, metrics.conversions
          FROM ad_group WHERE segments.date DURING ${date_range} AND ad_group.status != 'REMOVED'`;
        if (campaign_id) q += ` AND campaign.id = ${campaign_id}`;
        q += ` ORDER BY metrics.cost_micros DESC`;
        const results = await customer.query(q);
        return { content: [{ type: "text" as const, text: JSON.stringify(results.map((r: any) => ({
          id: r.ad_group.id, name: r.ad_group.name, status: r.ad_group.status,
          campaign: r.campaign.name, impressions: r.metrics.impressions, clicks: r.metrics.clicks,
          cost: (r.metrics.cost_micros / 1e6).toFixed(2) + " €", conversions: r.metrics.conversions,
        })), null, 2) }] };
      } catch (e: any) { const msg = e.message || e.errors?.[0]?.message || e.details?.[0]?.errors?.[0]?.message || (typeof e === "object" ? JSON.stringify(e) : String(e)); return { content: [{ type: "text" as const, text: `Fehler: ${msg}` }] }; }
    });

    server.registerTool("create_ad_group", {
      title: "Create Ad Group",
      description: "Erstellt eine neue Ad Group in einer Kampagne.",
      inputSchema: {
        customer_id: z.string(), campaign_id: z.string(), name: z.string(),
        cpc_bid_micros: z.number().default(1000000).describe("Max CPC in Micros (1000000 = 1€)"),
        status: z.enum(["ENABLED", "PAUSED"]).default("PAUSED"),
      },
    }, async ({ customer_id, campaign_id, name, cpc_bid_micros, status }) => {
      try {
        const customer = getCustomer(customer_id);
        const result = await customer.mutateResources([{
          entity: "ad_group", operation: "create",
          resource: {
            name, campaign: `customers/${customer_id}/campaigns/${campaign_id}`,
            status: status === "ENABLED" ? 2 : 3, cpc_bid_micros,
            type: 2, // SEARCH_STANDARD
          },
        }] as any);
        return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
      } catch (e: any) { const msg = e.message || e.errors?.[0]?.message || e.details?.[0]?.errors?.[0]?.message || (typeof e === "object" ? JSON.stringify(e) : String(e)); return { content: [{ type: "text" as const, text: `Fehler: ${msg}` }] }; }
    });

    server.registerTool("set_ad_group_status", {
      title: "Set Ad Group Status",
      description: "Ad Group aktivieren oder pausieren.",
      inputSchema: { customer_id: z.string(), ad_group_id: z.string(), status: z.enum(["ENABLED", "PAUSED"]) },
    }, async ({ customer_id, ad_group_id, status }) => {
      try {
        const customer = getCustomer(customer_id);
        await customer.mutateResources([{
          entity: "ad_group", operation: "update",
          resource: { resource_name: `customers/${customer_id}/adGroups/${ad_group_id}`, status: status === "ENABLED" ? 2 : 3 },
          update_mask: { paths: ["status"] },
        }] as any);
        return { content: [{ type: "text" as const, text: `Ad Group ${ad_group_id} → ${status}` }] };
      } catch (e: any) { const msg = e.message || e.errors?.[0]?.message || e.details?.[0]?.errors?.[0]?.message || (typeof e === "object" ? JSON.stringify(e) : String(e)); return { content: [{ type: "text" as const, text: `Fehler: ${msg}` }] }; }
    });

    server.registerTool("update_ad_group_bid", {
      title: "Update Ad Group CPC Bid",
      description: "Ändert den Max CPC Bid einer Ad Group.",
      inputSchema: { customer_id: z.string(), ad_group_id: z.string(), cpc_bid_micros: z.number() },
    }, async ({ customer_id, ad_group_id, cpc_bid_micros }) => {
      try {
        const customer = getCustomer(customer_id);
        await customer.mutateResources([{
          entity: "ad_group", operation: "update",
          resource: { resource_name: `customers/${customer_id}/adGroups/${ad_group_id}`, cpc_bid_micros },
          update_mask: { paths: ["cpc_bid_micros"] },
        }] as any);
        return { content: [{ type: "text" as const, text: `Ad Group ${ad_group_id} Bid → ${(cpc_bid_micros / 1e6).toFixed(2)} €` }] };
      } catch (e: any) { const msg = e.message || e.errors?.[0]?.message || e.details?.[0]?.errors?.[0]?.message || (typeof e === "object" ? JSON.stringify(e) : String(e)); return { content: [{ type: "text" as const, text: `Fehler: ${msg}` }] }; }
    });

    // ==========================================
    // ANZEIGEN
    // ==========================================

    server.registerTool("get_ad_performance", {
      title: "Get Ad Performance",
      description: "Zeigt die Performance einzelner Anzeigen.",
      inputSchema: {
        customer_id: z.string(),
        date_range: z.enum(["LAST_7_DAYS","LAST_14_DAYS","LAST_30_DAYS","LAST_90_DAYS"]).default("LAST_30_DAYS"),
        campaign_name: z.string().optional(),
      },
    }, async ({ customer_id, date_range, campaign_name }) => {
      try {
        const customer = getCustomer(customer_id);
        let q = `SELECT ad_group_ad.ad.id, ad_group_ad.ad.type,
          ad_group_ad.ad.responsive_search_ad.headlines, ad_group_ad.ad.responsive_search_ad.descriptions,
          ad_group_ad.status, ad_group_ad.ad.final_urls,
          campaign.name, ad_group.name,
          metrics.impressions, metrics.clicks, metrics.cost_micros, metrics.conversions, metrics.ctr, metrics.average_cpc
          FROM ad_group_ad WHERE segments.date DURING ${date_range} AND ad_group_ad.status != 'REMOVED'`;
        if (campaign_name) q += ` AND campaign.name LIKE '%${campaign_name}%'`;
        q += ` ORDER BY metrics.cost_micros DESC LIMIT 50`;
        const results = await customer.query(q);
        return { content: [{ type: "text" as const, text: JSON.stringify(results, null, 2) }] };
      } catch (e: any) { const msg = e.message || e.errors?.[0]?.message || e.details?.[0]?.errors?.[0]?.message || (typeof e === "object" ? JSON.stringify(e) : String(e)); return { content: [{ type: "text" as const, text: `Fehler: ${msg}` }] }; }
    });

    server.registerTool("create_responsive_search_ad", {
      title: "Create Responsive Search Ad",
      description: "Erstellt eine RSA mit Headlines und Descriptions.",
      inputSchema: {
        customer_id: z.string(), ad_group_id: z.string(),
        headlines: z.array(z.string()).min(3).max(15).describe("3-15 Headlines (max 30 Zeichen)"),
        descriptions: z.array(z.string()).min(2).max(4).describe("2-4 Descriptions (max 90 Zeichen)"),
        final_urls: z.array(z.string()).describe("Landing Page URLs"),
        path1: z.string().optional().describe("URL-Pfad 1 (max 15 Zeichen)"),
        path2: z.string().optional().describe("URL-Pfad 2 (max 15 Zeichen)"),
        status: z.enum(["ENABLED", "PAUSED"]).default("PAUSED"),
      },
    }, async ({ customer_id, ad_group_id, headlines, descriptions, final_urls, path1, path2, status }) => {
      try {
        const customer = getCustomer(customer_id);
        const ad: any = {
          final_urls,
          responsive_search_ad: {
            headlines: headlines.map(h => ({ text: h })),
            descriptions: descriptions.map(d => ({ text: d })),
          },
        };
        if (path1) ad.responsive_search_ad.path1 = path1;
        if (path2) ad.responsive_search_ad.path2 = path2;
        const result = await customer.mutateResources([{
          entity: "ad_group_ad", operation: "create",
          resource: { ad_group: `customers/${customer_id}/adGroups/${ad_group_id}`, status: status === "ENABLED" ? 2 : 3, ad },
        }] as any);
        return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
      } catch (e: any) { const msg = e.message || e.errors?.[0]?.message || e.details?.[0]?.errors?.[0]?.message || (typeof e === "object" ? JSON.stringify(e) : String(e)); return { content: [{ type: "text" as const, text: `Fehler: ${msg}` }] }; }
    });

    server.registerTool("set_ad_status", {
      title: "Set Ad Status",
      description: "Anzeige aktivieren oder pausieren.",
      inputSchema: { customer_id: z.string(), ad_group_id: z.string(), ad_id: z.string(), status: z.enum(["ENABLED", "PAUSED"]) },
    }, async ({ customer_id, ad_group_id, ad_id, status }) => {
      try {
        const customer = getCustomer(customer_id);
        await customer.mutateResources([{
          entity: "ad_group_ad", operation: "update",
          resource: { resource_name: `customers/${customer_id}/adGroupAds/${ad_group_id}~${ad_id}`, status: status === "ENABLED" ? 2 : 3 },
          update_mask: { paths: ["status"] },
        }] as any);
        return { content: [{ type: "text" as const, text: `Ad ${ad_id} → ${status}` }] };
      } catch (e: any) { const msg = e.message || e.errors?.[0]?.message || e.details?.[0]?.errors?.[0]?.message || (typeof e === "object" ? JSON.stringify(e) : String(e)); return { content: [{ type: "text" as const, text: `Fehler: ${msg}` }] }; }
    });

    // ==========================================
    // KEYWORDS
    // ==========================================

    server.registerTool("get_keyword_performance", {
      title: "Get Keyword Performance",
      description: "Zeigt Keyword-Performance eines Kontos.",
      inputSchema: {
        customer_id: z.string(),
        date_range: z.enum(["LAST_7_DAYS","LAST_14_DAYS","LAST_30_DAYS","LAST_90_DAYS"]).default("LAST_30_DAYS"),
        limit: z.number().int().min(1).max(100).default(50),
      },
    }, async ({ customer_id, date_range, limit }) => {
      try {
        const customer = getCustomer(customer_id);
        const results = await customer.query(`
          SELECT ad_group_criterion.keyword.text, ad_group_criterion.keyword.match_type,
            ad_group_criterion.status, campaign.name, ad_group.name,
            metrics.impressions, metrics.clicks, metrics.cost_micros, metrics.conversions,
            metrics.ctr, metrics.average_cpc, metrics.search_impression_share
          FROM keyword_view WHERE segments.date DURING ${date_range}
          ORDER BY metrics.cost_micros DESC LIMIT ${limit}
        `);
        return { content: [{ type: "text" as const, text: JSON.stringify(results.map((r: any) => ({
          keyword: r.ad_group_criterion.keyword.text, matchType: r.ad_group_criterion.keyword.match_type,
          campaign: r.campaign.name, adGroup: r.ad_group.name,
          impressions: r.metrics.impressions, clicks: r.metrics.clicks,
          cost: (r.metrics.cost_micros / 1e6).toFixed(2) + " €", conversions: r.metrics.conversions,
          ctr: (r.metrics.ctr * 100).toFixed(2) + "%", avgCpc: (r.metrics.average_cpc / 1e6).toFixed(2) + " €",
          impShare: r.metrics.search_impression_share ? (r.metrics.search_impression_share * 100).toFixed(1) + "%" : "N/A",
        })), null, 2) }] };
      } catch (e: any) { const msg = e.message || e.errors?.[0]?.message || e.details?.[0]?.errors?.[0]?.message || (typeof e === "object" ? JSON.stringify(e) : String(e)); return { content: [{ type: "text" as const, text: `Fehler: ${msg}` }] }; }
    });

    server.registerTool("add_keywords", {
      title: "Add Keywords",
      description: "Fügt Keywords zu einer Ad Group hinzu.",
      inputSchema: {
        customer_id: z.string(), ad_group_id: z.string(),
        keywords: z.array(z.object({
          text: z.string(), match_type: z.enum(["EXACT", "PHRASE", "BROAD"]),
        })).describe("Liste von Keywords mit Match Type"),
        cpc_bid_micros: z.number().optional().describe("Optional: Keyword-Level CPC Bid"),
      },
    }, async ({ customer_id, ad_group_id, keywords, cpc_bid_micros }) => {
      try {
        const matchMap: any = { EXACT: 2, PHRASE: 3, BROAD: 4 };
        const customer = getCustomer(customer_id);
        const ops = keywords.map(kw => ({
          entity: "ad_group_criterion", operation: "create",
          resource: {
            ad_group: `customers/${customer_id}/adGroups/${ad_group_id}`,
            keyword: { text: kw.text, match_type: matchMap[kw.match_type] },
            ...(cpc_bid_micros ? { cpc_bid_micros } : {}),
          },
        }));
        const result = await customer.mutateResources(ops as any);
        return { content: [{ type: "text" as const, text: `${keywords.length} Keywords hinzugefügt.\n${JSON.stringify(result, null, 2)}` }] };
      } catch (e: any) { const msg = e.message || e.errors?.[0]?.message || e.details?.[0]?.errors?.[0]?.message || (typeof e === "object" ? JSON.stringify(e) : String(e)); return { content: [{ type: "text" as const, text: `Fehler: ${msg}` }] }; }
    });

    server.registerTool("remove_keyword", {
      title: "Remove Keyword",
      description: "Entfernt ein Keyword aus einer Ad Group.",
      inputSchema: { customer_id: z.string(), ad_group_id: z.string(), criterion_id: z.string() },
    }, async ({ customer_id, ad_group_id, criterion_id }) => {
      try {
        const customer = getCustomer(customer_id);
        await customer.mutateResources([{
          entity: "ad_group_criterion", operation: "remove",
          resource_name: `customers/${customer_id}/adGroupCriteria/${ad_group_id}~${criterion_id}`,
        }] as any);
        return { content: [{ type: "text" as const, text: `Keyword ${criterion_id} entfernt.` }] };
      } catch (e: any) { const msg = e.message || e.errors?.[0]?.message || e.details?.[0]?.errors?.[0]?.message || (typeof e === "object" ? JSON.stringify(e) : String(e)); return { content: [{ type: "text" as const, text: `Fehler: ${msg}` }] }; }
    });

    server.registerTool("add_negative_keywords", {
      title: "Add Negative Keywords",
      description: "Fügt negative Keywords auf Kampagnen-Ebene hinzu.",
      inputSchema: {
        customer_id: z.string(), campaign_id: z.string(),
        keywords: z.array(z.object({
          text: z.string(), match_type: z.enum(["EXACT", "PHRASE", "BROAD"]),
        })),
      },
    }, async ({ customer_id, campaign_id, keywords }) => {
      try {
        const matchMap: any = { EXACT: 2, PHRASE: 3, BROAD: 4 };
        const customer = getCustomer(customer_id);
        const ops = keywords.map(kw => ({
          entity: "campaign_criterion", operation: "create",
          resource: {
            campaign: `customers/${customer_id}/campaigns/${campaign_id}`,
            keyword: { text: kw.text, match_type: matchMap[kw.match_type] },
            negative: true,
          },
        }));
        const result = await customer.mutateResources(ops as any);
        return { content: [{ type: "text" as const, text: `${keywords.length} Negative Keywords hinzugefügt.` }] };
      } catch (e: any) { const msg = e.message || e.errors?.[0]?.message || e.details?.[0]?.errors?.[0]?.message || (typeof e === "object" ? JSON.stringify(e) : String(e)); return { content: [{ type: "text" as const, text: `Fehler: ${msg}` }] }; }
    });

    server.registerTool("get_search_terms_report", {
      title: "Get Search Terms Report",
      description: "Zeigt Suchanfragen und deren Performance.",
      inputSchema: {
        customer_id: z.string(),
        date_range: z.enum(["LAST_7_DAYS","LAST_14_DAYS","LAST_30_DAYS","LAST_90_DAYS"]).default("LAST_30_DAYS"),
        campaign_id: z.string().optional(), limit: z.number().default(50),
      },
    }, async ({ customer_id, date_range, campaign_id, limit }) => {
      try {
        const customer = getCustomer(customer_id);
        let q = `SELECT search_term_view.search_term, search_term_view.status,
          campaign.name, ad_group.name, metrics.impressions, metrics.clicks,
          metrics.cost_micros, metrics.conversions, metrics.ctr
          FROM search_term_view WHERE segments.date DURING ${date_range}`;
        if (campaign_id) q += ` AND campaign.id = ${campaign_id}`;
        q += ` ORDER BY metrics.impressions DESC LIMIT ${limit}`;
        const results = await customer.query(q);
        return { content: [{ type: "text" as const, text: JSON.stringify(results.map((r: any) => ({
          searchTerm: r.search_term_view.search_term, status: r.search_term_view.status,
          campaign: r.campaign.name, adGroup: r.ad_group.name,
          impressions: r.metrics.impressions, clicks: r.metrics.clicks,
          cost: (r.metrics.cost_micros / 1e6).toFixed(2) + " €", conversions: r.metrics.conversions,
          ctr: (r.metrics.ctr * 100).toFixed(2) + "%",
        })), null, 2) }] };
      } catch (e: any) { const msg = e.message || e.errors?.[0]?.message || e.details?.[0]?.errors?.[0]?.message || (typeof e === "object" ? JSON.stringify(e) : String(e)); return { content: [{ type: "text" as const, text: `Fehler: ${msg}` }] }; }
    });

    // ==========================================
    // BERICHTE & ANALYSE
    // ==========================================

    server.registerTool("get_quality_score_report", {
      title: "Get Quality Score Report",
      description: "Zeigt Quality Scores der Keywords.",
      inputSchema: { customer_id: z.string(), limit: z.number().default(50) },
    }, async ({ customer_id, limit }) => {
      try {
        const customer = getCustomer(customer_id);
        const results = await customer.query(`
          SELECT ad_group_criterion.keyword.text, ad_group_criterion.quality_info.quality_score,
            ad_group_criterion.quality_info.creative_quality_score,
            ad_group_criterion.quality_info.search_predicted_ctr,
            ad_group_criterion.quality_info.post_click_quality_score,
            campaign.name, ad_group.name, metrics.impressions, metrics.clicks
          FROM keyword_view WHERE ad_group_criterion.status = 'ENABLED'
            AND campaign.status = 'ENABLED'
          ORDER BY metrics.impressions DESC LIMIT ${limit}
        `);
        return { content: [{ type: "text" as const, text: JSON.stringify(results, null, 2) }] };
      } catch (e: any) { const msg = e.message || e.errors?.[0]?.message || e.details?.[0]?.errors?.[0]?.message || (typeof e === "object" ? JSON.stringify(e) : String(e)); return { content: [{ type: "text" as const, text: `Fehler: ${msg}` }] }; }
    });

    server.registerTool("get_conversion_report", {
      title: "Get Conversion Report",
      description: "Zeigt Conversion-Daten pro Kampagne.",
      inputSchema: {
        customer_id: z.string(),
        date_range: z.enum(["LAST_7_DAYS","LAST_30_DAYS","LAST_90_DAYS"]).default("LAST_30_DAYS"),
      },
    }, async ({ customer_id, date_range }) => {
      try {
        const customer = getCustomer(customer_id);
        const results = await customer.query(`
          SELECT campaign.name, metrics.conversions, metrics.conversions_value,
            metrics.cost_per_conversion, metrics.conversions_from_interactions_rate,
            metrics.value_per_conversion, metrics.cost_micros
          FROM campaign WHERE segments.date DURING ${date_range} AND campaign.status != 'REMOVED'
            AND metrics.conversions > 0
          ORDER BY metrics.conversions DESC
        `);
        return { content: [{ type: "text" as const, text: JSON.stringify(results.map((r: any) => ({
          campaign: r.campaign.name, conversions: r.metrics.conversions,
          convValue: r.metrics.conversions_value,
          costPerConv: (r.metrics.cost_per_conversion / 1e6).toFixed(2) + " €",
          convRate: (r.metrics.conversions_from_interactions_rate * 100).toFixed(2) + "%",
          valuePerConv: r.metrics.value_per_conversion?.toFixed(2) || "N/A",
          cost: (r.metrics.cost_micros / 1e6).toFixed(2) + " €",
        })), null, 2) }] };
      } catch (e: any) { const msg = e.message || e.errors?.[0]?.message || e.details?.[0]?.errors?.[0]?.message || (typeof e === "object" ? JSON.stringify(e) : String(e)); return { content: [{ type: "text" as const, text: `Fehler: ${msg}` }] }; }
    });

    server.registerTool("get_geographic_report", {
      title: "Get Geographic Report",
      description: "Performance nach Standort.",
      inputSchema: {
        customer_id: z.string(),
        date_range: z.enum(["LAST_7_DAYS","LAST_30_DAYS","LAST_90_DAYS"]).default("LAST_30_DAYS"),
        limit: z.number().default(20),
      },
    }, async ({ customer_id, date_range, limit }) => {
      try {
        const customer = getCustomer(customer_id);
        const results = await customer.query(`
          SELECT geographic_view.country_criterion_id, geographic_view.location_type,
            metrics.impressions, metrics.clicks, metrics.cost_micros, metrics.conversions, metrics.ctr
          FROM geographic_view WHERE segments.date DURING ${date_range}
          ORDER BY metrics.impressions DESC LIMIT ${limit}
        `);
        return { content: [{ type: "text" as const, text: JSON.stringify(results, null, 2) }] };
      } catch (e: any) { const msg = e.message || e.errors?.[0]?.message || e.details?.[0]?.errors?.[0]?.message || (typeof e === "object" ? JSON.stringify(e) : String(e)); return { content: [{ type: "text" as const, text: `Fehler: ${msg}` }] }; }
    });

    server.registerTool("get_device_report", {
      title: "Get Device Report",
      description: "Performance nach Gerät (Desktop, Mobile, Tablet).",
      inputSchema: {
        customer_id: z.string(),
        date_range: z.enum(["LAST_7_DAYS","LAST_30_DAYS","LAST_90_DAYS"]).default("LAST_30_DAYS"),
      },
    }, async ({ customer_id, date_range }) => {
      try {
        const customer = getCustomer(customer_id);
        const results = await customer.query(`
          SELECT segments.device, metrics.impressions, metrics.clicks, metrics.cost_micros,
            metrics.conversions, metrics.ctr, metrics.average_cpc
          FROM campaign WHERE segments.date DURING ${date_range} AND campaign.status != 'REMOVED'
        `);
        return { content: [{ type: "text" as const, text: JSON.stringify(results, null, 2) }] };
      } catch (e: any) { const msg = e.message || e.errors?.[0]?.message || e.details?.[0]?.errors?.[0]?.message || (typeof e === "object" ? JSON.stringify(e) : String(e)); return { content: [{ type: "text" as const, text: `Fehler: ${msg}` }] }; }
    });

    server.registerTool("get_hour_of_day_report", {
      title: "Get Hour of Day Report",
      description: "Performance nach Tageszeit.",
      inputSchema: {
        customer_id: z.string(),
        date_range: z.enum(["LAST_7_DAYS","LAST_30_DAYS","LAST_90_DAYS"]).default("LAST_30_DAYS"),
      },
    }, async ({ customer_id, date_range }) => {
      try {
        const customer = getCustomer(customer_id);
        const results = await customer.query(`
          SELECT segments.hour, metrics.impressions, metrics.clicks, metrics.cost_micros,
            metrics.conversions, metrics.ctr
          FROM campaign WHERE segments.date DURING ${date_range} AND campaign.status != 'REMOVED'
        `);
        return { content: [{ type: "text" as const, text: JSON.stringify(results, null, 2) }] };
      } catch (e: any) { const msg = e.message || e.errors?.[0]?.message || e.details?.[0]?.errors?.[0]?.message || (typeof e === "object" ? JSON.stringify(e) : String(e)); return { content: [{ type: "text" as const, text: `Fehler: ${msg}` }] }; }
    });

    server.registerTool("get_search_impression_share", {
      title: "Get Search Impression Share",
      description: "Impression Share Analyse pro Kampagne.",
      inputSchema: {
        customer_id: z.string(),
        date_range: z.enum(["LAST_7_DAYS","LAST_30_DAYS","LAST_90_DAYS"]).default("LAST_30_DAYS"),
      },
    }, async ({ customer_id, date_range }) => {
      try {
        const customer = getCustomer(customer_id);
        const results = await customer.query(`
          SELECT campaign.name, metrics.search_impression_share,
            metrics.search_budget_lost_impression_share, metrics.search_rank_lost_impression_share,
            metrics.search_top_impression_percentage, metrics.search_absolute_top_impression_percentage,
            metrics.impressions, metrics.clicks, metrics.cost_micros
          FROM campaign WHERE segments.date DURING ${date_range}
            AND campaign.status = 'ENABLED' AND campaign.advertising_channel_type = 'SEARCH'
          ORDER BY metrics.cost_micros DESC
        `);
        return { content: [{ type: "text" as const, text: JSON.stringify(results.map((r: any) => ({
          campaign: r.campaign.name,
          impShare: r.metrics.search_impression_share ? (r.metrics.search_impression_share * 100).toFixed(1) + "%" : "N/A",
          budgetLost: r.metrics.search_budget_lost_impression_share ? (r.metrics.search_budget_lost_impression_share * 100).toFixed(1) + "%" : "N/A",
          rankLost: r.metrics.search_rank_lost_impression_share ? (r.metrics.search_rank_lost_impression_share * 100).toFixed(1) + "%" : "N/A",
          topImpPct: r.metrics.search_top_impression_percentage ? (r.metrics.search_top_impression_percentage * 100).toFixed(1) + "%" : "N/A",
          absTopPct: r.metrics.search_absolute_top_impression_percentage ? (r.metrics.search_absolute_top_impression_percentage * 100).toFixed(1) + "%" : "N/A",
          impressions: r.metrics.impressions, cost: (r.metrics.cost_micros / 1e6).toFixed(2) + " €",
        })), null, 2) }] };
      } catch (e: any) { const msg = e.message || e.errors?.[0]?.message || e.details?.[0]?.errors?.[0]?.message || (typeof e === "object" ? JSON.stringify(e) : String(e)); return { content: [{ type: "text" as const, text: `Fehler: ${msg}` }] }; }
    });

    server.registerTool("get_landing_page_report", {
      title: "Get Landing Page Report",
      description: "Landing Page Performance.",
      inputSchema: {
        customer_id: z.string(),
        date_range: z.enum(["LAST_7_DAYS","LAST_30_DAYS","LAST_90_DAYS"]).default("LAST_30_DAYS"),
        limit: z.number().default(20),
      },
    }, async ({ customer_id, date_range, limit }) => {
      try {
        const customer = getCustomer(customer_id);
        const results = await customer.query(`
          SELECT landing_page_view.unexpanded_final_url,
            metrics.impressions, metrics.clicks, metrics.cost_micros,
            metrics.conversions, metrics.ctr, metrics.cost_per_conversion
          FROM landing_page_view WHERE segments.date DURING ${date_range}
          ORDER BY metrics.clicks DESC LIMIT ${limit}
        `);
        return { content: [{ type: "text" as const, text: JSON.stringify(results.map((r: any) => ({
          url: r.landing_page_view.unexpanded_final_url,
          impressions: r.metrics.impressions, clicks: r.metrics.clicks,
          cost: (r.metrics.cost_micros / 1e6).toFixed(2) + " €", conversions: r.metrics.conversions,
          ctr: (r.metrics.ctr * 100).toFixed(2) + "%",
          costPerConv: r.metrics.cost_per_conversion ? (r.metrics.cost_per_conversion / 1e6).toFixed(2) + " €" : "N/A",
        })), null, 2) }] };
      } catch (e: any) { const msg = e.message || e.errors?.[0]?.message || e.details?.[0]?.errors?.[0]?.message || (typeof e === "object" ? JSON.stringify(e) : String(e)); return { content: [{ type: "text" as const, text: `Fehler: ${msg}` }] }; }
    });

    server.registerTool("get_budget_report", {
      title: "Get Budget Report",
      description: "Budget-Auslastung pro Kampagne.",
      inputSchema: {
        customer_id: z.string(),
        date_range: z.enum(["LAST_7_DAYS","LAST_30_DAYS","LAST_90_DAYS"]).default("LAST_30_DAYS"),
      },
    }, async ({ customer_id, date_range }) => {
      try {
        const customer = getCustomer(customer_id);
        const results = await customer.query(`
          SELECT campaign.name, campaign.status, campaign_budget.amount_micros,
            campaign_budget.total_amount_micros, metrics.cost_micros, metrics.impressions, metrics.clicks,
            metrics.search_budget_lost_impression_share
          FROM campaign WHERE segments.date DURING ${date_range} AND campaign.status != 'REMOVED'
          ORDER BY metrics.cost_micros DESC
        `);
        return { content: [{ type: "text" as const, text: JSON.stringify(results.map((r: any) => ({
          campaign: r.campaign.name, status: r.campaign.status,
          dailyBudget: (r.campaign_budget.amount_micros / 1e6).toFixed(2) + " €",
          spent: (r.metrics.cost_micros / 1e6).toFixed(2) + " €",
          impressions: r.metrics.impressions,
          budgetLostIS: r.metrics.search_budget_lost_impression_share ? (r.metrics.search_budget_lost_impression_share * 100).toFixed(1) + "%" : "N/A",
        })), null, 2) }] };
      } catch (e: any) { const msg = e.message || e.errors?.[0]?.message || e.details?.[0]?.errors?.[0]?.message || (typeof e === "object" ? JSON.stringify(e) : String(e)); return { content: [{ type: "text" as const, text: `Fehler: ${msg}` }] }; }
    });

    server.registerTool("get_change_history", {
      title: "Get Change History",
      description: "Änderungsverlauf des Kontos.",
      inputSchema: {
        customer_id: z.string(),
        date_range: z.enum(["LAST_7_DAYS","LAST_14_DAYS","LAST_30_DAYS"]).default("LAST_7_DAYS"),
        limit: z.number().default(30),
      },
    }, async ({ customer_id, date_range, limit }) => {
      try {
        const customer = getCustomer(customer_id);
        const results = await customer.query(`
          SELECT change_event.change_date_time, change_event.change_resource_type,
            change_event.change_resource_name, change_event.client_type,
            change_event.user_email, change_event.resource_change_operation
          FROM change_event WHERE segments.date DURING ${date_range}
          ORDER BY change_event.change_date_time DESC LIMIT ${limit}
        `);
        return { content: [{ type: "text" as const, text: JSON.stringify(results, null, 2) }] };
      } catch (e: any) { const msg = e.message || e.errors?.[0]?.message || e.details?.[0]?.errors?.[0]?.message || (typeof e === "object" ? JSON.stringify(e) : String(e)); return { content: [{ type: "text" as const, text: `Fehler: ${msg}` }] }; }
    });

    // ==========================================
    // EXTENSIONS
    // ==========================================

    server.registerTool("list_extensions", {
      title: "List Extensions",
      description: "Listet alle Anzeigenerweiterungen (Assets) eines Kontos auf.",
      inputSchema: { customer_id: z.string() },
    }, async ({ customer_id }) => {
      try {
        const customer = getCustomer(customer_id);
        const results = await customer.query(`
          SELECT asset.id, asset.name, asset.type, asset.sitelink_asset.description1,
            asset.sitelink_asset.description2, asset.sitelink_asset.link_text,
            asset.callout_asset.callout_text, asset.structured_snippet_asset.header,
            asset.call_asset.phone_number
          FROM asset WHERE asset.type IN ('SITELINK', 'CALLOUT', 'STRUCTURED_SNIPPET', 'CALL')
        `);
        return { content: [{ type: "text" as const, text: JSON.stringify(results, null, 2) }] };
      } catch (e: any) { const msg = e.message || e.errors?.[0]?.message || e.details?.[0]?.errors?.[0]?.message || (typeof e === "object" ? JSON.stringify(e) : String(e)); return { content: [{ type: "text" as const, text: `Fehler: ${msg}` }] }; }
    });

    server.registerTool("create_sitelink_extension", {
      title: "Create Sitelink Extension",
      description: "Erstellt eine Sitelink-Erweiterung.",
      inputSchema: {
        customer_id: z.string(), link_text: z.string().describe("Sitelink-Text (max 25 Zeichen)"),
        final_urls: z.array(z.string()), description1: z.string().optional(), description2: z.string().optional(),
      },
    }, async ({ customer_id, link_text, final_urls, description1, description2 }) => {
      try {
        const customer = getCustomer(customer_id);
        const asset: any = { type: 6, sitelink_asset: { link_text, final_urls } };
        if (description1) asset.sitelink_asset.description1 = description1;
        if (description2) asset.sitelink_asset.description2 = description2;
        const result = await customer.mutateResources([{ entity: "asset", operation: "create", resource: asset }] as any);
        return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
      } catch (e: any) { const msg = e.message || e.errors?.[0]?.message || e.details?.[0]?.errors?.[0]?.message || (typeof e === "object" ? JSON.stringify(e) : String(e)); return { content: [{ type: "text" as const, text: `Fehler: ${msg}` }] }; }
    });

    server.registerTool("create_callout_extension", {
      title: "Create Callout Extension",
      description: "Erstellt eine Callout-Erweiterung.",
      inputSchema: {
        customer_id: z.string(),
        callout_text: z.string().describe("Callout-Text (max 25 Zeichen)"),
      },
    }, async ({ customer_id, callout_text }) => {
      try {
        const customer = getCustomer(customer_id);
        const result = await customer.mutateResources([{
          entity: "asset", operation: "create",
          resource: { type: 7, callout_asset: { callout_text } },
        }] as any);
        return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
      } catch (e: any) { const msg = e.message || e.errors?.[0]?.message || e.details?.[0]?.errors?.[0]?.message || (typeof e === "object" ? JSON.stringify(e) : String(e)); return { content: [{ type: "text" as const, text: `Fehler: ${msg}` }] }; }
    });

    // ==========================================
    // GAQL (Catch-All)
    // ==========================================

    server.registerTool("run_gaql_query", {
      title: "Run GAQL Query",
      description: "Führt eine benutzerdefinierte GAQL Query aus. Für alles was die anderen Tools nicht abdecken.",
      inputSchema: {
        customer_id: z.string(),
        query: z.string().describe("GAQL Query String"),
      },
    }, async ({ customer_id, query }) => {
      try {
        const customer = getCustomer(customer_id);
        const results = await customer.query(query);
        return { content: [{ type: "text" as const, text: JSON.stringify(results, null, 2) }] };
      } catch (e: any) { return { content: [{ type: "text" as const, text: `GAQL Fehler: ${e.message}` }] }; }
    });

  },
  {},
  { basePath: "/api", maxDuration: 60, verboseLogs: true }
);

export { handler as GET, handler as POST };
