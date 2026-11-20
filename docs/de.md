# Microsoft Edge TTS

Gibt Gladys die **neuronalen Stimmen von Microsoft Edge**, die der Funktion
„Laut vorlesen“ des Browsers: Die Ansagen deiner Szenen werden mit ihnen auf
deinen Lautsprechern gesprochen. Kostenlos, ohne Konto und ohne API-Schlüssel,
wie die Bibliothek `edge-tts` und die Home-Assistant-Integration, die sie
nutzt.

## Was du bekommst

- Eine **Stimme für Gladys** (Gladys 5.3.0 oder neuer): Einmal ausgewählt,
  spricht die Szenenaktion **Auf einem Lautsprecher sprechen** mit einer
  Edge-Stimme auf deinen Lautsprechern (Sonos, Google Cast, AirPlay…).
- **Über 300 Stimmen in 75 Sprachen**, sehr natürlich: standardmäßig eine
  Stimme in der Sprache jedes Benutzers (Tanja oder Christoph auf Deutsch),
  weiblich oder männlich, oder eine feste Stimme (französische, englische,
  spanische, italienische Stimmen…), oder jede andere Edge-Stimme über ihren
  Namen.
- **Tempo**, **Tonhöhe** und **Lautstärke** der Stimme sind einstellbar.
- Lange Texte (bis zu den 2.000 Zeichen, die Gladys sendet) werden am
  Satzende geteilt und zu einem einzigen Clip zusammengefügt.

## Vor dem Start: was dieser Dienst ist

- Es ist der **Vorlesedienst von Microsoft Edge**, so genutzt wie `edge-tts`
  es tut. Er ist **weder offiziell noch dokumentiert**: keine Garantie, und
  Microsoft kann ihn jederzeit ändern, begrenzen oder abschalten. Die
  Integration schlägt dann sichtbar fehl (Supervision, Szenenprotokoll);
  vielleicht ist ein Update der Integration nötig.
- **Jeder gesprochene Text geht an Microsoft** (mit der IP-Adresse deiner
  Verbindung), gemäß der
  [Datenschutzerklärung von Microsoft](https://www.microsoft.com/privacy/privacystatement).
  Nutze sie nicht für Texte, die zu Hause bleiben sollen.
- Eine Internetverbindung ist nötig.
- Nicht mit Microsoft verbunden. Microsoft Edge ist eine Marke der Microsoft
  Corporation.

## Konfiguration

1. Installiere die Integration aus dem Katalog und öffne dann ihren Tab
   **Konfiguration**.
2. **Stimme**: **Automatisch** spricht die Sprache des Benutzers, dem Gladys
   antwortet, bei einer Szenenansage die des ersten Administrators
   (Französisch, wenn Gladys sie nicht kennt). Oder wähle eine Stimme aus der
   Liste.
3. **Automatische Stimme**: weiblich oder männlich, im automatischen Modus.
4. **Andere Stimme**: der Name einer beliebigen Edge-Stimme (zum Beispiel
   `it-IT-ElsaNeural`); er ersetzt die Auswahl der Liste. Die Taste **Stimmen
   auflisten** nennt die Stimmen einer Sprache: Gib einen Code wie `it` oder
   `pt-BR` ein.
5. **Tempo**, **Tonhöhe** und **Lautstärke**: 0 lässt die Stimme, wie sie ist.
   Die Lautstärke wird im Clip eingestellt; die des Lautsprechers bleibt
   gleich.
6. Speichere und drücke dann **Stimme testen**: Ein Testsatz wird bei
   Microsoft angefragt und die Länge des erhaltenen Clips angezeigt.
7. Öffne **Integrationen → Künstliche Intelligenz** und wähle **Microsoft Edge
   TTS** in der Karte **Stimme**.

## Verwendung in Szenen

Füge einer Szene die Aktion **Auf einem Lautsprecher sprechen** hinzu, wähle
einen Lautsprecher und gib den Text ein. Gladys fragt den Clip bei dieser
Integration an und liefert ihn dann im lokalen Netzwerk an den Lautsprecher.

Der Sprachassistent von Gladys bleibt mit einer Stimmen-Integration reiner
Text: Seine Seite läuft über HTTPS, der Clip wird im lokalen Netzwerk über HTTP
geliefert, was der Browser blockiert. Das ist eine Grenze von Gladys, für alle
Stimmen-Integrationen gleich.

## Grenzen

- Ein Satz dauert etwa **1 Sekunde**. Ein langer Text wird in Teilen von
  höchstens 800 Zeichen gesendet, **einer nach dem anderen**: Die höchstens
  2.000 Zeichen von Gladys ergeben 3 Teile, etwa fünfzehn Sekunden und einen
  Clip von etwa 1 MB für 3 Minuten, unter den 30 Sekunden, die Gladys wartet.
- Ein schon erstellter Clip (gleicher Text, gleiche Stimme, gleiche
  Einstellungen) bleibt im Speicher (die letzten 16), und eine Ansage auf
  mehreren Lautsprechern fragt Microsoft nur einmal.
- Die Stimmenliste wird höchstens einmal am Tag gelesen, und nur wenn nötig
  (Taste **Stimmen auflisten**, eine Sprache ohne Standardstimme).
- Gegen den echten Dienst entwickelt und getestet, ohne Lautsprecher und ohne
  echte Gladys-Instanz: Rückmeldungen sind willkommen.

## Fehlerbehebung

- Die **Supervision** zeigt, ob Microsoft Edge antwortet und, wenn nicht,
  warum (kein Internet, unbekannte Stimme, der Dienst hat sich geändert…).
- „Microsoft Edge kennt diese Stimme nicht“: Prüfe die genaue Schreibweise im
  Feld **Andere Stimme** oder leere es.
- „Microsoft lehnt die Verbindung ab“: Der Dienst hat sich geändert oder
  begrenzt deine Verbindung; such nach einem Update der Integration.
- Eine fehlgeschlagene Ansage steht in den **Protokollen** der Integration, und
  die Szenenaktion schlägt im Szenenprotokoll fehl.
- Starte den Container mit `LOG_LEVEL=debug`, um jede Anfrage zu sehen.
