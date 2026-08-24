// apps/api/src/plugins/security.ts
//
// Bündelt die sicherheitsrelevanten Fastify-Plugins aus Abschnitt 9 des
// Backend-Entwicklungsplans (CORS, Security-Header, Rate-Limiting).
import type { FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import type { Env } from '../config/env.js';

// CORS_ORIGIN trägt bislang IMMER genau eine Origin, obwohl die
// Fehlermeldung von loadEnv() (siehe env.ts) bereits von "Origin(s)"
// spricht — @fastify/cors erhielt den rohen String unverändert, was bei
// mehreren, kommagetrennt eingetragenen Origins (z. B. Produktions- und
// Staging-Frontend desselben Vereins) NICHTS davon tatsächlich matchte, da
// @fastify/cors einen einzelnen String als exakten Vergleichswert
// behandelt, nicht als Liste. "*" bleibt bewusst ein Sonderfall: als
// rohe Zeichenkette an @fastify/cors weitergereicht aktiviert sie dessen
// eingebaute Wildcard-Behandlung (Access-Control-Allow-Origin: *); ein
// Array, das nur den String "*" enthält, würde @fastify/cors dagegen als
// (nie zutreffenden) exakten Origin-Vergleichswert behandeln, nicht als
// Wildcard — dieser Sonderfall wird daher vor dem Aufteilen abgefangen.
export function parseCorsOrigin(raw: string): string | string[] {
  const trimmed = raw.trim();
  if (trimmed === '*') return '*';
  return trimmed
    .split(',')
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0);
}

export async function registerSecurityPlugins(app: FastifyInstance, env: Env) {
  await app.register(helmet, {
    // Explizite CSP statt Helmets Default-Policy (siehe Sicherheitsreview,
    // Punkt 4). Diese API liefert ausschließlich JSON aus — es gibt
    // keinen legitimen Grund für Skripte, Styles oder eingebettete Frames
    // von irgendeiner Quelle, auch nicht "self". Die Policy ist bewusst
    // maximal restriktiv (Default-Deny), nicht auf das Frontend
    // zugeschnitten: apps/web wird separat ausgeliefert (eigener
    // Webserver/Hosting, siehe docs/backend-plan.md) und bekommt seine
    // eigene, für sein Markup passende CSP von dort — nicht von dieser
    // API. Diese Policy schützt lediglich diese API-Antworten selbst
    // (z. B. falls durch einen Fehlerfall doch einmal HTML statt JSON
    // ausgeliefert würde) als zusätzliche Verteidigungsschicht.
    contentSecurityPolicy: {
      // useDefaults: false ist entscheidend — sonst mischt Helmet seine
      // eigenen Standard-Direktiven (u. a. "script-src-attr" und
      // "upgrade-insecure-requests") IMMER dazu, unabhängig davon, was
      // hier angegeben wird. Nur mit useDefaults: false gilt exakt die
      // unten definierte, vollständig explizite Policy.
      useDefaults: false,
      directives: {
        defaultSrc: ["'none'"],
        scriptSrc: ["'none'"],
        styleSrc: ["'none'"],
        imgSrc: ["'none'"],
        connectSrc: ["'none'"],
        fontSrc: ["'none'"],
        objectSrc: ["'none'"],
        frameAncestors: ["'none'"],
        formAction: ["'none'"],
        baseUri: ["'none'"],
        // Erzwingt HTTPS für alle Subressourcen — nur in Produktion
        // gesetzt; die Direktive nimmt keine Werte (leeres Array =
        // "aktiviert"), in development/test wird der Schlüssel schlicht
        // weggelassen statt sie mit einem ungültigen Wert zu belegen.
        ...(env.NODE_ENV === 'production' ? { upgradeInsecureRequests: [] } : {}),
      },
    },
    // Nur relevant, falls die API jemals in ein <iframe> eingebettet würde
    // — nicht vorgesehen, daher zusätzlich zu frame-ancestors auch per
    // X-Frame-Options abgesichert (Helmets Default "sameorigin" ist hier
    // sogar noch zu großzügig).
    frameguard: { action: 'deny' },
  });
  await app.register(cors, {
    origin: parseCorsOrigin(env.CORS_ORIGIN),
    credentials: true,
  });
  await app.register(rateLimit, {
    max: 100,
    timeWindow: '1 minute',
  });
}
