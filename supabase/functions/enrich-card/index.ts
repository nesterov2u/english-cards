import { serve } from "https://deno.land/std@0.224.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const { text } = await request.json();
    if (!text || typeof text !== "string") throw new Error("Введите слово или фразу.");
    const contactEmail = Deno.env.get("MYMEMORY_CONTACT_EMAIL");
    const params = new URLSearchParams({ q: text, langpair: "en|ru", mt: "1" });
    if (contactEmail) params.set("de", contactEmail);
    const response = await fetch(`https://api.mymemory.translated.net/get?${params}`);
    if (!response.ok) throw new Error("Сервис перевода временно недоступен.");
    const data = await response.json();
    const translation = data.responseData?.translatedText;
    if (!translation) throw new Error("Не удалось подобрать перевод.");
    return Response.json({ translation }, { headers: corsHeaders });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 400, headers: corsHeaders });
  }
});
