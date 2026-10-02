-- ============================================================
-- Migration 060 — sales_sync_runs can record Accurate syncs
--
-- The read-only Accurate integration logs each run here with source
-- 'accurate'. The first successful one is also what switches the app from
-- "belum tersambung Accurate" (figures marked, alarms held) to live data.
-- 'sheet' stays for the history of the retired sheet recap.
-- Idempotent.
-- ============================================================
SET NAMES utf8mb4;

ALTER TABLE sales_sync_runs MODIFY source ENUM('sheet', 'visit_file', 'accurate') NOT NULL;
