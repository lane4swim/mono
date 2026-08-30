-- Ineffizienz-Korrektur: users."clubId" trug bislang keinen Index.
-- Postgres legt für Fremdschlüsselspalten (anders als für UNIQUE-Spalten)
-- keinen an, sodass jede Mitgliederabfrage eines Vereins
-- (auth.repository.ts: listByClub(); invitations.repository.ts:
-- countMembersByClub()) die gesamte users-Tabelle aller Vereine
-- sequenziell las. Beide filtern ausnahmslos zusätzlich auf aktive
-- (nicht gelöschte) Konten, daher "deletedAt" als zweite Spalte.
CREATE INDEX "users_clubId_deletedAt_idx" ON "users"("clubId", "deletedAt");
