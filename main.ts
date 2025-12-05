import { AwsClient } from "npm:aws4fetch";

export default {
  async fetch(request: Request): Promise<Response> {
    try {
      // 1. Config ယူခြင်း
      const configData = Deno.env.get("ACCOUNTS_JSON");
      if (!configData) return new Response("Config Error: Missing ACCOUNTS_JSON", { status: 500 });
      
      const R2_ACCOUNTS = JSON.parse(configData);
      const url = new URL(request.url);
      const video = url.searchParams.get("video");
      const acc = url.searchParams.get("acc");

      // Ping check (Cron-job အတွက်)
      if (video === "ping") return new Response("Pong!", { status: 200 });

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
      const bucket = creds.bucketName;
      
      // Path ပြင်ဆင်ခြင်း
      const objectPath = decodeURIComponent(video);

      // =========================================================
      // 🎥 PART A: M3U8 HANDLING (Dynamic Rewriter)
      // =========================================================
      if (objectPath.endsWith(".m3u8")) {
        // Path Encoding
        const encodedPath = objectPath.split('/').map(encodeURIComponent).join('/');
        const m3u8Url = new URL(`${endpoint}/${bucket}/${encodedPath}`);
        
        const signedM3u8 = await r2.sign(m3u8Url, {
          method: "GET",
          aws: { signQuery: true },
          headers: { "Host": `${creds.accountId}.r2.cloudflarestorage.com` },
          expiresIn: 3600
        });

        const response = await fetch(signedM3u8.url);
        if (!response.ok) return new Response("M3U8 Not Found", { status: 404 });
        
        const originalText = await response.text();
        
        // Base Directory
        const lastSlashIndex = objectPath.lastIndexOf("/");
        const baseDir = lastSlashIndex !== -1 ? objectPath.substring(0, lastSlashIndex + 1) : "";

        // Rewrite Lines
        const lines = originalText.split("\n");
        const newLines = await Promise.all(lines.map(async (line) => {
          const trimmed = line.trim();
          
          if (trimmed && !trimmed.startsWith("#") && (trimmed.endsWith(".ts") || trimmed.endsWith(".m4s") || trimmed.endsWith(".mp4"))) {
            let fullPath = trimmed;
            if (!trimmed.startsWith("http")) {
                fullPath = baseDir + trimmed;
            }
            
            const encodedFullPath = fullPath.split('/').map(encodeURIComponent).join('/');
            const tsUrl = new URL(`${endpoint}/${bucket}/${encodedFullPath}`);
            
            const signedTs = await r2.sign(tsUrl, {
              method: "GET",
              aws: { signQuery: true },
              headers: { "Host": `${creds.accountId}.r2.cloudflarestorage.com` },
              expiresIn: 14400 // 4 Hours Expiry
            });
            
            return signedTs.url;
          }
          return line;
        }));

        return new Response(newLines.join("\n"), {
          headers: {
            "Content-Type": "application/vnd.apple.mpegurl",
            "Access-Control-Allow-Origin": "*",
            "Cache-Control": "no-cache"
          }
        });
      }

      // =========================================================
      // 📦 PART B: MP4 HANDLING (Download & Size Fix)
      // =========================================================
      const cleanFileName = objectPath.split('/').pop();
      const encodedFileName = encodeURIComponent(cleanFileName);
      const contentDisposition = `attachment; filename="${cleanFileName}"; filename*=UTF-8''${encodedFileName}`;
      
      const encodedPath = objectPath.split('/').map(encodeURIComponent).join('/');
      const objectUrl = new URL(`${endpoint}/${bucket}/${encodedPath}`);
      const hostHeader = { "Host": `${creds.accountId}.r2.cloudflarestorage.com` };
      
      // Force Download Name
      objectUrl.searchParams.set("response-content-disposition", contentDisposition);

      // Sign URL
      const signedUrl = await r2.sign(objectUrl, {
        method: 'GET',
        aws: { signQuery: true },
        headers: hostHeader,
        expiresIn: 14400 // 4 Hours
      });

      // 🔥 HEAD Request Logic (APK Size Fix)
      if (request.method === "HEAD") {
        try {
          const r2Response = await fetch(signedUrl.url, { method: "HEAD" });
          if (r2Response.ok) {
            const newHeaders = new Headers();
            newHeaders.set("Access-Control-Allow-Origin", "*");
            newHeaders.set("Access-Control-Allow-Methods", "GET, HEAD, OPTIONS");
            newHeaders.set("Access-Control-Expose-Headers", "Content-Length, Content-Type, Content-Disposition, Accept-Ranges, ETag");

            if (r2Response.headers.has("Content-Length")) {
              newHeaders.set("Content-Length", r2Response.headers.get("Content-Length"));
            }
            newHeaders.set("Content-Type", r2Response.headers.get("Content-Type") || "video/mp4");
            newHeaders.set("Content-Disposition", contentDisposition);
            newHeaders.set("Accept-Ranges", "bytes");

            return new Response(null, { status: 200, headers: newHeaders });
          }
        } catch (e) {}
        return Response.redirect(signedUrl.url, 302);
      }

      // ⬇️ GET Request (Redirect)
      return Response.redirect(signedUrl.url, 302);

    } catch (err: any) {
      return new Response(`Error: ${err.message}`, { status: 500 });
    }
  },
};
