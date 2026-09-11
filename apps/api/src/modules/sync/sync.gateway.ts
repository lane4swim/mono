// Abstraktionsschicht zwischen sync.service.ts und der Datenhaltung.
// Anders als bei auth/invitations (ein Repository-Interface je Entität)
// braucht die generische Sync-API GENAU EINE Schnittstelle, die über alle
// zehn fachlichen Stores hinweg funktioniert — sie nutzt dafür
// db/entityRegistry.ts (SyncStore -> Prisma-Delegate), das in Phase 2
// bereits für genau diesen Zweck vorbereitet wurde.
import type { PrismaClient } from '@prisma/client';
import type { EntityStoreName } from '@lane1/shared-types';
import { getEntityDelegate } from '../../db/entityRegistry.js';

export interface SyncRecord {
  id: string;
  clubId: string;
  updatedAt: Date;
  deletedAt: Date | null;
  [key: string]: unknown;
}

export interface ChangedRecord {
  store: EntityStoreName;
  entityId: string;
  action: 'create' | 'update' | 'delete';
  payload: Record<string, unknown> | null;
  updatedAt: Date;
}

// Schlanke Löschmarkierung (siehe schema.prisma: SyncTombstone) — nur id +
// Zeitpunkt, keine Personendaten. Wird vom Purge-Job (siehe
// jobs/erasure.repository.ts) angelegt, bevor eine Zeile unwiderruflich
// gelöscht wird, damit listChangedSince() die Löschung auch dann noch
// melden kann, wenn ein Client die gesamte Aufbewahrungsfrist verpasst hat
// (die eigentliche Zeile existiert dann ja physisch nicht mehr).
export interface TombstoneRecord {
  clubId: string;
  store: EntityStoreName;
  entityId: string;
  deletedAt: Date;
}

// push() (sync.service.ts) ruft für den eigentlichen Schreibvorgang
// applyAndMarkProcessed() unten auf, das die Datenänderung UND den
// Idempotenz-Vermerk atomar in EINER Transaktion zusammenfasst. Als
// diskriminierte Union statt dreier getrennter Methoden, damit die
// Prisma-Implementierung sie in EINER gemeinsamen $transaction()-Closure
// anhand von `operation.kind` unterscheiden kann, ohne drei separate
// Transaktions-Wrapper zu brauchen.
export type SyncWriteOperation =
  | { kind: 'create'; store: EntityStoreName; payload: Record<string, unknown> }
  | { kind: 'update'; store: EntityStoreName; id: string; clubId: string; payload: Record<string, unknown> }
  | { kind: 'softDelete'; store: EntityStoreName; id: string; clubId: string };

// 'applied': DIESER Aufruf hat die Datenänderung und den Ledger-Eintrag
// geschrieben. 'already-processed': ein GLEICHZEITIGER Aufruf mit
// demselben Event (z. B. ein Client-Retry nach einem Verbindungsabbruch,
// dessen vorherige — serverseitig bereits erfolgreiche — Antwort nie
// ankam) hat den Ledger-Eintrag zuerst geschrieben; die Datenänderung
// dieses Aufrufs wurde dadurch gar nicht erst versucht. Der Aufrufer
// (sync.service.ts: push()) behandelt Letzteres identisch zum
// vorgelagerten isEventProcessed()-Fast-Path: als "applied" ohne
// serverVersion.
export type ApplyOutcome = 'applied' | 'already-processed';

export interface SyncGateway {
  // `clubId` ist optional, damit interne/administrative Aufrufe (z. B.
  // Tests, die den rohen Serverstand unabhängig vom anfragenden Verein
  // prüfen wollen) weiterhin ungescoped nachsehen können. sync.service.ts
  // MUSS jedoch beim Verarbeiten eines eingehenden Events IMMER die
  // requester.clubId mitgeben — sonst könnte ein Datensatz eines fremden
  // Vereins gefunden und über den Umweg des Konfliktergebnisses ausgelesen
  // werden.
  findById(store: EntityStoreName, id: string, clubId?: string): Promise<SyncRecord | null>;
  // Mengen-Variante von findById() für die reine EXISTENZ-Prüfung mehrerer
  // Fremdschlüssel-Referenzen desselben Stores (sync.foreignKeys.ts). Je
  // Referenz einzeln zu fragen bedeutete serielle Roundtrips — bei einem
  // Trainingsplan mit vielen verschachtelten exerciseId-Verweisen Dutzende,
  // jeder mit der vollständigen Zeile samt großer JSON-Spalten, obwohl nur
  // "existiert im eigenen Verein?" gefragt ist.
  //
  // Liefert die Teilmenge von `ids`, die TATSÄCHLICH zu `clubId` gehört
  // — clubId ist hier PFLICHT (nicht optional wie bei findById): diese
  // Methode existiert ausschließlich für die Eigentümerprüfung, ein
  // ungescopter Aufruf hätte dort keinen legitimen Anwendungsfall und
  // würde die Prüfung stillschweigend wirkungslos machen. Eine id, die
  // gar nicht existiert, und eine id aus einem FREMDEN Verein sind im
  // Ergebnis ununterscheidbar (beide fehlen schlicht) — dasselbe
  // Existenz-Orakel-Verhalten wie beim club-gescopten findById().
  findExistingIdsInClub(store: EntityStoreName, ids: readonly string[], clubId: string): Promise<Set<string>>;
  // Batch-Variante von findById() für die "existing"-Ermittlung in push().
  // Anders als findExistingIdsInClub()
  // (reine Existenzmenge, genügt für die Fremdschlüsselprüfung) liefert
  // diese Methode die VOLLSTÄNDIGEN Datensätze, die push() für die
  // Konfliktentscheidung (resolveConflict() braucht updatedAt), die
  // Eigentümerprüfung von "results" (athleteId) und die
  // Kommentar-Autor:innenschaft (sync.commentAuthorship.ts) benötigt.
  // clubId ist PFLICHT, aus demselben Grund wie bei findExistingIdsInClub().
  findManyByIdsInClub(store: EntityStoreName, ids: readonly string[], clubId: string): Promise<Map<string, SyncRecord>>;
  // Batch-Variante von isEventProcessed() für push()s Idempotenz-Vorabprüfung
  // — liefert die Teilmenge von `eventIds`,
  // die für `clubId` BEREITS verarbeitet wurde. isEventProcessed() bleibt
  // daneben unverändert bestehen (siehe dessen Kommentar unten — u. a.
  // intern von applyAndMarkProcessed() genutzt).
  findProcessedEventIds(eventIds: readonly string[], clubId: string): Promise<Set<string>>;
  // Änderungen eines Vereins seit einem Zeitpunkt, absteigend nach
  // updatedAt limitiert (Pagination via `limit`). `stores` grenzt bereits
  // die Watermark-Abfragen selbst
  // auf die für die anfragende Rolle/das gebuchte Modul-Set lesbaren
  // Stores ein (siehe sync.service.ts: pull(), canRead()) — PFLICHT statt
  // optional, damit kein Aufrufer versehentlich alle zehn Stores abfragt,
  // ohne das bewusst zu entscheiden. Ersetzt NICHT die anwendungsseitige
  // Rechteprüfung in pull() (`changes.filter(canRead)`), die unverändert
  // bestehen bleibt — reine zusätzliche Verengung der Abfrage selbst.
  listChangedSince(clubId: string, since: Date | null, limit: number, stores: readonly EntityStoreName[]): Promise<ChangedRecord[]>;
  // clubId-gescoped: eine Event-id ist zwar client-generiert und praktisch
  // garantiert global eindeutig (UUID), ein Abgleich ohne clubId würde
  // aber ein fremdes Event-ID-Ratespiel konsequenzlos mit "applied"
  // beantworten (siehe push()' Idempotenz-Kommentar) statt mit dem
  // eigentlichen Ergebnis (i. d. R. "nicht gefunden"/regulärer Ablauf) —
  // harmlos (keine Wirkung, kein Zugriff auf fremde Daten), aber
  // inkonsistent mit dem sonst überall konsequenten Vereins-Scoping dieses
  // Gateways. Anders als create()/update()/softDelete()/markEventProcessed()
  // (siehe SyncGatewayTestSurface unten) ist dies eine ECHTE Produktions-
  // methode: push() fragt sie als Idempotenz-Fast-Path direkt ab, VOR jedem
  // Schema-/Fremdschlüssel-Check (siehe sync.service.ts).
  isEventProcessed(eventId: string, clubId: string): Promise<boolean>;
  // Siehe ausführlicher Kommentar bei SyncWriteOperation/ApplyOutcome oben.
  applyAndMarkProcessed(
    operation: SyncWriteOperation,
    event: { id: string; clubId: string; store: EntityStoreName; action: string },
  ): Promise<ApplyOutcome>;
  // Ermittelt die clubId eines Users — für die Eigentümerprüfung von
  // ActionItem.assignedTrainerId (siehe sync.foreignKeys.ts:
  // assertForeignKeysWithinClub()). Eigene Methode statt findById(), da
  // "users" keine der zehn fachlichen Sync-Tabellen ist (kein
  // EntityDelegate über db/entityRegistry.ts verfügbar). Liefert null
  // sowohl wenn die userId nicht existiert als auch wenn sie zu keinem
  // Verein gehört (z. B. superadmin) — ausreichend, da der Aufrufer die ID
  // ohnehin nur gegen eine konkrete erwartete clubId vergleicht.
  findClubIdForUser(userId: string): Promise<string | null>;
}

// create()/update()/softDelete()/markEventProcessed() gehören nicht in
// SyncGateway: push() (sync.service.ts) schreibt ausschließlich über
// applyAndMarkProcessed(), kein Aufrufer nutzt sie einzeln. Als Teil von
// SyncGateway müssten beide Implementierungen sie dennoch tragen und
// konsistent halten — ein Testgerüst im Gewand eines Produktions-Interfaces.
// Deshalb ein eigenes, schmaleres Interface, das NUR PrismaSyncGateway
// zusätzlich implementiert: einzig
// test-integration/syncGateway.integration.test.ts prüft diese Primitiven
// unabhängig von applyAndMarkProcessed() (u. a. das clubId-Scoping über
// eine ECHTE SQL-WHERE-Klausel, das ein In-Memory-Double nicht verlässlich
// abbilden kann). InMemorySyncGateway braucht sie nur noch als PRIVATE
// Implementierungsdetail des eigenen applyAndMarkProcessed() und
// implementiert dieses Interface bewusst nicht mehr.
export interface SyncGatewayTestSurface {
  create(store: EntityStoreName, payload: Record<string, unknown>): Promise<void>;
  // clubId ist PFLICHT (nicht optional wie bei findById): update() darf
  // niemals versehentlich ungescoped aufgerufen werden, da es — anders als
  // findById — tatsächlich Daten verändert. Die where-Klausel muss daher
  // immer sowohl id als auch clubId enthalten (analog zu softDelete()),
  // sonst könnte ein manipuliertes Event mit einer fremden entityId, aber
  // der eigenen clubId im Payload, den Datensatz eines fremden Vereins
  // überschreiben.
  update(store: EntityStoreName, id: string, clubId: string, payload: Record<string, unknown>): Promise<void>;
  softDelete(store: EntityStoreName, id: string, clubId: string): Promise<void>;
  markEventProcessed(eventId: string, clubId: string, store: EntityStoreName, action: string): Promise<void>;
}

export class PrismaSyncGateway implements SyncGateway, SyncGatewayTestSurface {
  constructor(private readonly prisma: PrismaClient) {}

  async findById(store: EntityStoreName, id: string, clubId?: string): Promise<SyncRecord | null> {
    const delegate = getEntityDelegate(this.prisma, store);
    const record = (await delegate.findUnique({ where: { id } })) as SyncRecord | null;
    // Vereins-Scoping: wenn eine clubId übergeben wurde und der gefundene
    // Datensatz einem ANDEREN Verein gehört, wird er behandelt, als
    // existiere er nicht — verhindert, dass ein Aufrufer über eine ihm
    // bekannte fremde entityId Daten eines fremden Vereins einsehen kann
    // (z. B. via des serverVersion-Felds bei einem Konfliktergebnis).
    if (record && clubId !== undefined && record.clubId !== clubId) return null;
    return record;
  }

  // Siehe Interface-Kommentar oben. EINE Abfrage je Store statt einer je
  // Referenz, und `select: { id: true }` statt der vollständigen Zeile —
  // die Prüfung braucht nur zu wissen, welche der angefragten ids im
  // eigenen Verein existieren, nicht deren Inhalt.
  async findExistingIdsInClub(store: EntityStoreName, ids: readonly string[], clubId: string): Promise<Set<string>> {
    if (ids.length === 0) return new Set();
    const delegate = getEntityDelegate(this.prisma, store);
    const rows = (await delegate.findMany({
      where: { id: { in: [...ids] }, clubId },
      select: { id: true },
    })) as Array<{ id: string }>;
    return new Set(rows.map((row) => row.id));
  }

  // Siehe Interface-Kommentar oben. EINE Abfrage je Store statt
  // einer je Event — anders als findExistingIdsInClub() werden hier die
  // VOLLSTÄNDIGEN Zeilen benötigt (push() braucht u. a. updatedAt für
  // resolveConflict()).
  async findManyByIdsInClub(store: EntityStoreName, ids: readonly string[], clubId: string): Promise<Map<string, SyncRecord>> {
    if (ids.length === 0) return new Map();
    const delegate = getEntityDelegate(this.prisma, store);
    const rows = (await delegate.findMany({ where: { id: { in: [...ids] }, clubId } })) as SyncRecord[];
    return new Map(rows.map((row) => [row.id, row]));
  }

  // Siehe Interface-Kommentar oben. EINE Abfrage für den gesamten
  // Push-Batch statt einer je Event.
  async findProcessedEventIds(eventIds: readonly string[], clubId: string): Promise<Set<string>> {
    if (eventIds.length === 0) return new Set();
    const rows = await this.prisma.syncedEvent.findMany({
      where: { id: { in: [...eventIds] }, clubId },
      select: { id: true },
    });
    return new Set(rows.map((row: { id: string }) => row.id));
  }

  async create(store: EntityStoreName, payload: Record<string, unknown>): Promise<void> {
    const delegate = getEntityDelegate(this.prisma, store);
    await delegate.create({ data: payload });
  }

  async update(store: EntityStoreName, id: string, clubId: string, payload: Record<string, unknown>): Promise<void> {
    const delegate = getEntityDelegate(this.prisma, store);
    // clubId in der where-Klausel: analog zu softDelete() — verhindert,
    // dass ein manipuliertes Event mit einer fremden entityId (aber
    // korrekter eigener clubId im Payload) einen Datensatz eines FREMDEN
    // Vereins überschreibt. Trifft die
    // where-Klausel nicht (fremder Verein oder id existiert nicht mehr),
    // wirft Prisma "P2025" (Record not found) — wird im Service wie ein
    // regulärer Anwendungsfehler behandelt und als "error" gemeldet, statt
    // den Datensatz eines anderen Vereins stillschweigend zu verändern.
    await delegate.update({ where: { id, clubId }, data: payload });
  }

  async softDelete(store: EntityStoreName, id: string, clubId: string): Promise<void> {
    const delegate = getEntityDelegate(this.prisma, store);
    // clubId in der where-Klausel: verhindert, dass ein manipuliertes Event
    // versehentlich/absichtlich eine id eines FREMDEN Vereins löscht.
    await delegate.update({ where: { id, clubId }, data: { deletedAt: new Date() } });
  }

  // Dreiphasig statt "pro Store bis zu limit Volltreffer": eine Abfrage je
  // Store mit vollständigen Zeilen holte bei limit=201 bis zu 2.211 Zeilen
  // samt großer JSONB-Spalten, von denen über 90 % sofort wieder verworfen
  // werden — ausgeliefert werden nur die global ältesten `limit`.
  //
  //  1) Schlanke "Wasserstand"-Abfrage je Store (nur id/updatedAt/deletedAt).
  //     Bleibt auf `limit` pro Store begrenzt, damit auch der Extremfall
  //     "alle Änderungen in einem Store" abgedeckt ist.
  //  2) Global zusammenführen und auf `limit` kürzen.
  //  3) Payload nur für die verbliebenen Zeilen nachladen, gruppiert nach
  //     Store. Ein Store ohne Treffer in den finalen `limit` Zeilen
  //     verursacht damit gar keine Payload-Abfrage; gelöschte Zeilen
  //     brauchen ohnehin keine.
  //
  // Race-Hinweis: zwischen Schritt 1 und 3 kann eine Zeile erneut geändert
  // werden. Das gemeldete `updatedAt` stammt bewusst aus Schritt 1 (es
  // bestimmt Sortierung und Cursor), die Payload ist dadurch im Extremfall
  // etwas NEUER als der Zeitstempel. Unkritisch, weil pull() idempotent ist:
  // die Zeile wird beim nächsten Zyklus redundant, aber korrekt erneut
  // ausgeliefert. Der umgekehrte Fall — Payload ÄLTER als der Zeitstempel,
  // also stiller Datenverlust — kann so nicht auftreten.
  async listChangedSince(clubId: string, since: Date | null, limit: number, stores: readonly EntityStoreName[]): Promise<ChangedRecord[]> {
    type Candidate = { store: EntityStoreName; id: string; updatedAt: Date; deleted: boolean };

    const [storeWatermarks, tombstones] = await Promise.all([
      Promise.all(
        stores.map(async (store) => {
          const delegate = getEntityDelegate(this.prisma, store);
          const rows = (await delegate.findMany({
            where: { clubId, ...(since ? { updatedAt: { gt: since } } : {}) },
            orderBy: { updatedAt: 'asc' },
            take: limit,
            select: { id: true, updatedAt: true, deletedAt: true },
          })) as Array<{ id: string; updatedAt: Date; deletedAt: Date | null }>;
          return rows.map((row): Candidate => ({ store, id: row.id, updatedAt: row.updatedAt, deleted: row.deletedAt !== null }));
        }),
      ),
      // Wie die Store-Auswahl oben per `store: { in: [...stores] }`
      // eingegrenzt: ein Löschvermerk aus einem für die anfragende Rolle
      // nicht lesbaren Store würde sonst unnötig mitgeladen.
      this.prisma.syncTombstone.findMany({
        where: { clubId, store: { in: [...stores] }, ...(since ? { deletedAt: { gt: since } } : {}) },
        orderBy: { deletedAt: 'asc' },
        take: limit,
        select: { store: true, entityId: true, deletedAt: true },
      }),
    ]);

    const tombstoneCandidates: Candidate[] = tombstones.map((t: { store: string; entityId: string; deletedAt: Date }) => ({
      store: t.store as EntityStoreName,
      id: t.entityId,
      updatedAt: t.deletedAt,
      deleted: true,
    }));

    const top = [...storeWatermarks.flat(), ...tombstoneCandidates]
      .sort((a, b) => a.updatedAt.getTime() - b.updatedAt.getTime())
      .slice(0, limit);

    const neededIdsByStore = new Map<EntityStoreName, string[]>();
    for (const candidate of top) {
      if (candidate.deleted) continue; // payload bleibt null — keine Nachladung nötig
      let ids = neededIdsByStore.get(candidate.store);
      if (!ids) { ids = []; neededIdsByStore.set(candidate.store, ids); }
      ids.push(candidate.id);
    }

    const payloadsByStoreAndId = new Map<string, SyncRecord>();
    await Promise.all(
      Array.from(neededIdsByStore.entries()).map(async ([store, ids]) => {
        const delegate = getEntityDelegate(this.prisma, store);
        const rows = (await delegate.findMany({ where: { id: { in: ids } } })) as SyncRecord[];
        for (const row of rows) payloadsByStoreAndId.set(`${store}:${row.id}`, row);
      }),
    );

    return top.map((candidate): ChangedRecord => ({
      store: candidate.store,
      entityId: candidate.id,
      // Immer 'update', nie 'create': der Server weiß hier nicht, ob die
      // anfragende Person die Zeile schon einmal gesehen hat — auch beim
      // ersten Pull kann sie längst mehrfach aktualisiert worden sein.
      // syncClient.js
      // (pull()) behandelt ohnehin jede nicht gelöschte Zeile identisch
      // (putWithoutSync, ein Upsert) — der Unterschied zwischen "create"
      // und "update" hat für den Aufrufer keine Bedeutung, nur "delete"
      // zählt.
      action: candidate.deleted ? 'delete' : 'update',
      payload: candidate.deleted ? null : (payloadsByStoreAndId.get(`${candidate.store}:${candidate.id}`) ?? null),
      updatedAt: candidate.updatedAt,
    }));
  }

  async isEventProcessed(eventId: string, clubId: string): Promise<boolean> {
    const existing = await this.prisma.syncedEvent.findFirst({ where: { id: eventId, clubId } });
    return existing !== null;
  }

  async markEventProcessed(eventId: string, clubId: string, store: EntityStoreName, action: string): Promise<void> {
    await this.prisma.syncedEvent.create({ data: { id: eventId, clubId, store, action } });
  }

  // Siehe SyncWriteOperation/ApplyOutcome oben für den Hintergrund.
  //
  // Der Ledger-Eintrag wird bewusst per `createMany({ skipDuplicates:
  // true })` statt per `create()` geschrieben: bei einem bereits
  // vorhandenen Eintrag liefert das `count: 0` zurück, statt eine
  // Unique-Constraint-Exception (P2002) zu werfen. Das ist der
  // entscheidende Unterschied zu einem naheliegenderen Ansatz
  // ("versuche create(), fange P2002 als 'already-processed'") — DER
  // wäre nicht zuverlässig unterscheidbar gewesen: bricht die
  // nachfolgende, in DERSELBEN Transaktion versuchte Datenänderung
  // ihrerseits mit einem (davon völlig unabhängigen) P2002 ab — z. B.
  // eine astronomisch unwahrscheinliche, aber nicht auszuschließende
  // UUID-Kollision auf der fachlichen Tabelle selbst —, trägt Prismas
  // Fehlerobjekt (`meta.target`) für BEIDE Fälle typischerweise dieselbe
  // Spalte ("id"), ohne die betroffene TABELLE zu benennen. Mit
  // `skipDuplicates` entfällt diese Unterscheidung komplett: nur die
  // Ledger-Zeile selbst kann je `count: 0` liefern, jeder andere Fehler
  // (inkl. P2002 auf der fachlichen Tabelle) bleibt eine echte Exception,
  // die die gesamte Transaktion regulär zurückrollt und im Service als
  // "error" beantwortet wird (siehe describeSyncError()).
  async applyAndMarkProcessed(operation: SyncWriteOperation, event: { id: string; clubId: string; store: EntityStoreName; action: string }): Promise<ApplyOutcome> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return this.prisma.$transaction(async (tx: any) => {
      const ledgerResult = await tx.syncedEvent.createMany({
        data: [{ id: event.id, clubId: event.clubId, store: event.store, action: event.action }],
        skipDuplicates: true,
      });
      if (ledgerResult.count === 0) return 'already-processed' as const;

      const delegate = getEntityDelegate(tx, operation.store);
      if (operation.kind === 'create') {
        await delegate.create({ data: operation.payload });
      } else if (operation.kind === 'update') {
        // clubId in der where-Klausel: siehe update() oben.
        await delegate.update({ where: { id: operation.id, clubId: operation.clubId }, data: operation.payload });
      } else {
        await delegate.update({ where: { id: operation.id, clubId: operation.clubId }, data: { deletedAt: new Date() } });
        // Aufräumarbeit (Code-Review): eine gelöschte Athletin/ein
        // gelöschter Athlet ist per Soft-Delete NUR "deletedAt" gesetzt,
        // keine echte SQL-DELETE — ParentLink.athlete trägt zwar
        // `onDelete: Cascade` (schema.prisma), das greift aber
        // ausschließlich bei einer tatsächlichen Zeilenlöschung (z. B. dem
        // harten DSGVO-Purge in jobs/erasure.repository.ts), nicht bei
        // diesem UPDATE. Ohne diese explizite Aufräumung bliebe eine
        // ParentLink-Zeile dauerhaft auf ein unsichtbares Athletenprofil
        // verweisen — Phase 2, Abschnitt 4.2 (docs/Plans/phase2-plan.md).
        // Bewusst in DERSELBEN Transaktion (statt eines separaten,
        // fehlschlagbaren Nachgangs): beides gehört atomar zusammen, ein
        // Elternkonto soll nie eine Verknüpfung zu einem gerade gelöschten
        // Kind behalten. Store-spezifische Ausnahme in dieser sonst
        // generischen Methode — einzige begründete Abweichung, siehe
        // Datei-Kopfkommentar.
        if (operation.store === 'athletes') {
          await tx.parentLink.deleteMany({ where: { athleteId: operation.id } });
        }
      }
      return 'applied' as const;
    });
  }

  async findClubIdForUser(userId: string): Promise<string | null> {
    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { clubId: true } });
    return user?.clubId ?? null;
  }
}
