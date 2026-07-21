// apps/api/src/plugins/security.ts
//
// Bündelt die sicherheitsrelevanten Fastify-Plugins aus Abschnitt 9 des
// Backend-Entwicklungsplans (CORS, Security-Header, Rate-Limiting).
import type { FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import type { Env } from '../config/env.js';

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
    origin: env.CORS_ORIGIN,
    credentials: true,
  });
  await app.register(rateLimit, {
    max: 100,
    timeWindow: '1 minute',
  });
}
