// Zweite Hälfte des DSGVO-Löschprozesses (Art. 17): während
// modules/profile/profile.repository.ts die SOFORTIGE Reaktion auf eine
// Löschanfrage übernimmt (Soft-Delete + DataDeletionRequest anlegen),
// kümmert sich dieses Gateway um den zeitversetzten, UNWIDERRUFLICHEN
// Hard-Purge, sobald die Aufbewahrungsfrist (purgeAfter) abgelaufen ist —
// ausgeführt über scripts/purgeDeletedData.ts (per Cron) und
// orchestriert von jobs/purgeExpiredDeletions.ts.
import type { PrismaClient, Prisma } from '@prisma/client';
import { anonymizePlanCommentAuthors, anonymizeExerciseCommentAuthors, anonymizeTemplateCommentAuthors } from './commentAnonymization.js';

// Platzhalter, auf den `Invitation.email` beim Hard-Purge gesetzt wird
// (purgeUserAndDependents() unten); Gegenstück zu ANONYMIZED_COMMENT_AUTHOR
// in commentAnonymization.ts. `.invalid` ist die von RFC 2606 für diesen
// Zweck reservierte TLD — anders als "example.org" (im Projekt bereits als
// Test-Fixture-Domain in Gebrauch) ist damit auf einen Blick klar, dass der
// Wert absichtlich unzustellbar ist. Auch vom InMemory-Testdouble genutzt,
// damit beide Implementierungen denselben Platzhalter schreiben.
export const ANONYMIZED_INVITATION_EMAIL = 'geloeschtes-konto@geloescht.invalid';

export interface DueErasureRequest {
  id: string;
  userId: string;
}

export interface ErasureJobGateway {
  findDuePendingRequests(now: Date): Promise<DueErasureRequest[]>;
  // Löscht UNWIDERRUFLICH: RefreshTokens, (falls verknüpft) Athlet:innen-
  // Profil inkl. Ergebnisse/Startlisteneinträge/Handlungsfelder, entfernt
  // die Anwesenheits-Einträge dieser Person aus allen Trainingseinheiten
  // des Vereins, löscht zuletzt den User-Datensatz selbst (was per
  // onDelete: Cascade auch den DataDeletionRequest-Datensatz entfernt).
  purgeUserAndDependents(userId: string): Promise<void>;
}

export class PrismaErasureJobGateway implements ErasureJobGateway {
  constructor(private readonly prisma: PrismaClient) {}

  // Kein `status`-Filter: jede noch EXISTIERENDE DataDeletionRequest-Zeile
  // ist implizit "pending" — eine abgearbeitete verschwindet mit dem
  // gepurgten User per onDelete: Cascade (schema.prisma).
  async findDuePendingRequests(now: Date): Promise<DueErasureRequest[]> {
    const rows = await this.prisma.dataDeletionRequest.findMany({
      where: { purgeAfter: { lte: now } },
      select: { id: true, userId: true },
    });
    return rows;
  }

  async purgeUserAndDependents(userId: string): Promise<void> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) return; // bereits gelöscht (z. B. durch einen vorherigen, abgebrochenen Lauf)

    // `timeout`/`maxWait` über Prismas Standardwerte (5 s bzw. 2 s) hinaus
    // angehoben — Sicherheitsmarge zusätzlich zum einzelnen UPDATE-Statement
    // unten, rein defensiv für einen selten laufenden Hintergrund-Job ohne
    // Nutzer:innen-Wartezeit-Anforderung. `maxWait` deckt die Wartezeit auf
    // einen freien Connection-Pool-Slot ab (relevant, wenn der Cron-Lauf
    // mehrere fällige Löschanfragen nacheinander abarbeitet), `timeout` die
    // eigentliche Transaktionslaufzeit.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await this.prisma.$transaction(async (tx: any) => {
      await tx.refreshToken.deleteMany({ where: { userId } });

      if (user.athleteId) {
        const [results, entries, actionItems] = await Promise.all([
          tx.result.findMany({ where: { athleteId: user.athleteId }, select: { id: true } }),
          tx.startlistEntry.findMany({ where: { athleteId: user.athleteId }, select: { id: true } }),
          tx.actionItem.findMany({ where: { athleteId: user.athleteId }, select: { id: true } }),
        ]);

        // Verbesserung "Tombstones": bevor die Zeilen unwiderruflich
        // gelöscht werden, je eine schlanke Löschmarkierung (nur id +
        // Zeitpunkt, keine Personendaten) anlegen. So kann die Sync-API
        // (siehe sync.gateway.ts: listChangedSince()) die Löschung auch
        // Geräten melden, die die gesamte Aufbewahrungsfrist verpasst
        // haben und sonst nie ein "delete"-Signal für diese Zeilen
        // bekommen hätten (die Zeile ist ja physisch weg).
        const now = new Date();
        const tombstones = [
          ...results.map((r: { id: string }) => ({ clubId: user.clubId!, store: 'results', entityId: r.id, deletedAt: now })),
          ...entries.map((e: { id: string }) => ({ clubId: user.clubId!, store: 'entries', entityId: e.id, deletedAt: now })),
          ...actionItems.map((a: { id: string }) => ({ clubId: user.clubId!, store: 'actionItems', entityId: a.id, deletedAt: now })),
          { clubId: user.clubId!, store: 'athletes', entityId: user.athleteId, deletedAt: now },
        ];
        await tx.syncTombstone.createMany({ data: tombstones, skipDuplicates: true });

        await tx.result.deleteMany({ where: { athleteId: user.athleteId } });
        await tx.startlistEntry.deleteMany({ where: { athleteId: user.athleteId } });
        await tx.actionItem.deleteMany({ where: { athleteId: user.athleteId } });

        // Anwesenheits-Einträge sind Teil eines JSON-Arrays je
        // Trainingseinheit (kein eigenes Tabellen-Feld), daher kein
        // schlichtes `deleteMany`/`updateMany` mit einer Feld-Bedingung.
        //
        // EIN einzelnes SQL-UPDATE, das per JSONB-Containment (`@>`) nur die
        // Zeilen trifft, die den Eintrag dieser Person enthalten — alle
        // anderen Einheiten des Vereins werden weder gelesen noch
        // geschrieben. Der naheliegende Weg (alle Einheiten laden, in JS
        // filtern, zurückschreiben) treibt bei einem Verein mit mehrjähriger
        // Historie die Laufzeit dieser interaktiven Transaktion über Prismas
        // 5-Sekunden-Timeout; da eine fehlgeschlagene Transaktion die
        // Löschanfrage "pending" belässt, könnte ein zu großer Verein dann
        // NIE erfolgreich purgen, obwohl ein Löschdatum zugesagt ist.
        //
        // `elem->>'athleteId' IS DISTINCT FROM`
        // statt `!=` behandelt einen (im Schema nicht vorgesehenen, aber
        // defensiv abgedeckten) fehlenden `athleteId`-Schlüssel NULL-sicher.
        // `COALESCE(..., '[]'::jsonb)`: entfernt das Filtern den EINZIGEN
        // Eintrag einer Zeile, liefert `jsonb_agg` über eine leere
        // Ergebnismenge `NULL` statt eines leeren Arrays — ohne COALESCE
        // würde die Spalte fälschlich auf SQL NULL gesetzt, obwohl
        // `attendance` laut Schema stets ein (ggf. leeres) Array ist.
        // `"updatedAt" = now()` von Hand gesetzt, weil ein rohes SQL-UPDATE
        // (anders als Prismas eigene update()-Methoden) das `@updatedAt`-
        // Verhalten aus schema.prisma NICHT automatisch auslöst — ohne
        // diese Zeile bliebe der Sync-Pull-Cursor (sync.gateway.ts:
        // listChangedSince() sortiert/filtert exakt nach diesem Feld) auf
        // dem alten Stand, und Geräte, die die Einheit bereits vor dem
        // Purge gepullt hatten, bekämen die bereinigte Fassung nie
        // zugestellt — die gelöschte Person bliebe für sie sichtbar.
        if (user.clubId) {
          await tx.$executeRaw`
            UPDATE "sessions"
            SET
              "attendance" = COALESCE(
                (
                  SELECT jsonb_agg(elem)
                  FROM jsonb_array_elements("attendance") AS elem
                  WHERE elem->>'athleteId' IS DISTINCT FROM ${user.athleteId}
                ),
                '[]'::jsonb
              ),
              "updatedAt" = now()
            WHERE "clubId" = ${user.clubId}
              AND "attendance" @> ${JSON.stringify([{ athleteId: user.athleteId }])}::jsonb
          `;
        }

        await tx.athlete.delete({ where: { id: user.athleteId } });
      }

      // Comment.authorName ist ein freier, beim Anlegen aus dem eingeloggten
      // Konto übernommener Klarname — eingebettet in "plans.comments",
      // "exercises.comments", "plans.days[].sets[].comments" und
      // "templates.sets[].comments" (Struktur siehe commentAnonymization.ts).
      // Bewusst NICHT an `user.athleteId` gekoppelt: Kommentare stammen auch
      // von Trainer:innen/Admins ohne athleteId, deren Klarnamen ein
      // athletengebundener Filter unangetastet ließe. Gescoped auf
      // `user.clubId`, damit ein Konto ohne Verein keinen club-weiten Scan
      // auslöst.
      //
      // Abgeglichen wird über `authorId`, nicht über den frei wählbaren
      // `authorName`: die serverseitig durchgesetzte User-ID (siehe
      // sync.commentAuthorship.ts) hält auch bei Namensgleichheit,
      // Umbenennung oder absichtlich abweichendem Namen.
      //
      // Wie bei der Anwesenheits-Bereinigung oben: erst per
      // gezielter SQL-Bedingung nur die TATSÄCHLICH betroffenen Zeilen
      // laden (Containment `@>` für die flache oberste Ebene,
      // `jsonb_path_exists(..., '$.**.comments[*] ? (...)')` für die
      // beliebig tief verschachtelten Sets/Blöcke — der `..`-Operator
      // durchsucht dafür rekursiv JEDE Tiefe, unabhängig von der
      // Block-/Set-Verschachtelung), statt alle Pläne/Übungen/Vorlagen des
      // Vereins zu laden und in JS zu filtern.
      if (user.clubId) {
        // Die SQL-Bedingungen unten sind bewusst ETWAS breiter als die
        // eigentliche Trefferregel: sie holen zusätzlich Zeilen, die den
        // NAMEN der Person tragen (Altbestand ohne `authorId`, siehe
        // commentAnonymization.ts). Welche Kommentare tatsächlich
        // anonymisiert werden, entscheidet allein die dortige Funktion —
        // eine zu viel geladene Zeile ergibt schlicht `changed: false`
        // und wird nicht geschrieben — deshalb wird hier gefiltert statt
        // exakt selektiert.
        const author = { id: user.id, name: user.name };
        const authorIdContainment = JSON.stringify([{ authorId: user.id }]);
        const authorNameContainment = JSON.stringify([{ authorName: user.name }]);
        const pathVars = JSON.stringify({ id: user.id, name: user.name });

        const affectedPlans = await tx.$queryRaw<Array<{ id: string; comments: unknown; days: unknown }>>`
          SELECT id, comments, days FROM "plans"
          WHERE "clubId" = ${user.clubId}
            AND (
              comments @> ${authorIdContainment}::jsonb
              OR comments @> ${authorNameContainment}::jsonb
              OR jsonb_path_exists(days, '$.**.comments[*] ? (@.authorId == $id || @.authorName == $name)', ${pathVars}::jsonb)
            )
        `;
        for (const row of affectedPlans) {
          const { changed, comments, days } = anonymizePlanCommentAuthors(row, author);
          if (changed) {
            await tx.plan.update({
              where: { id: row.id },
              data: { comments: comments as Prisma.InputJsonValue, days: days as Prisma.InputJsonValue },
            });
          }
        }

        const affectedExercises = await tx.$queryRaw<Array<{ id: string; comments: unknown }>>`
          SELECT id, comments FROM "exercises"
          WHERE "clubId" = ${user.clubId}
            AND (
              comments @> ${authorIdContainment}::jsonb
              OR comments @> ${authorNameContainment}::jsonb
            )
        `;
        for (const row of affectedExercises) {
          const { changed, comments } = anonymizeExerciseCommentAuthors(row, author);
          if (changed) {
            await tx.exercise.update({ where: { id: row.id }, data: { comments: comments as Prisma.InputJsonValue } });
          }
        }

        const affectedTemplates = await tx.$queryRaw<Array<{ id: string; sets: unknown }>>`
          SELECT id, sets FROM "templates"
          WHERE "clubId" = ${user.clubId}
            AND jsonb_path_exists(sets, '$.**.comments[*] ? (@.authorId == $id || @.authorName == $name)', ${pathVars}::jsonb)
        `;
        for (const row of affectedTemplates) {
          const { changed, sets } = anonymizeTemplateCommentAuthors(row, author);
          if (changed) {
            await tx.template.update({ where: { id: row.id }, data: { sets: sets as Prisma.InputJsonValue } });
          }
        }
      }

      // Ohne diesen Schritt überlebte die E-Mail-Adresse der gelöschten
      // Person in JEDER je AN sie ausgestellten Einladung (angenommen,
      // abgelaufen oder widerrufen) dauerhaft in der Datenbank und bliebe
      // über GET /api/invitations für admin/superadmin einsehbar. Anders als
      // bei Comment.authorName gibt es hier keine Unschärfe: `email` ist
      // selbst der Abgleichswert, ein Treffer betrifft garantiert nur
      // Einladungen an genau diese Person.
      //
      // Bewusst NICHT auf `user.clubId` gescoped (anders als die
      // Kommentar-Anonymisierung oben) — dieselbe E-Mail-Adresse kann
      // über mehrere Vereine hinweg eingeladen worden sein (z. B. eine
      // widerrufene Admin-Einladung, bevor die eigentliche
      // Vereinszuordnung feststand); personenbezogene Daten sind nicht
      // auf einen einzelnen Verein beschränkt.
      //
      // `Invitation.invitedById` (Einladungen, die diese Person selbst
      // AUSGESTELLT hat) bleibt bewusst unverändert — das ist eine andere
      // Beziehung ("von", nicht "an" diese Person) und bereits als
      // gewollter historischer Datensatz behandelt (schema.prisma:
      // onDelete: SetNull statt Cascade).
      //
      // `athleteId` wird auf den betroffenen Zeilen zusätzlich auf `null`
      // gesetzt: die konkrete Athletenprofil-Verknüpfung ist nach der
      // Anonymisierung der Zeile keine sinnvoll erhaltenswerte
      // Information mehr — das referenzierte Profil (sofern es
      // `user.athleteId` war) wurde im selben Zug oben bereits hart
      // gelöscht. `Invitation.athleteId` trägt keine Fremdschlüssel-
      // Beziehung im Schema (bewusst, siehe dortiger Kommentar), ein
      // dangling Wert wäre also nicht durch einen DB-Constraint
      // ausgeschlossen — Nullen schließt die Lücke aktiv.
      await tx.invitation.updateMany({
        where: { email: user.email },
        data: { email: ANONYMIZED_INVITATION_EMAIL, athleteId: null },
      });

      // Löscht in derselben Transaktion auch den zugehörigen
      // DataDeletionRequest-Datensatz (onDelete: Cascade im Schema).
      await tx.user.delete({ where: { id: userId } });
    }, { timeout: 30_000, maxWait: 10_000 });
  }
}
