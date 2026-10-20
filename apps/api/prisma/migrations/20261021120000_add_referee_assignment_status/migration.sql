-- Rückmeldung zu Kampfrichtereinsätzen: Bestandseinsätze gelten als
-- bestätigt (Default), neue admin-seitige Einsätze starten als "requested".
-- AlterTable
ALTER TABLE "referee_assignments" ADD COLUMN     "respondedAt" TIMESTAMP(3),
ADD COLUMN     "responseNote" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "status" TEXT NOT NULL DEFAULT 'confirmed';

