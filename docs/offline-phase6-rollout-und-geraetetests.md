# Offline Phase 6: Rollout und Gerätetests

Diese Checkliste ist für einen manuellen Staging- und Produktionsrollout. Das Ausführen der SQL-Dateien und das Deployment gehören nicht zu Phase 6 im Repository.

## Datenbank und Release

1. Git-Stand und aktuellen Fischteich-Build festhalten; ein wiederherstellbares Datenbank-Backup beziehungsweise den projektspezifischen Rollback-Weg prüfen.
2. In **Staging** die additive Migration `supabase/migrations/20260922020000_add_idempotent_roulette_spin_rpc.sql` anwenden. Das separate Revoke-Skript dabei auslassen.
3. In Staging im Supabase SQL Editor den vollständigen Inhalt von `tests/fixtures/roulette-spin-idempotency.sql` als **ein Skript** ausführen. Es beginnt mit `begin;` und endet mit `rollback;`. Erfolg bedeutet: keine Exception. Der Test prüft ersten und wiederholten normalen sowie Gold-Spin, Zähler, Gold-Ereignis und Zeitstempel sowie ungültige Eingaben. Anschließend prüfen, dass für `Phase4Fixture` keine Testdaten übrig geblieben sind. Die Fixture nur in Staging/Test ausführen.
4. Mit einem alten Staging-Client einen normalen und einen Gold-Spin prüfen. Die additive Migration belässt die Grants der alten RPCs zunächst bestehen.
5. In Staging den neuen Build deployen. Online-Spin, Offline-Spin, Neustart mit Pending-Eintrag und automatischen Sync prüfen. Denselben Spin nach simuliertem Abbruch erneut senden: `already_processed` muss die lokale Vormerkung entfernen, ohne Serverzähler oder Gold-Ereignis erneut zu ändern.
6. Die additive Migration in Produktion **vor** dem neuen Client-Deployment manuell anwenden und den neuen RPC gezielt prüfen. Die SQL-Fixture nicht in Produktion ausführen.
7. Neuen Build deployen. Online-Roulette, Offline-Start nach vorherigem Online-Besuch, mehrere Offline-Spins, Wiederverbindung, Pending-Anzeige und globale Statistik auf echten Geräten prüfen. Serverfehler müssen Vormerkungen erhalten; ein fehlender neuer RPC darf keinen Legacy-Fallback auslösen.
8. Alte aktive Tabs und installierte PWAs während der Übergangszeit beobachten. Das Update-Modal erzwingt kein sofortiges Update. Das Legacy-Revoke-Skript `supabase/rollout/revoke_legacy_roulette_spin_rpcs.sql` erst separat und bewusst ausführen, wenn alte Clients aktualisiert sind und die alten Schreib-RPCs nachweislich nicht mehr gebraucht werden. Sonst könnten alte Clients keine Spins mehr schreiben.

Die neue Receipt-Tabelle hat `spin_id uuid` als Primärschlüssel, aktiviertes RLS und keine direkten Rechte für `public`, `anon` oder `authenticated`. Der neue RPC hat `SECURITY DEFINER`, einen leeren `search_path`, explizite Schemaqualifizierung und validiert Pflichtwerte, Ergebnis und den getrimmten Namen. UUID-Parameter werden bereits beim PostgreSQL-Typcast geprüft. Nur der RPC erhält `EXECUTE` für `anon` und `authenticated`. Das Revoke-Skript liegt absichtlich außerhalb der automatischen Migrationen.

## Installierte iPhone-PWA

1. Online die installierte PWA öffnen und warten, bis der neue Build und Service Worker aktiv sind. Roulette, Einstellungen und Spieler-Aufteilen einmal öffnen. PWA vollständig schließen.
2. Flugmodus einschalten; WLAN zusätzlich ausschalten, falls das Gerät WLAN im Flugmodus zulässt. PWA aus dem Homescreen starten. Hauptmenü ohne Fehler prüfen.
3. Spieler-Aufteilen testen: Finger-Auswahl mit mehreren Personen, Aufteilen, Neu Aufteilen, Reset, Mitspieler-Auswahl, zufällige und manuelle Teams, Rage Cage und Gast-Fische. Lokale Einstellungen ändern und nach erneutem Öffnen prüfen. Online-only Schaltflächen sollen sichtbar bleiben und verständlich abgefangen werden.
4. Roulette direkt nach dem Offline-Start öffnen und fünfmal drehen, darunter nach Möglichkeit einen Goldtreffer. Lokale Zähler und Quoten sowie Pending-Anzahl prüfen. Globale Werte und Rangliste dürfen keine alten Werte als aktuell ausgeben.
5. PWA schließen, offline wieder öffnen und prüfen, dass die Pending-Anzahl noch vorhanden ist. Dann PWA in den Hintergrund schicken, Internet einschalten und wieder in den Vordergrund holen. Ein Sync soll starten, auch wenn iOS das `online`-Event im Hintergrund ausgelassen hat.
6. Nach dem Sync Pending-Anzahl null, Serverzähler und gegebenenfalls Gold-Ereignis prüfen. PWA erneut offline schalten, weitere Spins drehen, schließen, online öffnen und denselben Ablauf wiederholen. Kein lokales Nachzählen und keine doppelten Server-Spins.
7. Optional auf einem zweiten Gerät denselben Display-Namen verwenden: drei Spins auf Gerät A, vier auf Gerät B. Nach beiden Syncs genau sieben zusätzliche Server-Spins erwarten. Die Geräte-IDs bleiben verschieden; die Namensstatistik aggregiert weiterhin nach Name.

## Installierte Android-/Samsung-PWA

Den iPhone-Kernablauf auf einer **installierten** Android- beziehungsweise Samsung-PWA wiederholen: Online-Besuch und Build-Aktivierung, App vollständig schließen, Flugmodus mit abgeschaltetem WLAN, Offline-Start, lokale Teamfunktionen und Einstellungen, fünf Offline-Roulette-Spins, App-Neustart mit erhaltenen Pending-Spins, Wiederverbindung im Hintergrund und Rückkehr in den Vordergrund, einmaliger Sync und Prüfung der Serverzähler. Danach einen zweiten Offline-/Online-Zyklus sowie den optionalen Zwei-Geräte-Fall durchführen. Bei einem Update von Build A auf Build B offline neu starten und prüfen, dass `index.html`, `script.js`, `roulette-service.js`, `roulette-offline-queue.js` und `style.css` aus einem funktionsfähigen Cache-Stand geladen werden.

## Grenzen der Prüfung

Automatisierte Tests simulieren Browser-Lifecycle, IndexedDB und RPC-Antworten. Echte iOS-/Android-PWA-Lifecycle- und Storage-Eigenschaften sowie die SQL-Migration auf PostgreSQL müssen manuell in Staging und auf Geräten geprüft werden. Ein neuer Spin wird zuerst in IndexedDB vorgemerkt. Lokaler Zähler und lokale Spin-ID werden anschließend gemeinsam in einem `localStorage`-Datensatz geschrieben; die Recovery kann dadurch beide Abbruchfenster ohne Verlust oder Doppelzählung schließen. Bei IndexedDB-, `localStorage`- oder Quota-Fehler bleibt die sicherste vorhandene Stufe erhalten, es erscheint ein verständlicher Hinweis und die Serverpersistenz wartet auf eine bestätigte lokale Anwendung.
