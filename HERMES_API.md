# 🤖 Hermes Agent & MCP Integration Guide — MBA HUB

Vollständige API- und Schnittstellendokumentation für den **Hermes Agenten** zur Kommunikation mit dem **MBA Hub**.

---

## 1. 🔑 Authentifizierung & Verbindung

Alle Endpunkte (sofern in den Settings ein API-Key vergeben wurde) authentifizieren sich über den HTTP-Header:

* **Header-Option 1 (Empfohlen):** `x-mba-api-key: <dein_mcp_api_key>`
* **Header-Option 2:** `Authorization: Bearer <dein_mcp_api_key>`
* **Content-Type:** `application/json`

> **Hinweis:** Wenn in den MBA Hub Settings noch kein `mcpApiKey` hinterlegt ist, werden Anfragen für Entwicklungszwecke automatisch durchgelassen.

---

## 2. ⚡ Heartbeat & Ping Endpunkte

Dient zur Liveness-Prüfung, zum Aktualisieren des Dashboard-Status (Live-Puls in der Topologie) und zur Überwachung der Warteschlangen.

### `ALL /api/v1/mcp/ping` (Aliase: `/api/v1/mcp/heartbeat`)
Unterstützt `GET` und `POST`. Registriert einen Ping im System-Monitor.

#### Beispiel Request (POST):
```bash
curl -X POST https://hub.deinedomain.de/api/v1/mcp/ping \
  -H "x-mba-api-key: mba_secret_key_123" \
  -H "Content-Type: application/json" \
  -d '{
    "agent": "Hermes-Master-01",
    "status": "idle"
  }'
```

#### Beispiel Response:
```json
{
  "status": "ok",
  "message": "Heartbeat registered successfully.",
  "authenticated": true,
  "authConfigured": true,
  "serverTime": "2026-08-26T14:35:00.000Z",
  "uptimeSeconds": 1420,
  "activeTasksCount": 3,
  "uploadQueueCount": 12,
  "heartbeat": {
    "lastPingTime": "2026-08-26T14:35:00.000Z",
    "totalPings": 48
  }
}
```

---

### `GET /api/v1/mcp/health` (Alias: `/health`)
Prüft den globalen Serverstatus und die Verfügbarkeit der Trademark-Schnittstellen.

#### Beispiel Response:
```json
{
  "status": "ok",
  "service": "MBA_HUB_MCP",
  "version": "1.0.0",
  "authenticated": true,
  "authConfigured": true,
  "trademarkEngine": {
    "status": "online",
    "offices": ["USPTO", "EUIPO", "DPMA"]
  }
}
```

---

### `GET /api/v1/mcp/schema`
Liefert das offizielle MCP / Tool-Schema für LLM Function Calling (z. B. für Claude, GPT, OpenRouter oder native MCP Clients).

---

## 3. 🛡️ Live-Trademark Check API

Ermöglicht Hermes die **Pre-Flight Prüfung** von Sprüchen, Keywords oder ganzen Listings vor der Generierung.

* **Endpunkt:** `POST /api/v1/mcp/trademark/check`
* **Aliase:** `/api/v1/trademark/check`, `/api/v1/trademark`, `/trademark`

### Features:
1. **Multi-Office Support:** `USPTO` (USA), `EUIPO` (Europa / UK), `DPMA` (Deutschland).
2. **Exklusiv LIVE-Treffer:** `DEAD`, `PENDING`, `CANCELLED`, `EXPIRED`, `REFUSED`, `ABANDONED` werden strikt gefiltert.
3. **Differenzierte Trefferanalyse:** Trennt exakte Phrasen-Treffer (`exactPhraseHits`) von Einzelwort-Treffern (`keywordHits`).
4. **Nizza-Klassen-Audit:** Erkennt Klasse 25 (Bekleidung) sowie Nebenklassen (9: PopSockets/Cases, 21: Mugs, 20: Pillows, 18: Totes).

---

### Payload-Varianten:

#### Variante A: Schneller Quote-Check (Einzeiler)
```json
{
  "quote": "Just a Girl who loves Frisians",
  "offices": ["USPTO", "EUIPO", "DPMA"]
}
```
*(Parameter `quote`, `phrase` oder `text` können synonym verwendet werden)*

#### Variante B: Keyword-Liste (Array)
```json
{
  "terms": ["Frisian Horse", "Equestrian Girl", "Dressage Life"],
  "marketplace": "US"
}
```

#### Variante C: Vollständiges Listing
```json
{
  "offices": ["USPTO", "EUIPO"],
  "fields": {
    "quote": "Just a Girl who loves Frisians",
    "title": "Retro Vintage Frisian Horse Lover Outfit",
    "brand": "Frisian Equestrian Apparel",
    "bullet1": "Featuring a beautiful Friesian horse illustration in retro style.",
    "bullet2": "Great gift idea for horseback riders and horse enthusiasts."
  }
}
```

---

### Response-Struktur:

```json
{
  "success": true,
  "safe": true,
  "hasInfringementClass25": false,
  "affectedClasses": ["9", "21"],
  "blockedProducts": ["POPSOCKET", "PHONE_CASE_APPLE_IPHONE", "MUG"],
  "officesChecked": ["USPTO", "EUIPO", "DPMA"],
  "summary": {
    "totalHits": 2,
    "verdict": "SAFE_FOR_APPAREL",
    "message": "Keine Treffer in Klasse 25 (Bekleidung sicher). 3 Nebenprodukte gesperrt.",
    "exactPhraseHitsCount": 0,
    "keywordHitsCount": 2
  },
  "exactPhraseHits": [],
  "keywordHits": [
    {
      "term": "frisian",
      "trademark": "FRISIAN TECH",
      "classNumber": "9",
      "classes": ["9"],
      "status": "LIVE",
      "serialNumber": "88991122",
      "source": "USPTO"
    }
  ],
  "fieldResults": {
    "quote": {
      "safe": true,
      "hasInfringementClass25": false,
      "totalHits": 2,
      "blockedProducts": ["POPSOCKET", "PHONE_CASE_APPLE_IPHONE", "MUG"],
      "hits": { ... }
    }
  }
}
```

#### Verdict-Werte (`summary.verdict`):
* `SAFE_ALL`: 100% sauber, keinerlei Treffer auf allen Produkten.
* `SAFE_FOR_APPAREL`: Keine Klasse-25-Treffer. Shirts/Hoodies sicher; bestimmte Nebenprodukte gesperrt.
* `NEEDS_AUDIT`: Treffer in Bullets/Description (erfordert Kontext-/Fair-Use Prüfung).
* `REJECTED_CLASS_25`: Brand, Title oder Quote verletzen ein aktives Markenrecht in Klasse 25 ➔ **Nicht hochladen / Umschreiben!**

---

## 4. 🎨 Design-Submission API

Übergibt eine neue Design-Idee an die Generierungs- & Vektorisierungs-Pipeline des MBA Hub.

* **Endpunkt:** `POST /api/v1/design`
* **Aliase:** `/design`, `/api/v1/hermes/design`, `/api/v1/mcp/design`

### Payload (Strukturierte Nischen-Idee):

```json
{
  "niche1": "Horse Riding",
  "niche2": "Frisian Horse",
  "quote": "Just a Girl who loves Frisians",
  "style": "vintage distressed retro sunset silhouette",
  "feelings": "passionate, elegant",
  "backgroundcolor": "black",
  "fontcolor": "cream / warm gold",
  "custominstruction": "Silhouette of a majestic Frisian horse with flowing mane, bold vintage typography, isolated on black background"
}
```

### Parameter-Erklärung:
| Feld | Typ | Pflicht? | Beschreibung |
| :--- | :--- | :--- | :--- |
| `niche1` | `string` | Ja | Hauptnische (z. B. `"Horse Riding"`, `"Angel Numbers"`) |
| `niche2` | `string` | Optional | Subnische oder spezifisches Motiv (z. B. `"Frisian Horse"`) |
| `quote` | `string` | Ja | Text / Spruch auf dem Shirt (z. B. `"Just a Girl who loves Frisians"`) |
| `style` | `string` | Optional | Grafikstil (z. B. `"retro vintage 80s"`, `"line art vector"`) |
| `feelings` | `string` | Optional | Stimmung / Vibe (z. B. `"humorous"`, `"cozy"`, `"motivational"`) |
| `backgroundcolor` | `string` | Optional | Shirt-Grundfarbe für Kontrast (z. B. `"black"`, `"white"`, `"navy"`) |
| `fontcolor` | `string` | Optional | Schriftfarbe (z. B. `"cream"`, `"white"`, `"gold"`) |
| `custominstruction` | `string` | Optional | Zusätzliche visuelle Anweisungen für den Ideogram-Prompt |

### Response:
```json
{
  "success": true,
  "taskId": "#014-H",
  "source": "HERMES",
  "receivedAt": "2026-08-26T14:35:10.123Z",
  "payload": { ... }
}
```

---

## 5. 🔄 Workflow-Ablauf im MBA Hub nach Submission

```text
[Hermes Agent] ──(POST /api/v1/design)──> [MBA Hub Engine]
                                               │
                                               ├─ 1. Task registrieren (z.B. #014-H)
                                               ├─ 2. Automatischer Pre-Flight TM-Check (USPTO Klasse 25)
                                               │      └─ [Falls Hit: Stoppt Pipeline -> Tasks Review]
                                               ├─ 3. LLM Prompt-Generierung (Art Director)
                                               ├─ 4. Ideogram 3.0 Bild-Generierung
                                               ├─ 5. Human-in-the-Loop Co-Pilot:
                                               │      ├─ Bildkontrolle & QA
                                               │      ├─ Multi-Language Listing (EN, DE, FR, IT, ES, JA)
                                               │      ├─ Vectorizer.ai Vektorisierung & SVG-Editor
                                               │      └─ 4-Panel Cutout Vision Audit (4500x5400px Master-PNG)
                                               └─ 6. Übergabe in die Upload-Queue & Slot-Balancing
```

---

## 6. 💻 Python-Beispielscript für Hermes

```python
import requests

HUB_BASE_URL = "https://hub.deinedomain.de"
API_KEY = "mba_secret_key_123"

HEADERS = {
    "x-mba-api-key": API_KEY,
    "Content-Type": "application/json"
}

# 1. Heartbeat Ping
def ping_hub():
    res = requests.post(f"{HUB_BASE_URL}/api/v1/mcp/ping", headers=HEADERS, json={"agent": "Hermes"})
    print("Ping:", res.json())

# 2. Pre-Flight Trademark Check
def check_trademark(quote):
    payload = {
        "quote": quote,
        "offices": ["USPTO", "EUIPO", "DPMA"]
    }
    res = requests.post(f"{HUB_BASE_URL}/api/v1/mcp/trademark/check", headers=HEADERS, json=payload)
    data = res.json()
    print(f"TM Check für '{quote}': Safe={data.get('safe')}, Verdict={data.get('summary', {}).get('verdict')}")
    return data

# 3. Submit Design
def submit_design():
    design_data = {
        "niche1": "Horse Riding",
        "niche2": "Frisian Horse",
        "quote": "Just a Girl who loves Frisians",
        "style": "retro vintage sunset distressed",
        "feelings": "passionate",
        "backgroundcolor": "black",
        "fontcolor": "cream",
        "custominstruction": "Majestic silhouette of a Frisian horse with bold vintage typography"
    }
    res = requests.post(f"{HUB_BASE_URL}/api/v1/design", headers=HEADERS, json=design_data)
    print("Design Task:", res.json())

if __name__ == "__main__":
    ping_hub()
    tm = check_trademark("Just a Girl who loves Frisians")
    if tm.get("safe"):
        submit_design()
    else:
        print("Quote hat Markenrechts-Konflikte, wird verworfen!")
```
