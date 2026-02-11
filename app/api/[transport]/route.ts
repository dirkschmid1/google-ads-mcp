import { createMcpHandler } from "mcp-handler";
import { z } from "zod";
import { getCustomer } from "@/lib/google-ads-client";

const handler = createMcpHandler(
  (server) => {
    // Tool 1: Alle Accounts im MCC auflisten
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
            SELECT
              customer_client.id,
              customer_client.descriptive_name,
              customer_client.status,
              customer_client.manager
            FROM customer_client
            WHERE customer_client.status = 'ENABLED'
          `);
          const accounts = results.map((row: any) => ({
            id: row.customer_client.id,
            name: row.customer_client.descriptive_name,
            status: row.customer_client.status,
            isManager: row.customer_client.manager,
          }));
          return {
            content: [{ type: "text" as const, text: JSON.stringify(accounts, null, 2) }],
          };
        } catch (error: any) {
          return {
            content: [{ type: "text" as const, text: `Fehler: ${error.message}` }],
          };
        }
      }
    );

    // Tool 2: Kampagnen-Performance
    server.registerTool(
      "get_campaign_performance",
      {
        title: "Get Campaign Performance",
        description: "Zeigt Kampagnen-Performance für ein bestimmtes Konto und einen Zeitraum.",
        inputSchema: {
          customer_id: z.string().describe("Google Ads Customer ID (ohne Bindestriche)"),
          date_range: z.enum([
            "LAST_7_DAYS", "LAST_14_DAYS", "LAST_30_DAYS",
            "THIS_MONTH", "LAST_MONTH", "LAST_90_DAYS"
          ]).default("LAST_30_DAYS").describe("Zeitraum"),
        },
      },
      async ({ customer_id, date_range }) => {
        try {
          const customer = getCustomer(customer_id);
          const results = await customer.query(`
            SELECT
              campaign.id, campaign.name, campaign.status,
              campaign.advertising_channel_type,
              metrics.impressions, metrics.clicks, metrics.cost_micros,
              metrics.conversions, metrics.conversions_value,
              metrics.ctr, metrics.average_cpc, metrics.cost_per_conversion
            FROM campaign
            WHERE segments.date DURING ${date_range}
              AND campaign.status != 'REMOVED'
            ORDER BY metrics.cost_micros DESC
          `);
          const campaigns = results.map((row: any) => ({
            id: row.campaign.id,
            name: row.campaign.name,
            status: row.campaign.status,
            type: row.campaign.advertising_channel_type,
            impressions: row.metrics.impressions,
            clicks: row.metrics.clicks,
            cost: (row.metrics.cost_micros / 1_000_000).toFixed(2) + " €",
            conversions: row.metrics.conversions,
            conversionValue: row.metrics.conversions_value,
            ctr: (row.metrics.ctr * 100).toFixed(2) + "%",
            avgCpc: (row.metrics.average_cpc / 1_000_000).toFixed(2) + " €",
            costPerConversion: row.metrics.cost_per_conversion
              ? (row.metrics.cost_per_conversion / 1_000_000).toFixed(2) + " €"
              : "N/A",
          }));
          return {
            content: [{ type: "text" as const, text: JSON.stringify(campaigns, null, 2) }],
          };
        } catch (error: any) {
          return {
            content: [{ type: "text" as const, text: `Fehler: ${error.message}` }],
          };
        }
      }
    );

    // Tool 3: GAQL Query
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
          return {
            content: [{ type: "text" as const, text: JSON.stringify(results, null, 2) }],
          };
        } catch (error: any) {
          return {
            content: [{ type: "text" as const, text: `GAQL Fehler: ${error.message}` }],
          };
        }
      }
    );

    // Tool 4: Keyword Performance
    server.registerTool(
      "get_keyword_performance",
      {
        title: "Get Keyword Performance",
        description: "Zeigt die Performance der Keywords eines Kontos.",
        inputSchema: {
          customer_id: z.string().describe("Google Ads Customer ID"),
          date_range: z.enum([
            "LAST_7_DAYS", "LAST_14_DAYS", "LAST_30_DAYS", "LAST_90_DAYS"
          ]).default("LAST_30_DAYS"),
          limit: z.number().int().min(1).max(100).default(50).describe("Max. Anzahl Keywords"),
        },
      },
      async ({ customer_id, date_range, limit }) => {
        try {
          const customer = getCustomer(customer_id);
          const results = await customer.query(`
            SELECT
              ad_group_criterion.keyword.text,
              ad_group_criterion.keyword.match_type,
              ad_group_criterion.status,
              campaign.name, ad_group.name,
              metrics.impressions, metrics.clicks, metrics.cost_micros,
              metrics.conversions, metrics.ctr, metrics.average_cpc,
              metrics.search_impression_share
            FROM keyword_view
            WHERE segments.date DURING ${date_range}
            ORDER BY metrics.cost_micros DESC
            LIMIT ${limit}
          `);
          const keywords = results.map((row: any) => ({
            keyword: row.ad_group_criterion.keyword.text,
            matchType: row.ad_group_criterion.keyword.match_type,
            status: row.ad_group_criterion.status,
            campaign: row.campaign.name,
            adGroup: row.ad_group.name,
            impressions: row.metrics.impressions,
            clicks: row.metrics.clicks,
            cost: (row.metrics.cost_micros / 1_000_000).toFixed(2) + " €",
            conversions: row.metrics.conversions,
            ctr: (row.metrics.ctr * 100).toFixed(2) + "%",
            avgCpc: (row.metrics.average_cpc / 1_000_000).toFixed(2) + " €",
            impressionShare: row.metrics.search_impression_share
              ? (row.metrics.search_impression_share * 100).toFixed(1) + "%"
              : "N/A",
          }));
          return {
            content: [{ type: "text" as const, text: JSON.stringify(keywords, null, 2) }],
          };
        } catch (error: any) {
          return {
            content: [{ type: "text" as const, text: `Fehler: ${error.message}` }],
          };
        }
      }
    );

    // Tool 5: Kampagnen-Status ändern
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
              update: {
                resourceName: `customers/${customer_id}/campaigns/${campaign_id}`,
                status: status === "ENABLED" ? 2 : 3,
              },
            }],
          });
          return {
            content: [{ type: "text" as const, text: `Kampagne ${campaign_id} wurde auf ${status} gesetzt.` }],
          };
        } catch (error: any) {
          return {
            content: [{ type: "text" as const, text: `Fehler: ${error.message}` }],
          };
        }
      }
    );

    // Tool 6: Ad Performance
    server.registerTool(
      "get_ad_performance",
      {
        title: "Get Ad Performance",
        description: "Zeigt die Performance einzelner Anzeigen.",
        inputSchema: {
          customer_id: z.string().describe("Google Ads Customer ID"),
          date_range: z.enum([
            "LAST_7_DAYS", "LAST_14_DAYS", "LAST_30_DAYS", "LAST_90_DAYS"
          ]).default("LAST_30_DAYS"),
          campaign_name: z.string().optional().describe("Optionaler Kampagnenname-Filter"),
        },
      },
      async ({ customer_id, date_range, campaign_name }) => {
        try {
          const customer = getCustomer(customer_id);
          let query = `
            SELECT
              ad_group_ad.ad.id, ad_group_ad.ad.type,
              ad_group_ad.ad.responsive_search_ad.headlines,
              ad_group_ad.status, campaign.name, ad_group.name,
              metrics.impressions, metrics.clicks, metrics.cost_micros,
              metrics.conversions, metrics.ctr, metrics.average_cpc
            FROM ad_group_ad
            WHERE segments.date DURING ${date_range}
              AND ad_group_ad.status != 'REMOVED'
          `;
          if (campaign_name) {
            query += ` AND campaign.name LIKE '%${campaign_name}%'`;
          }
          query += ` ORDER BY metrics.cost_micros DESC LIMIT 50`;
          const results = await customer.query(query);
          return {
            content: [{ type: "text" as const, text: JSON.stringify(results, null, 2) }],
          };
        } catch (error: any) {
          return {
            content: [{ type: "text" as const, text: `Fehler: ${error.message}` }],
          };
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
