# MKT Terminal

Ein Live-Markt-Terminal im Stil des Bloomberg Terminals: schwarz-amber, dicht gepackt, mit Befehlszeile.
Es ist eine statische Web-App ohne Build-Schritt, ohne Server und ohne CDN-Abhängigkeit für die Logik.
Gehostet wird sie über GitHub Pages und ist damit rund um die Uhr erreichbar.

> Kein Bloomberg-Produkt, keine Bloomberg-Daten, keine Anlageberatung.

## Was ist live, was nicht

| Bereich | Quelle | Aktualität | Kosten |
|---|---|---|---|
| Krypto-Monitor, Chart, Orderbuch, Time & Sales | Binance Spot, `data-stream.binance.vision` | Echtzeit, 24/7 | frei, kein Key |
| MOST (Top-Bewegungen) | Binance REST `ticker/24hr?type=MINI` | alle 2 min | frei |
| US-Aktien, Nachrichten | Finnhub (WebSocket + REST) | Echtzeit, nur zu Handelszeiten | kostenloser Key |
| FX | EZB-Referenzkurse über Frankfurter | **1× täglich**, kein Live-FX | frei |
| Fear & Greed | alternative.me | täglich | frei |

Grenzen, die du kennen musst:

- **Echtes 24/7 gibt es nur bei Krypto.** Aktienbörsen schließen. Außerhalb der Handelszeiten kommen von Finnhub keine Trades.
- **Kein historischer Aktien-Chart.** Finnhub-Kerzen sind kostenpflichtig. Der Aktien-Chart wird deshalb ab Seitenaufruf live aus Trades aufgezeichnet.
- **FX ist ein Referenzkurs, kein Live-Kurs.** Eine Live-Näherung ist `EURUSDT` (Tether ≠ USD, kleine Basis möglich).
- **Handelszeiten ohne Feiertage.**
- **Geo-Sperren:** Binance sperrt einige Länder. Aus Deutschland funktioniert der Zugang.
- **Live heißt: live, solange die Seite offen ist.** Die Daten kommen direkt aus dem Browser. Für einen Dauerbildschirm gibt es `KIOSK`.

## Befehle

Tippe einfach los. Jede Taste landet in der Befehlszeile, Enter bedeutet `<GO>`.

| Befehl | Wirkung |
|---|---|
| `BTC`, `ETH`, `SOLUSDT`, `ETHBTC` | Krypto-Wert laden (ohne Quote-Währung wird USDT angehängt) |
| `BTC GP 5M` | Laden, Intervall setzen, Chart maximieren |
| `AAPL US`, `MSFT EQUITY` | US-Aktie laden (braucht Key) |
| `GP [1M\|5M\|15M\|1H\|4H\|1D]` | Chart |
| `WEI`/`MON`, `BOOK`, `TAPE`, `MOST`, `MKT`, `N` | Panel maximieren |
| `LP` / `Esc` | Zurück zum Launchpad |
| `ADD LINK`, `DEL LINK`, `ADD NVDA US` | Watchlist |
| `KEY <token>` / `KEY CLEAR` | Finnhub-Key (bleibt nur in `localStorage` dieses Browsers) |
| `KIOSK` | Vollbild + Screen Wake Lock |
| `DEMO` / `LIVE` | Simulierte Daten (deutlich markiert) / echte Daten |
| `F1` Hilfe · `F2` MON · `F3` GP · `F4` BOOK · `F6` MOST · `F7` N · `F8` MKT | Funktionstasten (F5/F11/F12 bleiben beim Browser) |

## Robustheit für 24/7-Betrieb

- WebSocket-Reconnect mit exponentiellem Backoff und Jitter (1 s bis 30 s).
- Watchdog: 20 s ohne Daten führen zu einer neuen Verbindung.
- Verbindungswechsel vor dem harten 24-h-Limit von Binance, dazu Behandlung des `serverShutdown`-Events.
- Neue Verbindung bei `online` und wenn der Tab wieder sichtbar wird.
- Nach einem Ausfall werden Chart und Movers neu synchronisiert, zusätzlich alle 15 min.
- Speicher ist begrenzt: 1000 Kerzen, 80 Tape-Zeilen, 1440 Aktien-Minuten.

## Deployment (einmalig)

1. Branch nach `main` mergen.
2. GitHub → **Settings → Pages → Build and deployment → Source: GitHub Actions**.
3. Der Workflow `.github/workflows/terminal-pages.yml` deployt `terminal/` automatisch.
   URL: `https://<user>.github.io/<repo>/`

Lokal testen: `cd terminal && python3 -m http.server 8000` und dann `http://localhost:8000` öffnen (`?demo=1` für Offline-Daten).
