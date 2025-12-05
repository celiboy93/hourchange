import { AwsClient } from "npm:aws4fetch";

export default {
  async fetch(request: Request): Promise<Response> {
    try {
      const configData = Deno.env.get("ACCOUNTS_JSON");
      if (!configData) return new Response("Config Error: Missing ACCOUNTS_JSON", { status: 500 });
      
      const R2_ACCOUNTS = JSON.parse(configData);
      const url = new URL(request.url);
      
      // ---------------------------------------------------------
      // 🔍 URL Parsing Logic (Query vs Path)
      // ---------------------------------------------------------
      let video = url.searchParams.get("video");
      let acc = url.searchParams.get("acc");

      // အကယ်၍ ?video= မပါရင် Path (/1/folder/file.m3u8) ကနေ ရှာမယ်
      if (!video || !acc) {
        // Path ဥပမာ: /3/hls/movie/master.m3u8
        // parts[0]="" , parts[1]="3", parts[2+]="path..."
        const parts = url.pathname.split('/');
        if (parts.length >= 3) {
            acc = parts[1]; // ပထမအကွက်က Account နံပါတ်
            // ကျန်တာအကုန်ပြန်ပေါင်းမယ် (Decode လုပ်ပေးရမယ်)
            video = decodeURIComponent(parts.slice(2).join('/')); 
        }
      } else {
          // Query param သုံးရင်လည်း decode လုပ်မယ်
          video = decodeURIComponent(video);
      }

      // Ping check
      if (video === "ping") return new Response("Pong!", { status: 200 });

      if (!video || !acc || !R2_ACCOUNTS[acc]) {
        return new Response("Invalid Parameters or Path Format: use /acc/video_path", { status: 400 });
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
      const objectPath = video;

      // =========================================================
      // 🎥 M3U8 HANDLING (Dynamic Rewriter)
      // =========================================================
      if (objectPath.endsWith(".m3u8")) {
        // Path Encoding for R2
        const encodedPath = objectPath.split('/').map(encodeURIComponent).join('/');
        const m3u8Url = new URL(`${endpoint}/${bucket}/${encodedPath}`);
        
        const signedM3u8 = await r2.sign(m3u8Url, {
          method: "GET",
          aws: { signQuery: true },
          headers: { "Host": `${creds.accountId}.r2.cloudflarestorage.com` },
          expiresIn: 3600
        });

        const response = await fetch(signedM3u8.url);
        if (!response.ok) return new Response("M3U8 Not Found on R2", { status: 404 });
        
        const originalText = await response.text();
        
        // Base Directory for TS files
        const lastSlashIndex = objectPath.lastIndexOf("/");
        const baseDir = lastSlashIndex !== -1 ? objectPath.substring(0, lastSlashIndex + 1) : "";

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
              expiresIn: 14400 
            });
            
            return signedTs.url;
          }
          return line;
        }));

        return new Response(newLines.join("\n"), {
          headers: {
            "Content-Type": "application/vnd.apple.mpegurl", // APK အတွက် အရေးကြီးသည်
            "Access-Control-Allow-Origin": "*",
            "Cache-Control": "no-cache"
          }
        });
      }

      // =========================================================
      // 📦 MP4 HANDLING
      // =========================================================
      const cleanFileName = objectPath.split('/').pop();
      const encodedFileName = encodeURIComponent(cleanFileName);
      const contentDisposition = `attachment; filename="${cleanFileName}"; filename*=UTF-8''${encodedFileName}`;
      
      const encodedPath = objectPath.split('/').map(encodeURIComponent).join('/');
      const objectUrl = new URL(`${endpoint}/${bucket}/${encodedPath}`);
      const hostHeader = { "Host": `${creds.accountId}.r2.cloudflarestorage.com` };
      
      objectUrl.searchParams.set("response-content-disposition", contentDisposition);

      if (request.method === "HEAD") {
        const signedHead = await r2.sign(objectUrl, {
          method: "HEAD",
          aws: { signQuery: true },
          headers: hostHeader,
          expiresIn: 3600
        });
        const r2Response = await fetch(signedHead.url, { method: "HEAD" });
        const newHeaders = new Headers(r2Response.headers);
        newHeaders.set("Access-Control-Allow-Origin", "*");
        newHeaders.set("Access-Control-Expose-Headers", "*"); 
        return new Response(null, { status: 200, headers: newHeaders });
      }

      const signedGet = await r2.sign(objectUrl, {
        method: "GET",
        aws: { signQuery: true },
        headers: hostHeader,
        expiresIn: 14400 
      });

      return Response.redirect(signedGet.url, 302);

    } catch (err: any) {
      return new Response(`Error: ${err.message}`, { status: 500 });
    }
  },
};
