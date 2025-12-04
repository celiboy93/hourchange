import { AwsClient } from "npm:aws4fetch";

export default {
  async fetch(request: Request): Promise<Response> {
    try {
      const configData = Deno.env.get("ACCOUNTS_JSON");
      if (!configData) return new Response("Config Error", { status: 500 });
      const R2_ACCOUNTS = JSON.parse(configData);

      const url = new URL(request.url);
      const video = url.searchParams.get("video");
      const acc = url.searchParams.get("acc");

      // 🔥 FIX: Cron-job အတွက် Ping စစ်ဆေးခြင်း
      // video=ping လို့လာရင် ဘာမှဆက်မလုပ်ဘဲ 200 OK ပြန်ပေးမယ်
      if (video === "ping") {
        return new Response("Pong! Server is awake 🤖", { status: 200 });
      }

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

      // HEAD Request (APK Size Check)
      if (request.method === "HEAD") {
        const signedHead = await r2.sign(objectUrl, {
          method: "HEAD",
          aws: { signQuery: true },
          headers: headers,
          expiresIn: 3600
        });
        const r2Res = await fetch(signedHead.url, { method: "HEAD" });
        const newHeaders = new Headers(r2Res.headers);
        newHeaders.set("Access-Control-Allow-Origin", "*");
        return new Response(null, { status: 200, headers: newHeaders });
      }

      // GET Request Redirect
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
