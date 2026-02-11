import { GoogleAdsApi } from "google-ads-api";

let client: GoogleAdsApi | null = null;

export function getGoogleAdsClient(): GoogleAdsApi {
  if (!client) {
    client = new GoogleAdsApi({
      client_id: process.env.GOOGLE_ADS_CLIENT_ID!,
      client_secret: process.env.GOOGLE_ADS_CLIENT_SECRET!,
      developer_token: process.env.GOOGLE_ADS_DEVELOPER_TOKEN!,
    });
  }
  return client;
}

export function getCustomer(customerId: string) {
  const client = getGoogleAdsClient();
  return client.Customer({
    customer_id: customerId,
    login_customer_id: process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID!,
    refresh_token: process.env.GOOGLE_ADS_REFRESH_TOKEN!,
  });
}
