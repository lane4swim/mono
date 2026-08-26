// apps/api/src/modules/sync/sync.gateway.ts
//
// Abstraktionsschicht zwischen sync.service.ts und der Datenhaltung.
// Anders als bei auth/invitations (ein Repository-Interface je Entität)
// braucht die generische Sync-API GENAU EINE Schnittstelle, die über alle
// zehn fachlichen Stores hinweg funktioniert — sie nutzt dafür
// db/entityRegistry.ts (SyncStore -> Prisma-Delegate), das in Phase 2
// bereits für genau diesen Zweck vorbereitet wurde.
import type { PrismaClient } from '@prisma/client';
import type { EntityStoreName } from '@lane1/shared-types';
import { ENTITY_STORE_NAMES } from '@lane1/shared-types';
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
  // Änderungen eines Vereins seit einem Zeitpunkt, über alle Stores hinweg,
  // absteigend nach updatedAt limitiert (Pagination via `limit`).
  listChangedSince(clubId: string, since: Date | null, limit: number): Promise<ChangedRecord[]>;
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

// Code-Review, Befund L5: create()/update()/softDelete()/markEventProcessed()
// standen bislang direkt in SyncGateway, obwohl push() (sync.service.ts)
// AUSSCHLIESSLICH applyAndMarkProcessed() für Schreibzugriffe nutzt (Repo-
// weit bestätigt: kein Aufrufer ruft sie einzeln auf — anders als
// isEventProcessed() oben, das TATSÄCHLICH als Fast-Path in push() steht;
// der ursprüngliche Befund zählte es fälschlich mit zu den toten Methoden).
// Beide Gateway-Implementierungen mussten sie trotzdem als Teil von
// SyncGateway tragen und konsistent halten — ein Testgerüst, das als
// Produktions-Interface auftrat. Jetzt ein eigenes, schmaleres Interface,
// das NUR PrismaSyncGateway zusätzlich implementiert: einzig
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

// Genau diese Liste entscheidet in listChangedSince() unten, welche
// Stores beim Pull überhaupt betrachtet werden — ein hier fehlender Store
// würde ohne jede Fehlermeldung stillschweigend nie ausgeliefert.
// ENTITY_STORE_NAMES (siehe packages/shared-types/src/entities.ts) ist
// aus ENTITY_SCHEMAS abgeleitet, statt hier als eigene Kopie erneut
// aufgezählt zu werden — dieselbe Liste, die bereits STORE_PERMISSIONS in
// sync.service.ts über den Record<EntityStoreName, …>-Typ absichert.
const ALL_STORES: EntityStoreName[] = ENTITY_STORE_NAMES;

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

  async create(store: EntityStoreName, payload: Record<string, unknown>): Promise<void> {
    const delegate = getEntityDelegate(this.prisma, store);
    await delegate.create({ data: payload });
  }

  async update(store: EntityStoreName, id: string, clubId: string, payload: Record<string, unknown>): Promise<void> {
    const delegate = getEntityDelegate(this.prisma, store);
    // clubId in der where-Klausel: analog zu softDelete() — verhindert,
    // dass ein manipuliertes Event mit einer fremden entityId (aber
    // korrekter eigener clubId im Payload) einen Datensatz eines FREMDEN
    // Vereins überschreibt (siehe Sicherheitsreview, Punkt 1). Trifft die
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

  // Ineffizienz-Korrektur (Code-Review, Befund P2): vormals holte JEDE der
  // zehn Store-Abfragen bis zu `limit` VOLLSTÄNDIGE Zeilen (inkl. u. U.
  // großer JSONB-Spalten wie "attendance") — bei limit=201 im Normalfall
  // also bis zu 2.211 vollständige Zeilen aus der Datenbank, von denen im
  // Regelfall über 90 % sofort wieder verworfen werden (nur die global
  // ältesten `limit` Zeilen über ALLE Stores hinweg werden tatsächlich
  // ausgeliefert). Zweiphasiger Ansatz statt einer einzigen
  // "pro Store bis zu limit Volltreffer" -Abfrage:
  //
  //  1) Schlanke "Wasserstand"-Abfrage je Store (nur id/updatedAt/
  //     deletedAt, ohne Payload-Spalten) — bleibt bewusst weiterhin auf
  //     `limit` pro Store begrenzt (der Extremfall "alle Änderungen liegen
  //     in einem einzigen Store" deckt bis zu `limit` Zeilen ab), ist aber
  //     um ein Vielfaches billiger als dieselbe Anzahl Zeilen samt voller
  //     Nutzdaten zu übertragen.
  //  2) Globale Zusammenführung + Kürzung auf `limit` — identisch zur
  //     bisherigen Logik, nur ohne dabei bereits Nutzdaten mitzuschleppen.
  //  3) Payload NUR für die tatsächlich ausgelieferten (≤ `limit`) Zeilen
  //     nachladen, gruppiert nach Store (ein `findMany({ id: { in: […] } })`
  //     je beteiligtem Store statt zehn ungefilterten Abfragen). Ein
  //     Store, der zwar Kandidaten in Schritt 1 lieferte, aber keinen
  //     einzigen davon in die finalen `limit` Zeilen schafft, verursacht
  //     dadurch GAR KEINE Payload-Abfrage. Bereits gelöschte Zeilen
  //     (deletedAt gesetzt) brauchen ohnehin keine Payload (payload: null)
  //     und werden in Schritt 3 konsequent ausgespart.
  //
  // Race-Hinweis: zwischen Schritt 1 und Schritt 3 könnte eine Zeile
  // theoretisch erneut geändert werden. Das zurückgegebene `updatedAt`
  // stammt bewusst weiterhin aus Schritt 1 (bestimmt Sortierung UND den
  // nächsten Cursor) — die in Schritt 3 geladene Payload ist dadurch im
  // Extremfall geringfügig NEUER als der gemeldete Zeitstempel. Das ist
  // unkritisch: pull() (sync.service.ts) ist ohnehin idempotent
  // (putWithoutSync als Upsert), die betroffene Zeile würde beim nächsten
  // Sync-Zyklus lediglich erneut (redundant, aber korrekt) ausgeliefert,
  // da ihr tatsächliches updatedAt in der Datenbank dann über dem
  // gemeldeten Cursor liegt. Die umgekehrte Reihenfolge (Payload ÄLTER als
  // der gemeldete Zeitstempel) kann dagegen nicht auftreten — genau das
  // wäre der gefährliche Fall (stiller Datenverlust) gewesen.
  async listChangedSince(clubId: string, since: Date | null, limit: number): Promise<ChangedRecord[]> {
    type Candidate = { store: EntityStoreName; id: string; updatedAt: Date; deleted: boolean };

    const [storeWatermarks, tombstones] = await Promise.all([
      Promise.all(
        ALL_STORES.map(async (store) => {
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
      this.prisma.syncTombstone.findMany({
        where: { clubId, ...(since ? { deletedAt: { gt: since } } : {}) },
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
      // Aufräumarbeit (Code-Review): vormals `since ? 'update' : 'create'`
      // — das unterstellte fälschlich, jede Zeile eines ERSTEN Pulls
      // (since === null) sei eine Neuanlage. Tatsächlich weiß der Server
      // an dieser Stelle gar nicht, ob die anfragende Person diese Zeile
      // schon einmal gesehen hat — auch beim allerersten Pull kann eine
      // Zeile längst mehrfach aktualisiert worden sein. syncClient.js
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

  // Sicherheitskorrektur (Code-Review, Befund C3): siehe ausführlichen
  // Kommentar bei SyncWriteOperation/ApplyOutcome oben für den Hintergrund.
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
        // clubId in der where-Klausel: siehe update() oben (Sicherheitsreview,
        // Punkt 1) — dieselbe Begründung gilt hier unverändert.
        await delegate.update({ where: { id: operation.id, clubId: operation.clubId }, data: operation.payload });
      } else {
        await delegate.update({ where: { id: operation.id, clubId: operation.clubId }, data: { deletedAt: new Date() } });
      }
      return 'applied' as const;
    });
  }

  async findClubIdForUser(userId: string): Promise<string | null> {
    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { clubId: true } });
    return user?.clubId ?? null;
  }
}
