import { AwsClient } from "npm:aws4fetch";
export default {
  async fetch(request: Request): Promise<Response> {
    try {
      // 1. Deno Environment Variable မှ Configuration ကို ယူခြင်း
      const configData = Deno.env.get("ACCOUNTS_JSON");
      
      if (!configData) {
        return new Response("Error: 'ACCOUNTS_JSON' variable not found in Deno settings", { status: 500 });
      }

      // JSON string ကို Object အဖြစ် ပြောင်းခြင်း
      const R2_ACCOUNTS = JSON.parse(configData);

      // 2. URL Parameter ခွဲထုတ်ခြင်း
      const url = new URL(request.url);
      const video = url.searchParams.get("video");
      const acc = url.searchParams.get("acc");

      if (!video) return new Response("Error: Missing 'video'", { status: 400 });
      
      // Acc နံပါတ်စစ်ဆေးခြင်း
      if (!acc || !R2_ACCOUNTS[acc]) {
        return new Response("Error: Invalid account number", { status: 400 });
      }

      // 3. Credentials ယူခြင်း
      const creds = R2_ACCOUNTS[acc];
      
      // AwsClient ဆောက်ခြင်း
      const r2 = new AwsClient({
        accessKeyId: creds.accessKeyId,
        secretAccessKey: creds.secretAccessKey,
        service: "s3",
        region: "auto",
      });

      // 4. Presigned URL ထုတ်ခြင်း
      const endpoint = `https://${creds.accountId}.r2.cloudflarestorage.com`;
      const objectUrl = new URL(`${endpoint}/${creds.bucketName}/${video}`);

      const signed = await r2.sign(objectUrl, {
        method: "GET",
        aws: { signQuery: true },
        headers: { "Host": `${creds.accountId}.r2.cloudflarestorage.com` },
        expiresIn: 3600 
      });

      return Response.redirect(signed.url, 307);

    } catch (err: any) {
      return new Response(`Server Error: ${err.message}`, { status: 500 });
    }
  },
};
