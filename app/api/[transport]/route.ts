import { createMcpHandler } from "mcp-handler";
import { z } from "zod";
import { getCustomer } from "@/lib/google-ads-client";

const handler = createMcpHandler(
  (server) => {
    // ==================== ACCOUNT ====================

    server.registerTool(
      "list_accounts",
      {
        title: "List Google Ads Accounts",
        description: "Listet alle Google Ads Konten im MCC auf.",
        inputSchema: {},
      },
      async () => {
        try {
          const customer = getCustomer(process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID!);
          const results = await customer.query(`
            SELECT customer_client.id, customer_client.descriptive_name, customer_client.status, customer_client.manager
            FROM customer_client WHERE customer_client.status = 'ENABLED'
          `);
          const accounts = results.map((row: any) => ({
            id: row.customer_client.id,
            name: row.customer_client.descriptive_name,
            status: row.customer_client.status,
            isManager: row.customer_client.manager,
          }));
          return { content: [{ type: "text" as const, text: JSON.stringify(accounts, null, 2) }] };
        } catch (error: any) {
          return { content: [{ type: "text" as const, text: `Fehler: ${error.message}` }] };
        }
      }
    );

    server.registerTool(
      "get_account_info",
      {
        title: "Get Account Info",
        description: "Zeigt Details eines Google Ads Kontos.",
        inputSchema: {
          customer_id: z.string().describe("Google Ads Customer ID (ohne Bindestriche)"),
        },
      },
      async ({ customer_id }) => {
        try {
          const customer = getCustomer(customer_id);
          const results = await customer.query(`
            SELECT customer.id, customer.descriptive_name, customer.currency_code, customer.time_zone,
              customer.auto_tagging_enabled, customer.manager, customer.status
            FROM customer LIMIT 1
          `);
          return { content: [{ type: "text" as const, text: JSON.stringify(results[0], null, 2) }] };
        } catch (error: any) {
          return { content: [{ type: "text" as const, text: `Fehler: ${error.message}` }] };
        }
      }
    );

    // ==================== CAMPAIGNS ====================

    server.registerTool(
      "get_campaign_performance",
      {
        title: "Get Campaign Performance",
        description: "Zeigt Kampagnen-Performance für ein bestimmtes Konto und einen Zeitraum.",
        inputSchema: {
          customer_id: z.string().describe("Google Ads Customer ID (ohne Bindestriche)"),
          date_range: z.enum(["LAST_7_DAYS","LAST_14_DAYS","LAST_30_DAYS","THIS_MONTH","LAST_MONTH","LAST_90_DAYS"]).default("LAST_30_DAYS"),
        },
      },
      async ({ customer_id, date_range }) => {
        try {
          const customer = getCustomer(customer_id);
          const results = await customer.query(`
            SELECT campaign.id, campaign.name, campaign.status, campaign.advertising_channel_type,
              metrics.impressions, metrics.clicks, metrics.cost_micros, metrics.conversions,
              metrics.conversions_value, metrics.ctr, metrics.average_cpc, metrics.cost_per_conversion
            FROM campaign WHERE segments.date DURING ${date_range} AND campaign.status != 'REMOVED'
            ORDER BY metrics.cost_micros DESC
          `);
          const campaigns = results.map((row: any) => ({
            id: row.campaign.id, name: row.campaign.name, status: row.campaign.status,
            type: row.campaign.advertising_channel_type,
            impressions: row.metrics.impressions, clicks: row.metrics.clicks,
            cost: (row.metrics.cost_micros / 1_000_000).toFixed(2) + " €",
            conversions: row.metrics.conversions, conversionValue: row.metrics.conversions_value,
            ctr: (row.metrics.ctr * 100).toFixed(2) + "%",
            avgCpc: (row.metrics.average_cpc / 1_000_000).toFixed(2) + " €",
            costPerConversion: row.metrics.cost_per_conversion ? (row.metrics.cost_per_conversion / 1_000_000).toFixed(2) + " €" : "N/A",
          }));
          return { content: [{ type: "text" as const, text: JSON.stringify(campaigns, null, 2) }] };
        } catch (error: any) {
          return { content: [{ type: "text" as const, text: `Fehler: ${error.message}` }] };
        }
      }
    );

    server.registerTool(
      "set_campaign_status",
      {
        title: "Set Campaign Status",
        description: "Ändert den Status einer Kampagne (ENABLED, PAUSED).",
        inputSchema: {
          customer_id: z.string().describe("Google Ads Customer ID"),
          campaign_id: z.string().describe("Campaign ID"),
          status: z.enum(["ENABLED", "PAUSED"]).describe("Neuer Status"),
        },
      },
      async ({ customer_id, campaign_id, status }) => {
        try {
          const customer = getCustomer(customer_id);
          await (customer as any).campaignService.mutateCampaigns({
            customerId: customer_id,
            operations: [{
              updateMask: { paths: ["status"] },
              update: { resourceName: `customers/${customer_id}/campaigns/${campaign_id}`, status: status === "ENABLED" ? 2 : 3 },
            }],
          });
          return { content: [{ type: "text" as const, text: `Kampagne ${campaign_id} wurde auf ${status} gesetzt.` }] };
        } catch (error: any) {
          return { content: [{ type: "text" as const, text: `Fehler: ${error.message}` }] };
        }
      }
    );

    server.registerTool(
      "create_campaign_budget",
      {
        title: "Create Campaign Budget",
        description: "Erstellt ein neues Budget-Objekt für Kampagnen.",
        inputSchema: {
          customer_id: z.string().describe("Google Ads Customer ID"),
          name: z.string().describe("Name des Budgets"),
          amount_micros: z.number().describe("Tagesbudget in Micros (z.B. 10000000 = 10€)"),
          delivery_method: z.enum(["STANDARD", "ACCELERATED"]).default("STANDARD"),
        },
      },
      async ({ customer_id, name, amount_micros, delivery_method }) => {
        try {
          const customer = getCustomer(customer_id);
          const result = await (customer as any).campaignBudgets.create({
            name,
            amount_micros,
            delivery_method: delivery_method === "STANDARD" ? 2 : 3,
            explicitly_shared: false,
          });
          return { content: [{ type: "text" as const, text: `Budget erstellt: ${JSON.stringify(result, null, 2)}` }] };
        } catch (error: any) {
          // Fallback: mutateResources
          try {
            const customer2 = getCustomer(customer_id);
            const result = await customer2.mutateResources([{
              _resource: "CampaignBudget",
              _operation: "create",
              name,
              amount_micros,
              delivery_method: delivery_method === "STANDARD" ? 2 : 3,
              explicitly_shared: false,
            }]);
            return { content: [{ type: "text" as const, text: `Budget erstellt: ${JSON.stringify(result, null, 2)}` }] };
          } catch (e2: any) {
            return { content: [{ type: "text" as const, text: `Fehler: ${error.message} | Fallback: ${e2.message}` }] };
          }
        }
      }
    );

    server.registerTool(
      "update_campaign_budget",
      {
        title: "Update Campaign Budget",
        description: "Ändert das Budget einer Kampagne.",
        inputSchema: {
          customer_id: z.string().describe("Google Ads Customer ID"),
          budget_id: z.string().describe("Campaign Budget ID"),
          amount_micros: z.number().describe("Neues Tagesbudget in Micros (z.B. 20000000 = 20€)"),
        },
      },
      async ({ customer_id, budget_id, amount_micros }) => {
        try {
          const customer = getCustomer(customer_id);
          await customer.mutateResources([{
            _resource: "CampaignBudget",
            _operation: "update",
            resource_name: `customers/${customer_id}/campaignBudgets/${budget_id}`,
            amount_micros,
          }]);
          return { content: [{ type: "text" as const, text: `Budget ${budget_id} auf ${(amount_micros / 1_000_000).toFixed(2)} € aktualisiert.` }] };
        } catch (error: any) {
          return { content: [{ type: "text" as const, text: `Fehler: ${error.message}` }] };
        }
      }
    );

    server.registerTool(
      "create_campaign",
      {
        title: "Create Campaign",
        description: "Erstellt eine neue Kampagne (Search, Display oder Performance Max).",
        inputSchema: {
          customer_id: z.string().describe("Google Ads Customer ID"),
          name: z.string().describe("Kampagnenname"),
          budget_id: z.string().describe("Campaign Budget ID"),
          type: z.enum(["SEARCH", "DISPLAY", "PERFORMANCE_MAX"]).describe("Kampagnentyp"),
          status: z.enum(["ENABLED", "PAUSED"]).default("PAUSED"),
          bidding_strategy: z.enum(["MANUAL_CPC", "MAXIMIZE_CONVERSIONS", "MAXIMIZE_CLICKS", "TARGET_CPA", "TARGET_ROAS"]).default("MAXIMIZE_CLICKS"),
          target_cpa_micros: z.number().optional().describe("Target CPA in Micros (nur bei TARGET_CPA)"),
          target_roas: z.number().optional().describe("Target ROAS (nur bei TARGET_ROAS, z.B. 3.5)"),
        },
      },
      async ({ customer_id, name, budget_id, type, status, bidding_strategy, target_cpa_micros, target_roas }) => {
        try {
          const typeMap: Record<string, number> = { SEARCH: 2, DISPLAY: 3, PERFORMANCE_MAX: 9 };
          const statusMap: Record<string, number> = { ENABLED: 2, PAUSED: 3 };
          const campaign: any = {
            _resource: "Campaign",
            _operation: "create",
            name,
            status: statusMap[status],
            advertising_channel_type: typeMap[type],
            campaign_budget: `customers/${customer_id}/campaignBudgets/${budget_id}`,
          };
          if (bidding_strategy === "MANUAL_CPC") campaign.manual_cpc = { enhanced_cpc_enabled: false };
          else if (bidding_strategy === "MAXIMIZE_CONVERSIONS") campaign.maximize_conversions = {};
          else if (bidding_strategy === "MAXIMIZE_CLICKS") campaign.maximize_clicks = {};
          else if (bidding_strategy === "TARGET_CPA") campaign.target_cpa = { target_cpa_micros: target_cpa_micros || 0 };
          else if (bidding_strategy === "TARGET_ROAS") campaign.target_roas = { target_roas: target_roas || 1.0 };

          const customer = getCustomer(customer_id);
          const result = await customer.mutateResources([campaign]);
          return { content: [{ type: "text" as const, text: `Kampagne erstellt: ${JSON.stringify(result, null, 2)}` }] };
        } catch (error: any) {
          return { content: [{ type: "text" as const, text: `Fehler: ${error.message}` }] };
        }
      }
    );

    // ==================== AD GROUPS ====================

    server.registerTool(
      "list_ad_groups",
      {
        title: "List Ad Groups",
        description: "Listet alle Ad Groups eines Kontos auf.",
        inputSchema: {
          customer_id: z.string().describe("Google Ads Customer ID"),
          campaign_id: z.string().optional().describe("Optional: nur Ad Groups dieser Kampagne"),
        },
      },
      async ({ customer_id, campaign_id }) => {
        try {
          const customer = getCustomer(customer_id);
          let query = `
            SELECT ad_group.id, ad_group.name, ad_group.status, ad_group.type,
              ad_group.cpc_bid_micros, campaign.id, campaign.name
            FROM ad_group WHERE ad_group.status != 'REMOVED'
          `;
          if (campaign_id) query += ` AND campaign.id = ${campaign_id}`;
          query += ` ORDER BY campaign.name, ad_group.name`;
          const results = await customer.query(query);
          const adGroups = results.map((row: any) => ({
            id: row.ad_group.id, name: row.ad_group.name, status: row.ad_group.status,
            type: row.ad_group.type,
            cpcBid: row.ad_group.cpc_bid_micros ? (row.ad_group.cpc_bid_micros / 1_000_000).toFixed(2) + " €" : "N/A",
            campaignId: row.campaign.id, campaignName: row.campaign.name,
          }));
          return { content: [{ type: "text" as const, text: JSON.stringify(adGroups, null, 2) }] };
        } catch (error: any) {
          return { content: [{ type: "text" as const, text: `Fehler: ${error.message}` }] };
        }
      }
    );

    server.registerTool(
      "create_ad_group",
      {
        title: "Create Ad Group",
        description: "Erstellt eine neue Ad Group in einer Kampagne.",
        inputSchema: {
          customer_id: z.string().describe("Google Ads Customer ID"),
          campaign_id: z.string().describe("Campaign ID"),
          name: z.string().describe("Name der Ad Group"),
          cpc_bid_micros: z.number().optional().describe("CPC Gebot in Micros (z.B. 1500000 = 1.50€)"),
          status: z.enum(["ENABLED", "PAUSED"]).default("ENABLED"),
        },
      },
      async ({ customer_id, campaign_id, name, cpc_bid_micros, status }) => {
        try {
          const customer = getCustomer(customer_id);
          const adGroup: any = {
            _resource: "AdGroup",
            _operation: "create",
            name,
            campaign: `customers/${customer_id}/campaigns/${campaign_id}`,
            status: status === "ENABLED" ? 2 : 3,
            type: 2, // SEARCH_STANDARD
          };
          if (cpc_bid_micros) adGroup.cpc_bid_micros = cpc_bid_micros;
          const result = await customer.mutateResources([adGroup]);
          return { content: [{ type: "text" as const, text: `Ad Group erstellt: ${JSON.stringify(result, null, 2)}` }] };
        } catch (error: any) {
          return { content: [{ type: "text" as const, text: `Fehler: ${error.message}` }] };
        }
      }
    );

    server.registerTool(
      "set_ad_group_status",
      {
        title: "Set Ad Group Status",
        description: "Ändert den Status einer Ad Group (ENABLED, PAUSED).",
        inputSchema: {
          customer_id: z.string().describe("Google Ads Customer ID"),
          ad_group_id: z.string().describe("Ad Group ID"),
          status: z.enum(["ENABLED", "PAUSED"]).describe("Neuer Status"),
        },
      },
      async ({ customer_id, ad_group_id, status }) => {
        try {
          const customer = getCustomer(customer_id);
          await customer.mutateResources([{
            _resource: "AdGroup",
            _operation: "update",
            resource_name: `customers/${customer_id}/adGroups/${ad_group_id}`,
            status: status === "ENABLED" ? 2 : 3,
          }]);
          return { content: [{ type: "text" as const, text: `Ad Group ${ad_group_id} auf ${status} gesetzt.` }] };
        } catch (error: any) {
          return { content: [{ type: "text" as const, text: `Fehler: ${error.message}` }] };
        }
      }
    );

    server.registerTool(
      "update_ad_group_bid",
      {
        title: "Update Ad Group CPC Bid",
        description: "Ändert das CPC-Gebot einer Ad Group.",
        inputSchema: {
          customer_id: z.string().describe("Google Ads Customer ID"),
          ad_group_id: z.string().describe("Ad Group ID"),
          cpc_bid_micros: z.number().describe("Neues CPC Gebot in Micros"),
        },
      },
      async ({ customer_id, ad_group_id, cpc_bid_micros }) => {
        try {
          const customer = getCustomer(customer_id);
          await customer.mutateResources([{
            _resource: "AdGroup",
            _operation: "update",
            resource_name: `customers/${customer_id}/adGroups/${ad_group_id}`,
            cpc_bid_micros,
          }]);
          return { content: [{ type: "text" as const, text: `Ad Group ${ad_group_id} CPC Bid auf ${(cpc_bid_micros / 1_000_000).toFixed(2)} € gesetzt.` }] };
        } catch (error: any) {
          return { content: [{ type: "text" as const, text: `Fehler: ${error.message}` }] };
        }
      }
    );

    // ==================== ADS ====================

    server.registerTool(
      "get_ad_performance",
      {
        title: "Get Ad Performance",
        description: "Zeigt die Performance einzelner Anzeigen.",
        inputSchema: {
          customer_id: z.string().describe("Google Ads Customer ID"),
          date_range: z.enum(["LAST_7_DAYS","LAST_14_DAYS","LAST_30_DAYS","LAST_90_DAYS"]).default("LAST_30_DAYS"),
          campaign_name: z.string().optional().describe("Optionaler Kampagnenname-Filter"),
        },
      },
      async ({ customer_id, date_range, campaign_name }) => {
        try {
          const customer = getCustomer(customer_id);
          let query = `
            SELECT ad_group_ad.ad.id, ad_group_ad.ad.type, ad_group_ad.ad.responsive_search_ad.headlines,
              ad_group_ad.status, campaign.name, ad_group.name,
              metrics.impressions, metrics.clicks, metrics.cost_micros, metrics.conversions, metrics.ctr, metrics.average_cpc
            FROM ad_group_ad WHERE segments.date DURING ${date_range} AND ad_group_ad.status != 'REMOVED'
          `;
          if (campaign_name) query += ` AND campaign.name LIKE '%${campaign_name}%'`;
          query += ` ORDER BY metrics.cost_micros DESC LIMIT 50`;
          const results = await customer.query(query);
          return { content: [{ type: "text" as const, text: JSON.stringify(results, null, 2) }] };
        } catch (error: any) {
          return { content: [{ type: "text" as const, text: `Fehler: ${error.message}` }] };
        }
      }
    );

    server.registerTool(
      "create_responsive_search_ad",
      {
        title: "Create Responsive Search Ad",
        description: "Erstellt eine Responsive Search Ad (RSA) mit Headlines und Descriptions.",
        inputSchema: {
          customer_id: z.string().describe("Google Ads Customer ID"),
          ad_group_id: z.string().describe("Ad Group ID"),
          headlines: z.array(z.string()).min(3).max(15).describe("Headlines (3-15 Stück, je max. 30 Zeichen)"),
          descriptions: z.array(z.string()).min(2).max(4).describe("Descriptions (2-4 Stück, je max. 90 Zeichen)"),
          final_url: z.string().describe("Finale URL"),
          path1: z.string().optional().describe("URL-Pfad 1 (max. 15 Zeichen)"),
          path2: z.string().optional().describe("URL-Pfad 2 (max. 15 Zeichen)"),
        },
      },
      async ({ customer_id, ad_group_id, headlines, descriptions, final_url, path1, path2 }) => {
        try {
          const customer = getCustomer(customer_id);
          const ad: any = {
            _resource: "AdGroupAd",
            _operation: "create",
            ad_group: `customers/${customer_id}/adGroups/${ad_group_id}`,
            status: 2, // ENABLED
            ad: {
              final_urls: [final_url],
              responsive_search_ad: {
                headlines: headlines.map((h, i) => ({ text: h, pinned_field: i < 3 ? undefined : undefined })),
                descriptions: descriptions.map(d => ({ text: d })),
                path1: path1 || undefined,
                path2: path2 || undefined,
              },
            },
          };
          const result = await customer.mutateResources([ad]);
          return { content: [{ type: "text" as const, text: `RSA erstellt: ${JSON.stringify(result, null, 2)}` }] };
        } catch (error: any) {
          return { content: [{ type: "text" as const, text: `Fehler: ${error.message}` }] };
        }
      }
    );

    server.registerTool(
      "set_ad_status",
      {
        title: "Set Ad Status",
        description: "Ändert den Status einer Anzeige (ENABLED, PAUSED).",
        inputSchema: {
          customer_id: z.string().describe("Google Ads Customer ID"),
          ad_group_id: z.string().describe("Ad Group ID"),
          ad_id: z.string().describe("Ad ID"),
          status: z.enum(["ENABLED", "PAUSED"]).describe("Neuer Status"),
        },
      },
      async ({ customer_id, ad_group_id, ad_id, status }) => {
        try {
          const customer = getCustomer(customer_id);
          await customer.mutateResources([{
            _resource: "AdGroupAd",
            _operation: "update",
            resource_name: `customers/${customer_id}/adGroupAds/${ad_group_id}~${ad_id}`,
            status: status === "ENABLED" ? 2 : 3,
          }]);
          return { content: [{ type: "text" as const, text: `Anzeige ${ad_id} auf ${status} gesetzt.` }] };
        } catch (error: any) {
          return { content: [{ type: "text" as const, text: `Fehler: ${error.message}` }] };
        }
      }
    );

    // ==================== KEYWORDS ====================

    server.registerTool(
      "get_keyword_performance",
      {
        title: "Get Keyword Performance",
        description: "Zeigt die Performance der Keywords eines Kontos.",
        inputSchema: {
          customer_id: z.string().describe("Google Ads Customer ID"),
          date_range: z.enum(["LAST_7_DAYS","LAST_14_DAYS","LAST_30_DAYS","LAST_90_DAYS"]).default("LAST_30_DAYS"),
          limit: z.number().int().min(1).max(100).default(50),
        },
      },
      async ({ customer_id, date_range, limit }) => {
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
          const keywords = results.map((row: any) => ({
            keyword: row.ad_group_criterion.keyword.text,
            matchType: row.ad_group_criterion.keyword.match_type,
            status: row.ad_group_criterion.status,
            campaign: row.campaign.name, adGroup: row.ad_group.name,
            impressions: row.metrics.impressions, clicks: row.metrics.clicks,
            cost: (row.metrics.cost_micros / 1_000_000).toFixed(2) + " €",
            conversions: row.metrics.conversions,
            ctr: (row.metrics.ctr * 100).toFixed(2) + "%",
            avgCpc: (row.metrics.average_cpc / 1_000_000).toFixed(2) + " €",
            impressionShare: row.metrics.search_impression_share ? (row.metrics.search_impression_share * 100).toFixed(1) + "%" : "N/A",
          }));
          return { content: [{ type: "text" as const, text: JSON.stringify(keywords, null, 2) }] };
        } catch (error: any) {
          return { content: [{ type: "text" as const, text: `Fehler: ${error.message}` }] };
        }
      }
    );

    server.registerTool(
      "add_keywords",
      {
        title: "Add Keywords",
        description: "Fügt Keywords zu einer Ad Group hinzu.",
        inputSchema: {
          customer_id: z.string().describe("Google Ads Customer ID"),
          ad_group_id: z.string().describe("Ad Group ID"),
          keywords: z.array(z.object({
            text: z.string().describe("Keyword-Text"),
            match_type: z.enum(["EXACT", "PHRASE", "BROAD"]).describe("Match Type"),
          })).describe("Liste der Keywords"),
          cpc_bid_micros: z.number().optional().describe("Optionales CPC-Gebot in Micros"),
        },
      },
      async ({ customer_id, ad_group_id, keywords, cpc_bid_micros }) => {
        try {
          const matchTypeMap: Record<string, number> = { EXACT: 2, PHRASE: 3, BROAD: 4 };
          const customer = getCustomer(customer_id);
          const operations = keywords.map(kw => {
            const op: any = {
              _resource: "AdGroupCriterion",
              _operation: "create",
              ad_group: `customers/${customer_id}/adGroups/${ad_group_id}`,
              status: 2,
              keyword: { text: kw.text, match_type: matchTypeMap[kw.match_type] },
            };
            if (cpc_bid_micros) op.cpc_bid_micros = cpc_bid_micros;
            return op;
          });
          const result = await customer.mutateResources(operations);
          return { content: [{ type: "text" as const, text: `${keywords.length} Keywords hinzugefügt: ${JSON.stringify(result, null, 2)}` }] };
        } catch (error: any) {
          return { content: [{ type: "text" as const, text: `Fehler: ${error.message}` }] };
        }
      }
    );

    server.registerTool(
      "remove_keyword",
      {
        title: "Remove Keyword",
        description: "Entfernt ein Keyword aus einer Ad Group.",
        inputSchema: {
          customer_id: z.string().describe("Google Ads Customer ID"),
          ad_group_id: z.string().describe("Ad Group ID"),
          criterion_id: z.string().describe("Criterion ID des Keywords"),
        },
      },
      async ({ customer_id, ad_group_id, criterion_id }) => {
        try {
          const customer = getCustomer(customer_id);
          await customer.mutateResources([{
            _resource: "AdGroupCriterion",
            _operation: "remove",
            resource_name: `customers/${customer_id}/adGroupCriteria/${ad_group_id}~${criterion_id}`,
          }]);
          return { content: [{ type: "text" as const, text: `Keyword ${criterion_id} entfernt.` }] };
        } catch (error: any) {
          return { content: [{ type: "text" as const, text: `Fehler: ${error.message}` }] };
        }
      }
    );

    server.registerTool(
      "add_negative_keywords",
      {
        title: "Add Negative Keywords",
        description: "Fügt negative Keywords auf Kampagnen- oder Ad-Group-Ebene hinzu.",
        inputSchema: {
          customer_id: z.string().describe("Google Ads Customer ID"),
          keywords: z.array(z.object({
            text: z.string().describe("Keyword-Text"),
            match_type: z.enum(["EXACT", "PHRASE", "BROAD"]).default("BROAD"),
          })),
          campaign_id: z.string().optional().describe("Campaign ID (für Kampagnen-Ebene)"),
          ad_group_id: z.string().optional().describe("Ad Group ID (für Ad-Group-Ebene)"),
        },
      },
      async ({ customer_id, keywords, campaign_id, ad_group_id }) => {
        try {
          const matchTypeMap: Record<string, number> = { EXACT: 2, PHRASE: 3, BROAD: 4 };
          const customer = getCustomer(customer_id);

          if (campaign_id) {
            const operations = keywords.map(kw => ({
              _resource: "CampaignCriterion" as const,
              _operation: "create" as const,
              campaign: `customers/${customer_id}/campaigns/${campaign_id}`,
              negative: true,
              keyword: { text: kw.text, match_type: matchTypeMap[kw.match_type] },
            }));
            const result = await customer.mutateResources(operations);
            return { content: [{ type: "text" as const, text: `${keywords.length} negative Keywords auf Kampagnen-Ebene hinzugefügt: ${JSON.stringify(result, null, 2)}` }] };
          } else if (ad_group_id) {
            const operations = keywords.map(kw => ({
              _resource: "AdGroupCriterion" as const,
              _operation: "create" as const,
              ad_group: `customers/${customer_id}/adGroups/${ad_group_id}`,
              negative: true,
              keyword: { text: kw.text, match_type: matchTypeMap[kw.match_type] },
            }));
            const result = await customer.mutateResources(operations);
            return { content: [{ type: "text" as const, text: `${keywords.length} negative Keywords auf Ad-Group-Ebene hinzugefügt: ${JSON.stringify(result, null, 2)}` }] };
          }
          return { content: [{ type: "text" as const, text: "Fehler: campaign_id oder ad_group_id muss angegeben werden." }] };
        } catch (error: any) {
          return { content: [{ type: "text" as const, text: `Fehler: ${error.message}` }] };
        }
      }
    );

    server.registerTool(
      "get_search_terms_report",
      {
        title: "Get Search Terms Report",
        description: "Zeigt den Suchanfragen-Bericht.",
        inputSchema: {
          customer_id: z.string().describe("Google Ads Customer ID"),
          date_range: z.enum(["LAST_7_DAYS","LAST_14_DAYS","LAST_30_DAYS","LAST_90_DAYS"]).default("LAST_30_DAYS"),
          campaign_id: z.string().optional().describe("Optional: Campaign ID Filter"),
          limit: z.number().int().min(1).max(200).default(100),
        },
      },
      async ({ customer_id, date_range, campaign_id, limit }) => {
        try {
          const customer = getCustomer(customer_id);
          let query = `
            SELECT search_term_view.search_term, search_term_view.status,
              campaign.name, ad_group.name,
              metrics.impressions, metrics.clicks, metrics.cost_micros, metrics.conversions, metrics.ctr
            FROM search_term_view WHERE segments.date DURING ${date_range}
          `;
          if (campaign_id) query += ` AND campaign.id = ${campaign_id}`;
          query += ` ORDER BY metrics.impressions DESC LIMIT ${limit}`;
          const results = await customer.query(query);
          const terms = results.map((row: any) => ({
            searchTerm: row.search_term_view.search_term,
            status: row.search_term_view.status,
            campaign: row.campaign.name, adGroup: row.ad_group.name,
            impressions: row.metrics.impressions, clicks: row.metrics.clicks,
            cost: (row.metrics.cost_micros / 1_000_000).toFixed(2) + " €",
            conversions: row.metrics.conversions,
            ctr: (row.metrics.ctr * 100).toFixed(2) + "%",
          }));
          return { content: [{ type: "text" as const, text: JSON.stringify(terms, null, 2) }] };
        } catch (error: any) {
          return { content: [{ type: "text" as const, text: `Fehler: ${error.message}` }] };
        }
      }
    );

    // ==================== GAQL ====================

    server.registerTool(
      "run_gaql_query",
      {
        title: "Run GAQL Query",
        description: "Führt eine benutzerdefinierte Google Ads Query Language (GAQL) Query aus.",
        inputSchema: {
          customer_id: z.string().describe("Google Ads Customer ID (ohne Bindestriche)"),
          query: z.string().describe("GAQL Query String"),
        },
      },
      async ({ customer_id, query }) => {
        try {
          const customer = getCustomer(customer_id);
          const results = await customer.query(query);
          return { content: [{ type: "text" as const, text: JSON.stringify(results, null, 2) }] };
        } catch (error: any) {
          return { content: [{ type: "text" as const, text: `GAQL Fehler: ${error.message}` }] };
        }
      }
    );

    // ==================== REPORTS ====================

    server.registerTool(
      "get_quality_score_report",
      {
        title: "Get Quality Score Report",
        description: "Zeigt Quality Scores der Keywords.",
        inputSchema: {
          customer_id: z.string().describe("Google Ads Customer ID"),
          limit: z.number().int().min(1).max(200).default(100),
        },
      },
      async ({ customer_id, limit }) => {
        try {
          const customer = getCustomer(customer_id);
          const results = await customer.query(`
            SELECT ad_group_criterion.keyword.text, ad_group_criterion.keyword.match_type,
              ad_group_criterion.quality_info.quality_score,
              ad_group_criterion.quality_info.creative_quality_score,
              ad_group_criterion.quality_info.search_predicted_ctr,
              ad_group_criterion.quality_info.post_click_quality_score,
              campaign.name, ad_group.name, ad_group_criterion.status
            FROM keyword_view
            WHERE ad_group_criterion.status != 'REMOVED'
            ORDER BY ad_group_criterion.quality_info.quality_score ASC
            LIMIT ${limit}
          `);
          const keywords = results.map((row: any) => ({
            keyword: row.ad_group_criterion.keyword.text,
            matchType: row.ad_group_criterion.keyword.match_type,
            qualityScore: row.ad_group_criterion.quality_info?.quality_score ?? "N/A",
            creativeQuality: row.ad_group_criterion.quality_info?.creative_quality_score ?? "N/A",
            expectedCtr: row.ad_group_criterion.quality_info?.search_predicted_ctr ?? "N/A",
            landingPageExp: row.ad_group_criterion.quality_info?.post_click_quality_score ?? "N/A",
            campaign: row.campaign.name, adGroup: row.ad_group.name,
          }));
          return { content: [{ type: "text" as const, text: JSON.stringify(keywords, null, 2) }] };
        } catch (error: any) {
          return { content: [{ type: "text" as const, text: `Fehler: ${error.message}` }] };
        }
      }
    );

    server.registerTool(
      "get_conversion_report",
      {
        title: "Get Conversion Report",
        description: "Zeigt Conversion-Daten pro Kampagne.",
        inputSchema: {
          customer_id: z.string().describe("Google Ads Customer ID"),
          date_range: z.enum(["LAST_7_DAYS","LAST_14_DAYS","LAST_30_DAYS","LAST_90_DAYS"]).default("LAST_30_DAYS"),
        },
      },
      async ({ customer_id, date_range }) => {
        try {
          const customer = getCustomer(customer_id);
          const results = await customer.query(`
            SELECT campaign.id, campaign.name,
              metrics.conversions, metrics.conversions_value, metrics.cost_per_conversion,
              metrics.conversion_rate, metrics.cost_micros, metrics.clicks,
              metrics.conversions_from_interactions_rate
            FROM campaign WHERE segments.date DURING ${date_range} AND campaign.status != 'REMOVED'
            ORDER BY metrics.conversions DESC
          `);
          const campaigns = results.map((row: any) => ({
            id: row.campaign.id, name: row.campaign.name,
            conversions: row.metrics.conversions,
            conversionValue: row.metrics.conversions_value,
            costPerConversion: row.metrics.cost_per_conversion ? (row.metrics.cost_per_conversion / 1_000_000).toFixed(2) + " €" : "N/A",
            conversionRate: row.metrics.conversions_from_interactions_rate ? (row.metrics.conversions_from_interactions_rate * 100).toFixed(2) + "%" : "N/A",
            cost: (row.metrics.cost_micros / 1_000_000).toFixed(2) + " €",
            clicks: row.metrics.clicks,
          }));
          return { content: [{ type: "text" as const, text: JSON.stringify(campaigns, null, 2) }] };
        } catch (error: any) {
          return { content: [{ type: "text" as const, text: `Fehler: ${error.message}` }] };
        }
      }
    );

    server.registerTool(
      "get_geographic_report",
      {
        title: "Get Geographic Report",
        description: "Zeigt Performance nach Standort.",
        inputSchema: {
          customer_id: z.string().describe("Google Ads Customer ID"),
          date_range: z.enum(["LAST_7_DAYS","LAST_14_DAYS","LAST_30_DAYS","LAST_90_DAYS"]).default("LAST_30_DAYS"),
          limit: z.number().int().min(1).max(100).default(50),
        },
      },
      async ({ customer_id, date_range, limit }) => {
        try {
          const customer = getCustomer(customer_id);
          const results = await customer.query(`
            SELECT geographic_view.country_criterion_id, geographic_view.location_type,
              campaign.name, metrics.impressions, metrics.clicks, metrics.cost_micros,
              metrics.conversions, metrics.ctr
            FROM geographic_view WHERE segments.date DURING ${date_range}
            ORDER BY metrics.cost_micros DESC LIMIT ${limit}
          `);
          const locations = results.map((row: any) => ({
            countryId: row.geographic_view.country_criterion_id,
            locationType: row.geographic_view.location_type,
            campaign: row.campaign.name,
            impressions: row.metrics.impressions, clicks: row.metrics.clicks,
            cost: (row.metrics.cost_micros / 1_000_000).toFixed(2) + " €",
            conversions: row.metrics.conversions,
            ctr: (row.metrics.ctr * 100).toFixed(2) + "%",
          }));
          return { content: [{ type: "text" as const, text: JSON.stringify(locations, null, 2) }] };
        } catch (error: any) {
          return { content: [{ type: "text" as const, text: `Fehler: ${error.message}` }] };
        }
      }
    );

    server.registerTool(
      "get_device_report",
      {
        title: "Get Device Report",
        description: "Zeigt Performance nach Gerät.",
        inputSchema: {
          customer_id: z.string().describe("Google Ads Customer ID"),
          date_range: z.enum(["LAST_7_DAYS","LAST_14_DAYS","LAST_30_DAYS","LAST_90_DAYS"]).default("LAST_30_DAYS"),
        },
      },
      async ({ customer_id, date_range }) => {
        try {
          const customer = getCustomer(customer_id);
          const results = await customer.query(`
            SELECT segments.device, metrics.impressions, metrics.clicks, metrics.cost_micros,
              metrics.conversions, metrics.ctr, metrics.average_cpc
            FROM campaign WHERE segments.date DURING ${date_range} AND campaign.status != 'REMOVED'
          `);
          const devices = results.map((row: any) => ({
            device: row.segments.device,
            impressions: row.metrics.impressions, clicks: row.metrics.clicks,
            cost: (row.metrics.cost_micros / 1_000_000).toFixed(2) + " €",
            conversions: row.metrics.conversions,
            ctr: (row.metrics.ctr * 100).toFixed(2) + "%",
            avgCpc: (row.metrics.average_cpc / 1_000_000).toFixed(2) + " €",
          }));
          return { content: [{ type: "text" as const, text: JSON.stringify(devices, null, 2) }] };
        } catch (error: any) {
          return { content: [{ type: "text" as const, text: `Fehler: ${error.message}` }] };
        }
      }
    );

    server.registerTool(
      "get_hour_of_day_report",
      {
        title: "Get Hour of Day Report",
        description: "Zeigt Performance nach Tageszeit.",
        inputSchema: {
          customer_id: z.string().describe("Google Ads Customer ID"),
          date_range: z.enum(["LAST_7_DAYS","LAST_14_DAYS","LAST_30_DAYS","LAST_90_DAYS"]).default("LAST_30_DAYS"),
        },
      },
      async ({ customer_id, date_range }) => {
        try {
          const customer = getCustomer(customer_id);
          const results = await customer.query(`
            SELECT segments.hour, metrics.impressions, metrics.clicks, metrics.cost_micros,
              metrics.conversions, metrics.ctr, metrics.average_cpc
            FROM campaign WHERE segments.date DURING ${date_range} AND campaign.status != 'REMOVED'
          `);
          const hours = results.map((row: any) => ({
            hour: row.segments.hour,
            impressions: row.metrics.impressions, clicks: row.metrics.clicks,
            cost: (row.metrics.cost_micros / 1_000_000).toFixed(2) + " €",
            conversions: row.metrics.conversions,
            ctr: (row.metrics.ctr * 100).toFixed(2) + "%",
            avgCpc: (row.metrics.average_cpc / 1_000_000).toFixed(2) + " €",
          }));
          return { content: [{ type: "text" as const, text: JSON.stringify(hours, null, 2) }] };
        } catch (error: any) {
          return { content: [{ type: "text" as const, text: `Fehler: ${error.message}` }] };
        }
      }
    );

    server.registerTool(
      "get_search_impression_share",
      {
        title: "Get Search Impression Share",
        description: "Zeigt Impression Share Analyse pro Kampagne.",
        inputSchema: {
          customer_id: z.string().describe("Google Ads Customer ID"),
          date_range: z.enum(["LAST_7_DAYS","LAST_14_DAYS","LAST_30_DAYS","LAST_90_DAYS"]).default("LAST_30_DAYS"),
        },
      },
      async ({ customer_id, date_range }) => {
        try {
          const customer = getCustomer(customer_id);
          const results = await customer.query(`
            SELECT campaign.id, campaign.name,
              metrics.search_impression_share, metrics.search_rank_lost_impression_share,
              metrics.search_budget_lost_impression_share, metrics.search_exact_match_impression_share,
              metrics.impressions, metrics.clicks, metrics.cost_micros
            FROM campaign WHERE segments.date DURING ${date_range} AND campaign.status != 'REMOVED'
              AND campaign.advertising_channel_type = 'SEARCH'
            ORDER BY metrics.impressions DESC
          `);
          const campaigns = results.map((row: any) => ({
            id: row.campaign.id, name: row.campaign.name,
            impressionShare: row.metrics.search_impression_share ? (row.metrics.search_impression_share * 100).toFixed(1) + "%" : "N/A",
            rankLost: row.metrics.search_rank_lost_impression_share ? (row.metrics.search_rank_lost_impression_share * 100).toFixed(1) + "%" : "N/A",
            budgetLost: row.metrics.search_budget_lost_impression_share ? (row.metrics.search_budget_lost_impression_share * 100).toFixed(1) + "%" : "N/A",
            exactMatchShare: row.metrics.search_exact_match_impression_share ? (row.metrics.search_exact_match_impression_share * 100).toFixed(1) + "%" : "N/A",
            impressions: row.metrics.impressions,
            cost: (row.metrics.cost_micros / 1_000_000).toFixed(2) + " €",
          }));
          return { content: [{ type: "text" as const, text: JSON.stringify(campaigns, null, 2) }] };
        } catch (error: any) {
          return { content: [{ type: "text" as const, text: `Fehler: ${error.message}` }] };
        }
      }
    );

    server.registerTool(
      "get_landing_page_report",
      {
        title: "Get Landing Page Report",
        description: "Zeigt Landing Page Performance.",
        inputSchema: {
          customer_id: z.string().describe("Google Ads Customer ID"),
          date_range: z.enum(["LAST_7_DAYS","LAST_14_DAYS","LAST_30_DAYS","LAST_90_DAYS"]).default("LAST_30_DAYS"),
          limit: z.number().int().min(1).max(100).default(50),
        },
      },
      async ({ customer_id, date_range, limit }) => {
        try {
          const customer = getCustomer(customer_id);
          const results = await customer.query(`
            SELECT landing_page_view.unexpanded_final_url,
              metrics.impressions, metrics.clicks, metrics.cost_micros,
              metrics.conversions, metrics.ctr, metrics.average_cpc, metrics.cost_per_conversion
            FROM landing_page_view WHERE segments.date DURING ${date_range}
            ORDER BY metrics.clicks DESC LIMIT ${limit}
          `);
          const pages = results.map((row: any) => ({
            url: row.landing_page_view.unexpanded_final_url,
            impressions: row.metrics.impressions, clicks: row.metrics.clicks,
            cost: (row.metrics.cost_micros / 1_000_000).toFixed(2) + " €",
            conversions: row.metrics.conversions,
            ctr: (row.metrics.ctr * 100).toFixed(2) + "%",
            avgCpc: (row.metrics.average_cpc / 1_000_000).toFixed(2) + " €",
            costPerConversion: row.metrics.cost_per_conversion ? (row.metrics.cost_per_conversion / 1_000_000).toFixed(2) + " €" : "N/A",
          }));
          return { content: [{ type: "text" as const, text: JSON.stringify(pages, null, 2) }] };
        } catch (error: any) {
          return { content: [{ type: "text" as const, text: `Fehler: ${error.message}` }] };
        }
      }
    );

    server.registerTool(
      "get_budget_report",
      {
        title: "Get Budget Report",
        description: "Zeigt Budget-Auslastung pro Kampagne.",
        inputSchema: {
          customer_id: z.string().describe("Google Ads Customer ID"),
          date_range: z.enum(["LAST_7_DAYS","LAST_14_DAYS","LAST_30_DAYS","LAST_90_DAYS"]).default("LAST_30_DAYS"),
        },
      },
      async ({ customer_id, date_range }) => {
        try {
          const customer = getCustomer(customer_id);
          const results = await customer.query(`
            SELECT campaign.id, campaign.name, campaign.status,
              campaign_budget.amount_micros, campaign_budget.total_amount_micros,
              campaign_budget.status, campaign_budget.delivery_method,
              metrics.cost_micros, metrics.impressions, metrics.clicks
            FROM campaign WHERE segments.date DURING ${date_range} AND campaign.status != 'REMOVED'
            ORDER BY metrics.cost_micros DESC
          `);
          const budgets = results.map((row: any) => ({
            campaignId: row.campaign.id, campaignName: row.campaign.name,
            campaignStatus: row.campaign.status,
            dailyBudget: row.campaign_budget.amount_micros ? (row.campaign_budget.amount_micros / 1_000_000).toFixed(2) + " €" : "N/A",
            totalBudget: row.campaign_budget.total_amount_micros ? (row.campaign_budget.total_amount_micros / 1_000_000).toFixed(2) + " €" : "Unbegrenzt",
            budgetStatus: row.campaign_budget.status,
            deliveryMethod: row.campaign_budget.delivery_method,
            spent: (row.metrics.cost_micros / 1_000_000).toFixed(2) + " €",
            impressions: row.metrics.impressions, clicks: row.metrics.clicks,
          }));
          return { content: [{ type: "text" as const, text: JSON.stringify(budgets, null, 2) }] };
        } catch (error: any) {
          return { content: [{ type: "text" as const, text: `Fehler: ${error.message}` }] };
        }
      }
    );

    server.registerTool(
      "get_change_history",
      {
        title: "Get Change History",
        description: "Zeigt den Änderungsverlauf des Kontos.",
        inputSchema: {
          customer_id: z.string().describe("Google Ads Customer ID"),
          date_range: z.enum(["LAST_7_DAYS","LAST_14_DAYS","LAST_30_DAYS"]).default("LAST_7_DAYS"),
          limit: z.number().int().min(1).max(100).default(50),
        },
      },
      async ({ customer_id, date_range, limit }) => {
        try {
          const customer = getCustomer(customer_id);
          const results = await customer.query(`
            SELECT change_event.change_date_time, change_event.change_resource_type,
              change_event.change_resource_name, change_event.client_type,
              change_event.user_email, change_event.old_resource, change_event.new_resource,
              campaign.name
            FROM change_event WHERE segments.date DURING ${date_range}
            ORDER BY change_event.change_date_time DESC LIMIT ${limit}
          `);
          return { content: [{ type: "text" as const, text: JSON.stringify(results, null, 2) }] };
        } catch (error: any) {
          return { content: [{ type: "text" as const, text: `Fehler: ${error.message}` }] };
        }
      }
    );

    // ==================== EXTENSIONS ====================

    server.registerTool(
      "list_extensions",
      {
        title: "List Extensions",
        description: "Listet Anzeigenerweiterungen (Assets) eines Kontos auf.",
        inputSchema: {
          customer_id: z.string().describe("Google Ads Customer ID"),
          type: z.enum(["SITELINK", "CALLOUT", "CALL", "STRUCTURED_SNIPPET", "ALL"]).default("ALL"),
        },
      },
      async ({ customer_id, type }) => {
        try {
          const customer = getCustomer(customer_id);
          let query = `
            SELECT asset.id, asset.name, asset.type, asset.sitelink_asset.description1,
              asset.sitelink_asset.description2, asset.sitelink_asset.link_text,
              asset.callout_asset.callout_text, asset.final_urls
            FROM asset WHERE asset.type != 'UNKNOWN'
          `;
          if (type !== "ALL") query += ` AND asset.type = '${type}'`;
          query += ` LIMIT 200`;
          const results = await customer.query(query);
          return { content: [{ type: "text" as const, text: JSON.stringify(results, null, 2) }] };
        } catch (error: any) {
          return { content: [{ type: "text" as const, text: `Fehler: ${error.message}` }] };
        }
      }
    );

    server.registerTool(
      "create_sitelink_extension",
      {
        title: "Create Sitelink Extension",
        description: "Erstellt eine Sitelink-Erweiterung.",
        inputSchema: {
          customer_id: z.string().describe("Google Ads Customer ID"),
          link_text: z.string().max(25).describe("Sitelink-Text (max. 25 Zeichen)"),
          final_url: z.string().describe("Ziel-URL"),
          description1: z.string().max(35).optional().describe("Beschreibung 1 (max. 35 Zeichen)"),
          description2: z.string().max(35).optional().describe("Beschreibung 2 (max. 35 Zeichen)"),
        },
      },
      async ({ customer_id, link_text, final_url, description1, description2 }) => {
        try {
          const customer = getCustomer(customer_id);
          const asset: any = {
            _resource: "Asset",
            _operation: "create",
            type: 5, // SITELINK
            sitelink_asset: {
              link_text,
              description1: description1 || "",
              description2: description2 || "",
            },
            final_urls: [final_url],
          };
          const result = await customer.mutateResources([asset]);
          return { content: [{ type: "text" as const, text: `Sitelink erstellt: ${JSON.stringify(result, null, 2)}` }] };
        } catch (error: any) {
          return { content: [{ type: "text" as const, text: `Fehler: ${error.message}` }] };
        }
      }
    );

    server.registerTool(
      "create_callout_extension",
      {
        title: "Create Callout Extension",
        description: "Erstellt eine Callout-Erweiterung.",
        inputSchema: {
          customer_id: z.string().describe("Google Ads Customer ID"),
          callout_text: z.string().max(25).describe("Callout-Text (max. 25 Zeichen)"),
        },
      },
      async ({ customer_id, callout_text }) => {
        try {
          const customer = getCustomer(customer_id);
          const result = await customer.mutateResources([{
            _resource: "Asset",
            _operation: "create",
            type: 8, // CALLOUT
            callout_asset: { callout_text },
          }]);
          return { content: [{ type: "text" as const, text: `Callout erstellt: ${JSON.stringify(result, null, 2)}` }] };
        } catch (error: any) {
          return { content: [{ type: "text" as const, text: `Fehler: ${error.message}` }] };
        }
      }
    );
  },
  {},
  {
    basePath: "/api",
    maxDuration: 60,
    verboseLogs: true,
  }
);

export { handler as GET, handler as POST };
