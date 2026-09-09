<%@ WebHandler Language="C#" Class="ApiwebHop" %>
/*
  Immoba apiweb hop — a fixed-IP relay for Inmovilla's apiweb, for IIS (.NET Framework 4.6.1+).

  Cloudflare Pages Functions (or any host without a stable egress IP) POST the exact apiweb form body
  here instead of to apiweb.inmovilla.com; this handler forwards it unchanged and returns the answer.
  Inmovilla then only ever sees this server's IP.

  - Requires the shared secret in the X-Hop-Secret header (appSettings/HopSecret in web.config).
  - Caps outgoing calls at MaxPerMinute (default 60; Inmovilla blocks the IP at 70/min).
  - Never logs or stores credentials: the body is streamed through.
  No compilation step: IIS compiles this file on first request with the in-box C# 5 compiler, hence
  HttpWebRequest (System.Net.Http is not referenced by dynamic compilation) and no C# 6+ syntax.
*/
using System;
using System.Collections.Generic;
using System.Configuration;
using System.IO;
using System.Net;
using System.Text;
using System.Threading.Tasks;
using System.Web;

public class ApiwebHop : HttpTaskAsyncHandler
{
    static readonly object Gate = new object();
    static readonly Queue<DateTime> Calls = new Queue<DateTime>();
    static readonly bool TlsReady = SetupTls();

    static bool SetupTls()
    {
        // TLS 1.2 is enough for Inmovilla; TLS 1.3 only exists from .NET Framework 4.8, so it is optional.
        try { ServicePointManager.SecurityProtocol = SecurityProtocolType.Tls12 | (SecurityProtocolType)12288; }
        catch (NotSupportedException) { ServicePointManager.SecurityProtocol = SecurityProtocolType.Tls12; }
        return true;
    }

    static string Setting(string name, string fallback)
    {
        var v = ConfigurationManager.AppSettings[name];
        return string.IsNullOrEmpty(v) ? fallback : v;
    }

    /// Sliding one-minute window; true when a slot is available.
    static bool TakeSlot(int limit)
    {
        lock (Gate)
        {
            var cutoff = DateTime.UtcNow.AddMinutes(-1);
            while (Calls.Count > 0 && Calls.Peek() < cutoff) Calls.Dequeue();
            if (Calls.Count >= limit) return false;
            Calls.Enqueue(DateTime.UtcNow);
            return true;
        }
    }

    public override async Task ProcessRequestAsync(HttpContext context)
    {
        var req = context.Request;
        var res = context.Response;
        res.Cache.SetCacheability(HttpCacheability.NoCache);

        if (req.HttpMethod == "GET")
        {
            res.ContentType = "application/json";
            res.Write("{\"ok\":true,\"hop\":\"apiweb\"}");
            return;
        }
        if (req.HttpMethod != "POST") { res.StatusCode = 405; return; }

        var secret = Setting("HopSecret", "");
        var given = req.Headers["X-Hop-Secret"] ?? "";
        if (secret.Length == 0 || !FixedTimeEquals(secret, given))
        {
            res.StatusCode = 403;
            res.ContentType = "application/json";
            res.Write("{\"error\":\"hop secret missing or wrong\"}");
            return;
        }

        int limit;
        if (!int.TryParse(Setting("MaxPerMinute", "60"), out limit)) limit = 60;
        if (!TakeSlot(limit))
        {
            res.StatusCode = 429;
            res.ContentType = "application/json";
            res.Write("{\"error\":\"apiweb rate cap reached on the hop, retry in a minute\"}");
            return;
        }

        string body;
        using (var reader = new StreamReader(req.InputStream, Encoding.UTF8)) body = await reader.ReadToEndAsync();
        if (body.Length == 0 || body.Length > 64 * 1024) { res.StatusCode = 400; return; }

        var upstream = Setting("ApiwebUrl", "https://apiweb.inmovilla.com/apiweb/apiweb.php");
        var payload = Encoding.UTF8.GetBytes(body);
        try
        {
            var call = (HttpWebRequest)WebRequest.Create(upstream);
            call.Method = "POST";
            call.ContentType = "application/x-www-form-urlencoded";
            call.Accept = "application/json";
            call.UserAgent = "immoba-hop/1.0";
            call.Timeout = 30000;
            call.ReadWriteTimeout = 30000;
            call.ContentLength = payload.Length;
            using (var stream = await call.GetRequestStreamAsync()) await stream.WriteAsync(payload, 0, payload.Length);

            HttpWebResponse answer;
            try
            {
                answer = (HttpWebResponse)await call.GetResponseAsync();
            }
            catch (WebException ex)
            {
                // non-2xx: pass Inmovilla's own answer through; anything else is handled below
                if (!(ex.Response is HttpWebResponse)) throw;
                answer = (HttpWebResponse)ex.Response;
            }
            using (answer)
            using (var upstreamBody = answer.GetResponseStream())
            {
                res.StatusCode = (int)answer.StatusCode;
                res.ContentType = string.IsNullOrEmpty(answer.ContentType) ? "application/json" : answer.ContentType;
                if (upstreamBody != null) await upstreamBody.CopyToAsync(res.OutputStream);
            }
        }
        catch (WebException ex)
        {
            var timeout = ex.Status == WebExceptionStatus.Timeout;
            res.StatusCode = timeout ? 504 : 502;
            res.ContentType = "application/json";
            res.Write(timeout ? "{\"error\":\"Inmovilla no responde\"}" : "{\"error\":\"" + HttpUtility.JavaScriptStringEncode(ex.Message) + "\"}");
        }
    }

    static bool FixedTimeEquals(string a, string b)
    {
        if (a.Length != b.Length) return false;
        int diff = 0;
        for (int i = 0; i < a.Length; i++) diff |= a[i] ^ b[i];
        return diff == 0;
    }

    public override bool IsReusable { get { return true; } }
}
