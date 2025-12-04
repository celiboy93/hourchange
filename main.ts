import { AwsClient } from "npm:aws4fetch";
export default {
  async fetch(request: Request): Promise<Response> {
    try {
      // 1. Config ယူခြင်း
      const configData = Deno.env.get("ACCOUNTS_JSON");
      if (!configData) return new Response("Config Error", { status: 500 });
      const R2_ACCOUNTS = JSON.parse(configData);

      // 2. URL Params
      const url = new URL(request.url);
      const video = url.searchParams.get("video");
      const acc = url.searchParams.get("acc");

      if (!video || !acc || !R2_ACCOUNTS[acc]) {
        return new Response("Invalid Parameters", { status: 400 });
      }

      const creds = R2_ACCOUNTS[acc];
      const r2 = new AwsClient({
        accessKeyId: creds.accessKeyId,
        secretAccessKey: creds.secretAccessKey,
        service: "s3",
        region: "auto",
      });

      const endpoint = `https://${creds.accountId}.r2.cloudflarestorage.com`;
      const objectUrl = new URL(`${endpoint}/${creds.bucketName}/${video}`);
      const headers = { "Host": `${creds.accountId}.r2.cloudflarestorage.com` };

      // 🔥 SPECIAL FEATURE: FILE SIZE CHECKING (HEAD REQUEST)
      // APK က Size လှမ်းစစ်ရင် ဒီကောင် အလုပ်လုပ်ပါမယ်
      if (request.method === "HEAD") {
        // 1. R2 ကို HEAD request လုပ်ဖို့ Link ထုတ်မယ်
        const signedHead = await r2.sign(objectUrl, {
          method: "HEAD",
          aws: { signQuery: true },
          headers: headers,
          expiresIn: 3600
        });

        // 2. R2 ဆီကနေ Size နဲ့ Name ကို လှမ်းတောင်းမယ်
        const r2Response = await fetch(signedHead.url, { method: "HEAD" });

        // 3. ရလာတဲ့ Header တွေကို APK ဆီ ပြန်ပို့ပေးမယ်
        const newHeaders = new Headers(r2Response.headers);
        
        // CORS (Browser/App ကြားခံပြဿနာမတက်အောင်)
        newHeaders.set("Access-Control-Allow-Origin", "*");
        
        return new Response(null, {
          status: 200,
          headers: newHeaders
        });
      }

      // ⬇️ NORMAL DOWNLOAD (GET REQUEST)
      // ပုံမှန် ဒေါင်းမယ်ဆိုရင်တော့ Redirect လုပ်ပေးလိုက်မယ်
      const signedGet = await r2.sign(objectUrl, {
        method: "GET",
        aws: { signQuery: true },
        headers: headers,
        expiresIn: 3600
      });

      return Response.redirect(signedGet.url, 307);

    } catch (err: any) {
      return new Response(`Error: ${err.message}`, { status: 500 });
    }
  },
};
